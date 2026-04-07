/**
 * Parts Reorder Compute — dynamic reorder point calculation engine.
 *
 * Cron: service_role, daily (or on-demand).
 *
 * For each (workspace, branch, part_number) in parts_inventory:
 *   1. Compute consumption velocity from historical order lines + service requirements
 *   2. Pull vendor avg lead time from vendor_profiles (or default)
 *   3. Calculate safety stock, reorder point, and economic order quantity
 *   4. Upsert into parts_reorder_profiles
 *
 * Sources of demand signal:
 *   - parts_order_lines (internal + portal orders, shipped/delivered)
 *   - service_parts_requirements (consumed status)
 *   - parts_fulfillment_events (counter_order_picked)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const DEFAULT_VELOCITY_WINDOW_DAYS = 90;
const DEFAULT_LEAD_TIME_DAYS = 7;
const DEFAULT_LEAD_TIME_STD_DEV = 2;
const DEFAULT_SAFETY_FACTOR = 1.65; // ~95% service level
const DEFAULT_HOLDING_COST_FRACTION = 0.25; // 25% of unit cost per year
const DEFAULT_ORDER_COST = 25; // fixed cost per order placement
const MIN_EOQ = 1;
const MAX_EOQ = 9999;

interface DemandSignal {
  part_number: string;
  quantity: number;
  event_date: string;
  branch_id: string | null;
}

interface InventoryRow {
  workspace_id: string;
  branch_id: string;
  part_number: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function computeEOQ(
  annualDemand: number,
  orderCost: number,
  unitCost: number,
  holdingFraction: number,
): number {
  if (annualDemand <= 0 || unitCost <= 0) return MIN_EOQ;
  const holdingCost = unitCost * holdingFraction;
  if (holdingCost <= 0) return MIN_EOQ;
  const eoq = Math.sqrt((2 * annualDemand * orderCost) / holdingCost);
  return clamp(Math.round(eoq), MIN_EOQ, MAX_EOQ);
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
        function: "parts-reorder-compute",
        ts: new Date().toISOString(),
      }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    const results = {
      inventory_rows_scanned: 0,
      profiles_upserted: 0,
      demand_signals_processed: 0,
      errors: 0,
    };

    // ── 1. Fetch all active inventory positions ───────────────────────────
    const { data: inventoryRows, error: invErr } = await supabase
      .from("parts_inventory")
      .select("workspace_id, branch_id, part_number")
      .is("deleted_at", null);

    if (invErr) {
      console.error("parts-reorder-compute inventory fetch:", invErr);
      return safeJsonError("Failed to fetch inventory", 500, null);
    }

    if (!inventoryRows || inventoryRows.length === 0) {
      await logServiceCronRun(supabase, {
        jobName: "parts-reorder-compute",
        ok: true,
        metadata: { results, note: "no inventory rows" },
      });
      return safeJsonOk({ ok: true, results }, null);
    }

    results.inventory_rows_scanned = inventoryRows.length;

    // ── 2. Gather demand signals (rolling window) ─────────────────────────
    const windowStart = new Date(
      Date.now() - DEFAULT_VELOCITY_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    // 2a. Parts order lines from completed/shipped orders
    const { data: orderDemand } = await supabase
      .from("parts_order_lines")
      .select(`
        part_number,
        quantity,
        created_at,
        parts_orders!inner(status, workspace_id)
      `)
      .gte("created_at", windowStart)
      .in("parts_orders.status", ["shipped", "delivered", "processing", "confirmed"]);

    // 2b. Service parts requirements that were consumed
    const { data: serviceReqDemand } = await supabase
      .from("service_parts_requirements")
      .select("part_number, quantity, updated_at, workspace_id")
      .eq("status", "consumed")
      .gte("updated_at", windowStart);

    // 2c. Fulfillment events: counter_order_picked (branch-level signal)
    const { data: pickEvents } = await supabase
      .from("parts_fulfillment_events")
      .select("payload, created_at, workspace_id")
      .eq("event_type", "counter_order_picked")
      .gte("created_at", windowStart);

    // ── 3. Build demand map: (workspace:part_number) → signals[] ──────────
    const demandMap = new Map<string, DemandSignal[]>();

    function addSignal(key: string, signal: DemandSignal): void {
      const arr = demandMap.get(key) ?? [];
      arr.push(signal);
      demandMap.set(key, arr);
    }

    for (const row of orderDemand ?? []) {
      const ws = (row as unknown as { parts_orders: { workspace_id: string } })
        .parts_orders?.workspace_id;
      if (!ws) continue;
      const key = `${ws}:${(row.part_number as string).toLowerCase()}`;
      addSignal(key, {
        part_number: row.part_number as string,
        quantity: Number(row.quantity) || 1,
        event_date: row.created_at as string,
        branch_id: null,
      });
      results.demand_signals_processed++;
    }

    for (const row of serviceReqDemand ?? []) {
      const key = `${row.workspace_id}:${(row.part_number as string).toLowerCase()}`;
      addSignal(key, {
        part_number: row.part_number as string,
        quantity: Number(row.quantity) || 1,
        event_date: row.updated_at as string,
        branch_id: null,
      });
      results.demand_signals_processed++;
    }

    for (const ev of pickEvents ?? []) {
      const p = ev.payload as Record<string, unknown> | null;
      if (!p?.part_number) continue;
      const key = `${ev.workspace_id}:${String(p.part_number).toLowerCase()}`;
      addSignal(key, {
        part_number: String(p.part_number),
        quantity: Number(p.quantity) || 1,
        event_date: ev.created_at as string,
        branch_id: p.branch_id ? String(p.branch_id) : null,
      });
      results.demand_signals_processed++;
    }

    // ── 4. Fetch vendor lead times (scoped per workspace) ─────────────────
    const { data: vendors } = await supabase
      .from("vendor_profiles")
      .select("id, workspace_id, avg_lead_time_hours");

    const wsLeadDays = new Map<string, number>();
    const vendorByWs = new Map<string, Array<{ avg_lead_time_hours: number }>>();
    for (const v of vendors ?? []) {
      if (v.avg_lead_time_hours != null && Number(v.avg_lead_time_hours) > 0) {
        const ws = v.workspace_id as string;
        const arr = vendorByWs.get(ws) ?? [];
        arr.push({ avg_lead_time_hours: Number(v.avg_lead_time_hours) });
        vendorByWs.set(ws, arr);
      }
    }
    for (const [ws, arr] of vendorByWs.entries()) {
      const sum = arr.reduce((s, v) => s + v.avg_lead_time_hours, 0);
      wsLeadDays.set(ws, sum / arr.length / 24);
    }

    // ── 5. Fetch catalog cost prices for EOQ ──────────────────────────────
    const { data: catalogRows } = await supabase
      .from("parts_catalog")
      .select("part_number, workspace_id, cost_price")
      .is("deleted_at", null);

    const costMap = new Map<string, number>();
    for (const c of catalogRows ?? []) {
      if (c.cost_price != null && Number(c.cost_price) > 0) {
        costMap.set(
          `${c.workspace_id}:${(c.part_number as string).toLowerCase()}`,
          Number(c.cost_price),
        );
      }
    }

    // ── 6. Compute reorder profiles ───────────────────────────────────────
    const upsertBatch: Record<string, unknown>[] = [];
    const now = new Date();
    const nextCompute = new Date(now.getTime() + 86_400_000); // +1 day

    for (const inv of inventoryRows as InventoryRow[]) {
      const partKey = `${inv.workspace_id}:${inv.part_number.toLowerCase()}`;
      const signals = demandMap.get(partKey) ?? [];

      // Branch-specific signals (picks) plus workspace-wide (orders)
      const branchSignals = signals.filter(
        (s) => s.branch_id === null || s.branch_id === inv.branch_id,
      );

      const totalConsumed = branchSignals.reduce((s, d) => s + d.quantity, 0);
      const velocity = totalConsumed / DEFAULT_VELOCITY_WINDOW_DAYS; // units/day

      const leadTimeDays = wsLeadDays.get(inv.workspace_id) ?? DEFAULT_LEAD_TIME_DAYS;
      const leadTimeStdDev = DEFAULT_LEAD_TIME_STD_DEV;

      // Safety stock = Z × √(LT × σ²_demand + D² × σ²_LT)
      // Simplified: Z × √(LT) × daily_std_dev + Z × D_avg × σ_LT
      // Further simplified for MVP: Z × velocity × leadTimeStdDev
      const demandDuringLead = velocity * leadTimeDays;
      const safetyStock = Math.ceil(
        DEFAULT_SAFETY_FACTOR * Math.sqrt(
          leadTimeDays * Math.pow(velocity * 0.3, 2) + // demand variability ~30% CV
          Math.pow(velocity, 2) * Math.pow(leadTimeStdDev, 2),
        ),
      );

      const reorderPoint = Math.ceil(demandDuringLead + safetyStock);

      // EOQ: Wilson formula
      const annualDemand = velocity * 365;
      const unitCost = costMap.get(partKey) ?? 50; // fallback $50
      const eoq = computeEOQ(
        annualDemand,
        DEFAULT_ORDER_COST,
        unitCost,
        DEFAULT_HOLDING_COST_FRACTION,
      );

      upsertBatch.push({
        workspace_id: inv.workspace_id,
        branch_id: inv.branch_id,
        part_number: inv.part_number,
        consumption_velocity: Math.round(velocity * 10000) / 10000,
        velocity_window_days: DEFAULT_VELOCITY_WINDOW_DAYS,
        total_consumed: totalConsumed,
        avg_lead_time_days: Math.round(leadTimeDays * 100) / 100,
        lead_time_std_dev: Math.round(leadTimeStdDev * 100) / 100,
        safety_stock: safetyStock,
        reorder_point: reorderPoint,
        economic_order_qty: eoq,
        safety_factor: DEFAULT_SAFETY_FACTOR,
        last_computed_at: now.toISOString(),
        next_compute_at: nextCompute.toISOString(),
        computation_source: "cron_compute",
      });
    }

    // Upsert in chunks of 200
    const CHUNK = 200;
    for (let i = 0; i < upsertBatch.length; i += CHUNK) {
      const chunk = upsertBatch.slice(i, i + CHUNK);
      const { error: upErr } = await supabase
        .from("parts_reorder_profiles")
        .upsert(chunk, { onConflict: "workspace_id,branch_id,part_number" });
      if (upErr) {
        console.error(`parts-reorder-compute upsert chunk ${i}:`, upErr);
        results.errors++;
      } else {
        results.profiles_upserted += chunk.length;
      }
    }

    const elapsedMs = Date.now() - startMs;

    await logServiceCronRun(supabase, {
      jobName: "parts-reorder-compute",
      ok: results.errors === 0,
      metadata: { results, elapsed_ms: elapsedMs },
    });

    return safeJsonOk({ ok: true, results, elapsed_ms: elapsedMs }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-reorder-compute", req });
    console.error("parts-reorder-compute error:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "parts-reorder-compute",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch { /* ignore secondary logging failures */ }
    return safeJsonError("Internal server error", 500, null);
  }
});
