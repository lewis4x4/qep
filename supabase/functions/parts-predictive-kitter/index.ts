/**
 * Parts Predictive Kitter — proactive maintenance parts kit generation.
 *
 * Cron: service_role, weekly.
 *
 * For each customer_fleet record approaching a service interval:
 *   1. Analyze historical service_parts_requirements for similar equipment
 *   2. Build a predicted parts kit
 *   3. Check stock availability at the nearest branch
 *   4. Upsert into parts_predictive_kits
 *
 * The dealership calls the customer before the customer calls them.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const HOURS_THRESHOLD_FRACTION = 0.9;
const DATE_WINDOW_DAYS = 60;
const MIN_CONFIDENCE = 0.3;

interface FleetRow {
  id: string;
  workspace_id: string;
  portal_customer_id: string | null;
  equipment_id: string | null;
  make: string;
  model: string;
  year: number | null;
  serial_number: string | null;
  current_hours: number | null;
  service_interval_hours: number | null;
  last_service_date: string | null;
  next_service_due: string | null;
  is_active: boolean;
  crm_company_id?: string | null;
}

interface HistoricalPart {
  part_number: string;
  description: string | null;
  quantity: number;
  frequency: number;
}

interface KitPart {
  part_number: string;
  description: string | null;
  quantity: number;
  unit_cost: number | null;
  in_stock: boolean;
  branch_id: string | null;
  qty_available: number;
}

function predictServiceWindow(fleet: FleetRow): string | null {
  if (fleet.next_service_due) {
    const due = new Date(fleet.next_service_due);
    const now = new Date();
    const daysUntil = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
    if (daysUntil <= DATE_WINDOW_DAYS) {
      return `${daysUntil}d (scheduled ${fleet.next_service_due})`;
    }
  }

  if (
    fleet.current_hours != null &&
    fleet.service_interval_hours != null &&
    fleet.service_interval_hours > 0
  ) {
    const hoursRemaining = fleet.service_interval_hours -
      (fleet.current_hours % fleet.service_interval_hours);
    const threshold = fleet.service_interval_hours * (1 - HOURS_THRESHOLD_FRACTION);
    if (hoursRemaining <= threshold) {
      const approxDays = Math.ceil(hoursRemaining / 8); // ~8 operating hours/day
      return `~${approxDays}d (~${Math.round(hoursRemaining)}h remaining)`;
    }
  }

  return null;
}

function predictFailureType(fleet: FleetRow): string {
  const model = (fleet.model ?? "").toLowerCase();
  const hours = fleet.current_hours ?? 0;

  if (hours > 5000 && model.includes("excavator")) return "undercarriage_overhaul";
  if (hours > 3000 && model.includes("dozer")) return "blade_edge_replacement";
  if (hours > 2000) return "hydraulic_service";
  if (hours > 1000) return "preventive_maintenance";
  return "scheduled_service";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    if (req.method === "GET") {
      return safeJsonOk({
        ok: true,
        function: "parts-predictive-kitter",
        ts: new Date().toISOString(),
      }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);
    const batchId = `predictive-kit-${new Date().toISOString().slice(0, 10)}`;

    const results = {
      fleet_scanned: 0,
      kits_generated: 0,
      kits_all_in_stock: 0,
      kits_partial: 0,
      kits_none_in_stock: 0,
      errors: 0,
    };

    // 1. Fetch active fleet records
    const { data: fleetRows, error: fleetErr } = await supabase
      .from("customer_fleet")
      .select(`
        id, workspace_id, portal_customer_id, equipment_id,
        make, model, year, serial_number, current_hours,
        service_interval_hours, last_service_date, next_service_due, is_active,
        portal_customers!inner ( crm_company_id )
      `)
      .eq("is_active", true);

    if (fleetErr) {
      console.error("parts-predictive-kitter fleet fetch:", fleetErr);
      return safeJsonError("Failed to fetch fleet data", 500, null);
    }

    if (!fleetRows?.length) {
      await logServiceCronRun(supabase, {
        jobName: "parts-predictive-kitter",
        ok: true,
        metadata: { results, note: "no active fleet records" },
      });
      return safeJsonOk({ ok: true, results }, null);
    }

    results.fleet_scanned = fleetRows.length;

    // 2. Fetch historical parts consumption patterns grouped by equipment make+model
    const { data: historicalReqs } = await supabase
      .from("service_parts_requirements")
      .select(`
        part_number, quantity, status,
        service_jobs!inner ( workspace_id, equipment_make, equipment_model )
      `)
      .in("status", ["consumed", "received", "ordered"]);

    // Build make+model → parts frequency map
    const patternMap = new Map<string, Map<string, HistoricalPart>>();
    for (const req of historicalReqs ?? []) {
      const job = (req as unknown as {
        service_jobs: { workspace_id: string; equipment_make: string; equipment_model: string };
      }).service_jobs;
      if (!job?.equipment_make) continue;

      const key = `${job.equipment_make}:${job.equipment_model ?? "any"}`.toLowerCase();
      if (!patternMap.has(key)) patternMap.set(key, new Map());
      const partsMap = patternMap.get(key)!;

      const pn = req.part_number as string;
      const existing = partsMap.get(pn);
      if (existing) {
        existing.quantity = Math.max(existing.quantity, Number(req.quantity) || 1);
        existing.frequency++;
      } else {
        partsMap.set(pn, {
          part_number: pn,
          description: null,
          quantity: Number(req.quantity) || 1,
          frequency: 1,
        });
      }
    }

    // 3. Fetch catalog for descriptions + costs
    const { data: catalogRows } = await supabase
      .from("parts_catalog")
      .select("part_number, description, cost_price, workspace_id")
      .is("deleted_at", null);

    const catalogMap = new Map<string, { description: string; cost: number | null }>();
    for (const c of catalogRows ?? []) {
      catalogMap.set(
        `${c.workspace_id}:${(c.part_number as string).toLowerCase()}`,
        { description: c.description as string, cost: c.cost_price ? Number(c.cost_price) : null },
      );
    }

    // 4. Fetch branch inventory for stock checks
    const { data: invRows } = await supabase
      .from("parts_inventory")
      .select("workspace_id, branch_id, part_number, qty_on_hand")
      .is("deleted_at", null)
      .gt("qty_on_hand", 0);

    const invMap = new Map<string, Array<{ branch_id: string; qty: number }>>();
    for (const inv of invRows ?? []) {
      const key = `${inv.workspace_id}:${(inv.part_number as string).toLowerCase()}`;
      const arr = invMap.get(key) ?? [];
      arr.push({ branch_id: inv.branch_id as string, qty: Number(inv.qty_on_hand) });
      invMap.set(key, arr);
    }

    // 5. Process each fleet record
    const upsertBatch: Record<string, unknown>[] = [];

    for (const fleet of fleetRows as Array<FleetRow & { portal_customers: { crm_company_id: string } }>) {
      const serviceWindow = predictServiceWindow(fleet);
      if (!serviceWindow) continue;

      const makeModel = `${fleet.make}:${fleet.model ?? "any"}`.toLowerCase();
      const makeOnly = `${fleet.make}:any`.toLowerCase();
      const historicalParts = patternMap.get(makeModel) ?? patternMap.get(makeOnly);

      if (!historicalParts || historicalParts.size === 0) continue;

      // Sort by frequency (most commonly needed first)
      const sortedParts = [...historicalParts.values()].sort(
        (a, b) => b.frequency - a.frequency,
      );

      const maxFreq = sortedParts[0]?.frequency ?? 1;
      const kitParts: KitPart[] = [];
      let kitValue = 0;
      let partsInStock = 0;

      for (const hp of sortedParts.slice(0, 15)) {
        const confidence = hp.frequency / maxFreq;
        if (confidence < MIN_CONFIDENCE) continue;

        const catKey = `${fleet.workspace_id}:${hp.part_number.toLowerCase()}`;
        const catInfo = catalogMap.get(catKey);
        const invKey = catKey;
        const stockLocations = invMap.get(invKey) ?? [];

        // Find nearest branch with stock (simplified: just pick the one with most stock)
        const bestBranch = stockLocations.sort((a, b) => b.qty - a.qty)[0] ?? null;
        const inStock = bestBranch != null && bestBranch.qty >= hp.quantity;

        const unitCost = catInfo?.cost ?? null;
        if (unitCost) kitValue += unitCost * hp.quantity;
        if (inStock) partsInStock++;

        kitParts.push({
          part_number: hp.part_number,
          description: catInfo?.description ?? hp.description,
          quantity: hp.quantity,
          unit_cost: unitCost,
          in_stock: inStock,
          branch_id: bestBranch?.branch_id ?? null,
          qty_available: bestBranch?.qty ?? 0,
        });
      }

      if (kitParts.length === 0) continue;

      const totalParts = kitParts.length;
      const stockStatus =
        partsInStock === totalParts
          ? "all_in_stock"
          : partsInStock > 0
            ? "partial"
            : "none";

      const failureType = predictFailureType(fleet);
      const avgConfidence = sortedParts
        .slice(0, kitParts.length)
        .reduce((s, p) => s + p.frequency / maxFreq, 0) / kitParts.length;

      if (stockStatus === "all_in_stock") results.kits_all_in_stock++;
      else if (stockStatus === "partial") results.kits_partial++;
      else results.kits_none_in_stock++;

      const crmCompanyId = fleet.portal_customers?.crm_company_id ?? null;

      upsertBatch.push({
        workspace_id: fleet.workspace_id,
        fleet_id: fleet.id,
        crm_company_id: crmCompanyId,
        equipment_make: fleet.make,
        equipment_model: fleet.model,
        equipment_serial: fleet.serial_number,
        current_hours: fleet.current_hours,
        service_interval_hours: fleet.service_interval_hours,
        predicted_service_window: serviceWindow,
        predicted_failure_type: failureType,
        confidence: Math.round(avgConfidence * 10000) / 10000,
        kit_parts: kitParts,
        kit_value: Math.round(kitValue * 100) / 100,
        kit_part_count: totalParts,
        nearest_branch_id: kitParts.find((p) => p.branch_id)?.branch_id ?? null,
        stock_status: stockStatus,
        parts_in_stock: partsInStock,
        parts_total: totalParts,
        status: "suggested",
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        model_version: "v1",
        computation_batch_id: batchId,
        drivers: {
          fleet_hours: fleet.current_hours,
          service_interval: fleet.service_interval_hours,
          next_service_due: fleet.next_service_due,
          historical_pattern_parts: sortedParts.length,
          failure_type: failureType,
        },
      });
    }

    // 6. Upsert kits
    const CHUNK = 100;
    for (let i = 0; i < upsertBatch.length; i += CHUNK) {
      const chunk = upsertBatch.slice(i, i + CHUNK);
      const { error: upErr } = await supabase
        .from("parts_predictive_kits")
        .upsert(chunk, { onConflict: "id" });
      if (upErr) {
        console.error(`parts-predictive-kitter upsert chunk ${i}:`, upErr);
        results.errors++;
      } else {
        results.kits_generated += chunk.length;
      }
    }

    const elapsedMs = Date.now() - startMs;

    await logServiceCronRun(supabase, {
      jobName: "parts-predictive-kitter",
      ok: results.errors === 0,
      metadata: { results, elapsed_ms: elapsedMs, batch_id: batchId },
    });

    return safeJsonOk({ ok: true, results, elapsed_ms: elapsedMs }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-predictive-kitter", req });
    console.error("parts-predictive-kitter error:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "parts-predictive-kitter",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch { /* ignore secondary logging failures */ }
    return safeJsonError("Internal server error", 500, null);
  }
});
