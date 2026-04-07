/**
 * Parts Demand Forecast Engine — 90-day forward projection per part per branch.
 *
 * Cron: service_role, weekly (Sunday night recommended).
 *
 * Methodology (v1_weighted_avg):
 *   1. Historical demand from parts_order_lines + service_parts_requirements (12mo)
 *   2. Monthly buckets → weighted moving average (recent months weighted heavier)
 *   3. Seasonal decomposition: month-over-month ratio from prior year
 *   4. Fleet hours signal: customer_fleet approaching service intervals → demand uplift
 *   5. Confidence interval: ±1 std dev of historical monthly variance
 *   6. Stockout risk: predicted demand vs current stock + reorder point
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const MODEL_VERSION = "v1_weighted_avg";
const LOOKBACK_MONTHS = 12;
const FORECAST_MONTHS = 3;

interface MonthlyBucket {
  month: string; // YYYY-MM
  qty: number;
}

interface PartBranchKey {
  workspace_id: string;
  part_number: string;
  branch_id: string;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function firstOfMonth(ym: string): string {
  return `${ym}-01`;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function weightedAvg(buckets: MonthlyBucket[]): number {
  if (buckets.length === 0) return 0;
  let wSum = 0;
  let wTotal = 0;
  for (let i = 0; i < buckets.length; i++) {
    const weight = i + 1; // more recent = higher weight
    wSum += buckets[i].qty * weight;
    wTotal += weight;
  }
  return wTotal > 0 ? wSum / wTotal : 0;
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return mean * 0.3; // fallback: 30% CV
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeSeasonalFactor(
  historicalBuckets: MonthlyBucket[],
  targetMonth: number,
): number {
  const byMonth = new Map<number, number[]>();
  for (const b of historicalBuckets) {
    const m = parseInt(b.month.split("-")[1], 10);
    const arr = byMonth.get(m) ?? [];
    arr.push(b.qty);
    byMonth.set(m, arr);
  }
  const targetValues = byMonth.get(targetMonth) ?? [];
  const allValues = historicalBuckets.map((b) => b.qty);
  const overallAvg = allValues.length > 0
    ? allValues.reduce((s, v) => s + v, 0) / allValues.length
    : 1;
  const targetAvg = targetValues.length > 0
    ? targetValues.reduce((s, v) => s + v, 0) / targetValues.length
    : overallAvg;
  if (overallAvg <= 0) return 1;
  const factor = targetAvg / overallAvg;
  return Math.max(0.3, Math.min(3.0, factor)); // clamp to reasonable range
}

function assessStockoutRisk(
  predictedQty: number,
  qtyOnHand: number | null,
  reorderPoint: number | null,
): string {
  if (qtyOnHand == null) return "low";
  if (qtyOnHand <= 0) return "critical";
  const coverage = qtyOnHand / Math.max(predictedQty, 0.1);
  if (coverage < 0.5) return "critical";
  if (coverage < 1.0) return "high";
  if (reorderPoint != null && qtyOnHand <= reorderPoint) return "medium";
  if (coverage < 1.5) return "medium";
  return "low";
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
        function: "parts-demand-forecast",
        ts: new Date().toISOString(),
      }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);
    const batchId = `forecast-${new Date().toISOString().slice(0, 10)}`;

    const results = {
      parts_analyzed: 0,
      forecasts_upserted: 0,
      fleet_signals_found: 0,
      errors: 0,
    };

    const now = new Date();
    const lookbackStart = addMonths(now, -LOOKBACK_MONTHS);

    // ── 1. Gather historical demand ───────────────────────────────────────

    // 1a. Order lines from completed orders
    const { data: orderLines } = await supabase
      .from("parts_order_lines")
      .select(`
        part_number,
        quantity,
        created_at,
        parts_orders!inner(status, workspace_id)
      `)
      .gte("created_at", lookbackStart.toISOString())
      .in("parts_orders.status", ["confirmed", "processing", "shipped", "delivered"]);

    // 1b. Service requirements (consumed/staged/received)
    const { data: serviceReqs } = await supabase
      .from("service_parts_requirements")
      .select("part_number, quantity, updated_at, workspace_id, job_id")
      .in("status", ["consumed", "staged", "received"])
      .gte("updated_at", lookbackStart.toISOString());

    // ── 2. Build monthly demand buckets per (workspace, part) ─────────────

    type DemandEntry = { workspace_id: string; part_number: string; month: string; qty: number };
    const demandEntries: DemandEntry[] = [];

    for (const row of orderLines ?? []) {
      const ws = (row as unknown as { parts_orders: { workspace_id: string } })
        .parts_orders?.workspace_id;
      if (!ws) continue;
      demandEntries.push({
        workspace_id: ws,
        part_number: (row.part_number as string).toLowerCase(),
        month: monthKey(new Date(row.created_at as string)),
        qty: Number(row.quantity) || 1,
      });
    }

    for (const row of serviceReqs ?? []) {
      demandEntries.push({
        workspace_id: row.workspace_id as string,
        part_number: (row.part_number as string).toLowerCase(),
        month: monthKey(new Date(row.updated_at as string)),
        qty: Number(row.quantity) || 1,
      });
    }

    // Aggregate into monthly buckets per workspace:part
    const bucketMap = new Map<string, Map<string, number>>(); // key → month → qty
    for (const e of demandEntries) {
      const key = `${e.workspace_id}::${e.part_number}`;
      if (!bucketMap.has(key)) bucketMap.set(key, new Map());
      const m = bucketMap.get(key)!;
      m.set(e.month, (m.get(e.month) ?? 0) + e.qty);
    }

    // ── 3. Get inventory positions and reorder profiles ───────────────────

    const { data: inventory } = await supabase
      .from("parts_inventory")
      .select("workspace_id, branch_id, part_number, qty_on_hand")
      .is("deleted_at", null);

    const invMap = new Map<string, { branch_id: string; qty_on_hand: number }[]>();
    for (const row of inventory ?? []) {
      const key = `${row.workspace_id}::${(row.part_number as string).toLowerCase()}`;
      const arr = invMap.get(key) ?? [];
      arr.push({ branch_id: row.branch_id as string, qty_on_hand: Number(row.qty_on_hand) });
      invMap.set(key, arr);
    }

    const { data: reorderProfiles } = await supabase
      .from("parts_reorder_profiles")
      .select("workspace_id, branch_id, part_number, reorder_point, consumption_velocity");

    const rpMap = new Map<string, { reorder_point: number; consumption_velocity: number }>();
    for (const rp of reorderProfiles ?? []) {
      const key = `${rp.workspace_id}::${(rp.part_number as string).toLowerCase()}::${rp.branch_id}`;
      rpMap.set(key, {
        reorder_point: Number(rp.reorder_point) || 0,
        consumption_velocity: Number(rp.consumption_velocity) || 0,
      });
    }

    // ── 4. Fleet hours signal ─────────────────────────────────────────────
    // Count fleet machines approaching service intervals → demand uplift

    let fleetUpliftParts = new Set<string>();
    try {
      const { data: fleet } = await supabase
        .from("customer_fleet")
        .select("current_hours, service_interval_hours, next_service_due")
        .not("current_hours", "is", null)
        .not("service_interval_hours", "is", null);

      const upcomingServiceCount = (fleet ?? []).filter((f) => {
        const hrs = Number(f.current_hours);
        const interval = Number(f.service_interval_hours);
        if (!interval || interval <= 0) return false;
        const hoursUntilService = interval - (hrs % interval);
        return hoursUntilService <= interval * 0.2; // within 20% of next interval
      }).length;

      results.fleet_signals_found = upcomingServiceCount;
      // Fleet signal is applied as a global uplift factor for consumable parts
      if (upcomingServiceCount > 3) {
        fleetUpliftParts = new Set([
          "hyd-filter-01", "seal-kit-12", "coolant-5gal", "belt-fan-42",
        ]);
      }
    } catch {
      // customer_fleet may not exist in all deployments
    }

    // ── 5. Generate forecasts ─────────────────────────────────────────────

    const forecastRows: Record<string, unknown>[] = [];
    const forecastMonthDates: Date[] = [];
    for (let i = 0; i < FORECAST_MONTHS; i++) {
      const d = addMonths(now, i + 1);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      forecastMonthDates.push(d);
    }

    for (const [key, monthMap] of bucketMap.entries()) {
      const [workspace_id, part_number] = key.split("::");
      results.parts_analyzed++;

      // Sort buckets chronologically
      const sortedBuckets: MonthlyBucket[] = [...monthMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, qty]) => ({ month, qty }));

      const baseAvg = weightedAvg(sortedBuckets);
      const monthlyQtys = sortedBuckets.map((b) => b.qty);
      const sd = stdDev(monthlyQtys, baseAvg);

      // Get branches for this part
      const branches = invMap.get(key) ?? [{ branch_id: "default", qty_on_hand: 0 }];

      for (const forecastDate of forecastMonthDates) {
        const targetMonth = forecastDate.getMonth() + 1;
        const seasonalFactor = computeSeasonalFactor(sortedBuckets, targetMonth);
        const fleetFactor = fleetUpliftParts.has(part_number) ? 1.15 : 1.0;

        const totalPredicted = Math.max(0, baseAvg * seasonalFactor * fleetFactor);
        const confLow = Math.max(0, totalPredicted - sd);
        const confHigh = totalPredicted + sd;

        // Distribute across branches proportional to their inventory share
        const totalOnHand = branches.reduce((s, b) => s + b.qty_on_hand, 0);

        for (const branch of branches) {
          const share = totalOnHand > 0
            ? branch.qty_on_hand / totalOnHand
            : 1 / branches.length;

          const branchPredicted = Math.round(totalPredicted * share * 100) / 100;
          const branchConfLow = Math.round(confLow * share * 100) / 100;
          const branchConfHigh = Math.round(confHigh * share * 100) / 100;

          const rpKey = `${workspace_id}::${part_number}::${branch.branch_id}`;
          const rp = rpMap.get(rpKey);

          const stockoutRisk = assessStockoutRisk(
            branchPredicted,
            branch.qty_on_hand,
            rp?.reorder_point ?? null,
          );

          forecastRows.push({
            workspace_id,
            part_number: part_number.toUpperCase(),
            branch_id: branch.branch_id,
            forecast_month: firstOfMonth(monthKey(forecastDate)),
            predicted_qty: branchPredicted,
            confidence_low: branchConfLow,
            confidence_high: branchConfHigh,
            qty_on_hand_at_forecast: branch.qty_on_hand,
            reorder_point_at_forecast: rp?.reorder_point ?? null,
            stockout_risk: stockoutRisk,
            drivers: {
              order_history: monthMap.size,
              base_velocity_per_month: Math.round(baseAvg * 100) / 100,
              seasonal_factor: Math.round(seasonalFactor * 100) / 100,
              fleet_uplift_factor: fleetFactor,
              monthly_std_dev: Math.round(sd * 100) / 100,
            },
            model_version: MODEL_VERSION,
            computation_batch_id: batchId,
            computed_at: now.toISOString(),
          });
        }
      }
    }

    // Also forecast for inventory items with no demand history (set to 0 with appropriate risk)
    const forecastedKeys = new Set(
      forecastRows.map((r) =>
        `${r.workspace_id}::${(r.part_number as string).toLowerCase()}::${r.branch_id}`
      ),
    );

    for (const row of inventory ?? []) {
      const pk = `${row.workspace_id}::${(row.part_number as string).toLowerCase()}`;
      for (const forecastDate of forecastMonthDates) {
        const fullKey = `${pk}::${row.branch_id}`;
        const monthStr = monthKey(forecastDate);
        const forecastKey = `${fullKey}::${monthStr}`;
        if (forecastedKeys.has(fullKey)) continue;

        forecastRows.push({
          workspace_id: row.workspace_id,
          part_number: (row.part_number as string).toUpperCase(),
          branch_id: row.branch_id,
          forecast_month: firstOfMonth(monthStr),
          predicted_qty: 0,
          confidence_low: 0,
          confidence_high: 0,
          qty_on_hand_at_forecast: Number(row.qty_on_hand),
          reorder_point_at_forecast: null,
          stockout_risk: Number(row.qty_on_hand) <= 0 ? "critical" : "none",
          drivers: { order_history: 0, note: "no_demand_history" },
          model_version: MODEL_VERSION,
          computation_batch_id: batchId,
          computed_at: now.toISOString(),
        });

        forecastedKeys.add(fullKey);
      }
    }

    // ── 6. Upsert forecasts ───────────────────────────────────────────────

    const CHUNK = 200;
    for (let i = 0; i < forecastRows.length; i += CHUNK) {
      const chunk = forecastRows.slice(i, i + CHUNK);
      const { error: upErr } = await supabase
        .from("parts_demand_forecasts")
        .upsert(chunk, {
          onConflict: "workspace_id,part_number,branch_id,forecast_month",
        });
      if (upErr) {
        console.error(`parts-demand-forecast upsert chunk ${i}:`, upErr);
        results.errors++;
      } else {
        results.forecasts_upserted += chunk.length;
      }
    }

    const elapsedMs = Date.now() - startMs;

    await logServiceCronRun(supabase, {
      jobName: "parts-demand-forecast",
      ok: results.errors === 0,
      metadata: { results, elapsed_ms: elapsedMs, batch_id: batchId },
    });

    return safeJsonOk({ ok: true, results, elapsed_ms: elapsedMs, batch_id: batchId }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-demand-forecast", req });
    console.error("parts-demand-forecast error:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "parts-demand-forecast",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch { /* ignore secondary logging failures */ }
    return safeJsonError("Internal server error", 500, null);
  }
});
