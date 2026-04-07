/**
 * Parts Network Optimizer — demand-aware inventory rebalancing across branches.
 *
 * Cron: service_role, weekly (or on-demand).
 *
 * For each workspace:
 *   1. Load current inventory positions per branch
 *   2. Load demand forecasts + reorder profiles per branch
 *   3. Identify imbalances (surplus at one branch, deficit at another)
 *   4. Compute optimal transfer recommendations
 *   5. Rank by net savings (stockout cost avoided - transfer cost)
 *   6. Write to parts_transfer_recommendations
 *   7. Snapshot daily P&L analytics
 *   8. Compute customer parts intelligence
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const ESTIMATED_TRANSFER_COST_PER_UNIT = 5;
const STOCKOUT_COST_MULTIPLIER = 20;
const DEAD_STOCK_DAYS = 180;

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
      return safeJsonOk({ ok: true, function: "parts-network-optimizer", ts: new Date().toISOString() }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);
    const batchId = `network-opt-${new Date().toISOString().slice(0, 10)}`;
    const today = new Date().toISOString().slice(0, 10);

    const results = {
      transfers_generated: 0,
      analytics_snapshots: 0,
      customer_intel_computed: 0,
      errors: 0,
    };

    // ── 4A: Branch Transfer Recommendations ───────────────────────────────

    const { data: invRows } = await supabase
      .from("parts_inventory")
      .select("workspace_id, branch_id, part_number, qty_on_hand")
      .is("deleted_at", null);

    const { data: reorderRows } = await supabase
      .from("parts_reorder_profiles")
      .select("workspace_id, branch_id, part_number, reorder_point, economic_order_qty, consumption_velocity");

    const { data: forecastRows } = await supabase
      .from("parts_demand_forecasts")
      .select("workspace_id, branch_id, part_number, predicted_qty");

    type InvKey = string;
    const invMap = new Map<InvKey, { workspace_id: string; branch_id: string; part_number: string; qty: number }>();
    for (const r of invRows ?? []) {
      const key = `${r.workspace_id}:${r.branch_id}:${r.part_number}`;
      invMap.set(key, { workspace_id: r.workspace_id as string, branch_id: r.branch_id as string, part_number: r.part_number as string, qty: Number(r.qty_on_hand) });
    }

    const reorderMap = new Map<InvKey, { rp: number; eoq: number; vel: number }>();
    for (const r of reorderRows ?? []) {
      const key = `${r.workspace_id}:${r.branch_id}:${r.part_number}`;
      reorderMap.set(key, { rp: Number(r.reorder_point), eoq: Number(r.economic_order_qty), vel: Number(r.consumption_velocity) });
    }

    const forecastMap = new Map<InvKey, number>();
    for (const r of forecastRows ?? []) {
      const key = `${r.workspace_id}:${r.branch_id}:${r.part_number}`;
      forecastMap.set(key, (forecastMap.get(key) ?? 0) + Number(r.predicted_qty));
    }

    // Group parts by workspace+part_number, find branch surpluses and deficits
    const partBranches = new Map<string, Array<{ branch_id: string; qty: number; rp: number; demand: number; surplus: number }>>();
    for (const [key, inv] of invMap) {
      const wsPartKey = `${inv.workspace_id}:${inv.part_number}`;
      const reorder = reorderMap.get(key);
      const demand = forecastMap.get(key) ?? 0;
      const rp = reorder?.rp ?? 0;
      const surplus = inv.qty - Math.max(rp, demand);

      if (!partBranches.has(wsPartKey)) partBranches.set(wsPartKey, []);
      partBranches.get(wsPartKey)!.push({
        branch_id: inv.branch_id,
        qty: inv.qty,
        rp,
        demand,
        surplus,
      });
    }

    const transferBatch: Record<string, unknown>[] = [];

    for (const [wsPartKey, branches] of partBranches) {
      const [workspaceId, partNumber] = wsPartKey.split(":", 2);

      const surplusBranches = branches.filter((b) => b.surplus > 2).sort((a, b) => b.surplus - a.surplus);
      const deficitBranches = branches.filter((b) => b.surplus < -1).sort((a, b) => a.surplus - b.surplus);

      if (surplusBranches.length === 0 || deficitBranches.length === 0) continue;

      for (const deficit of deficitBranches) {
        if (surplusBranches.length === 0) break;
        const shortage = Math.abs(deficit.surplus);

        for (const surplus of surplusBranches) {
          if (surplus.surplus <= 0) continue;
          const transferQty = Math.min(surplus.surplus, shortage);
          if (transferQty < 1) continue;

          const transferCost = transferQty * ESTIMATED_TRANSFER_COST_PER_UNIT;
          const stockoutCostAvoided = transferQty * STOCKOUT_COST_MULTIPLIER;
          const netSavings = stockoutCostAvoided - transferCost;

          if (netSavings <= 0) continue;

          const priority =
            deficit.surplus < -10 ? "critical" :
            deficit.surplus < -5 ? "high" :
            deficit.surplus < -2 ? "normal" : "low";

          transferBatch.push({
            workspace_id: workspaceId,
            part_number: partNumber,
            from_branch_id: surplus.branch_id,
            to_branch_id: deficit.branch_id,
            recommended_qty: transferQty,
            from_qty_on_hand: surplus.qty,
            to_qty_on_hand: deficit.qty,
            to_reorder_point: deficit.rp,
            to_forecast_demand: deficit.demand,
            estimated_transfer_cost: transferCost,
            estimated_stockout_cost_avoided: stockoutCostAvoided,
            net_savings: netSavings,
            priority,
            confidence: Math.min(0.95, 0.5 + (netSavings / 1000) * 0.1),
            reason: `Surplus of ${surplus.surplus} at ${surplus.branch_id}, deficit of ${Math.abs(deficit.surplus)} at ${deficit.branch_id}. Net savings: $${netSavings.toFixed(0)}`,
            status: "pending",
            computation_batch_id: batchId,
            model_version: "v1",
            drivers: {
              from_surplus: surplus.surplus,
              to_deficit: deficit.surplus,
              to_demand: deficit.demand,
              to_reorder_point: deficit.rp,
            },
          });

          surplus.surplus -= transferQty;
          break;
        }
      }
    }

    // Expire old pending recommendations
    await supabase
      .from("parts_transfer_recommendations")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    if (transferBatch.length > 0) {
      const { error: trErr } = await supabase
        .from("parts_transfer_recommendations")
        .insert(transferBatch);
      if (trErr) {
        console.error("transfer recs insert:", trErr);
        results.errors++;
      } else {
        results.transfers_generated = transferBatch.length;
      }
    }

    // ── 4B: Analytics Snapshot ────────────────────────────────────────────

    try {
      const { data: orderLines } = await supabase
        .from("parts_order_lines")
        .select(`
          part_number, quantity, unit_price, line_total, sort_order,
          parts_orders!inner ( workspace_id, status, order_source, crm_company_id, created_at )
        `)
        .in("parts_orders.status", ["confirmed", "processing", "shipped", "delivered"]);

      const { data: catalogAll } = await supabase
        .from("parts_catalog")
        .select("workspace_id, part_number, description, category, cost_price, list_price")
        .is("deleted_at", null);

      const catalogLookup = new Map<string, { description: string; category: string | null; cost: number }>();
      for (const c of catalogAll ?? []) {
        catalogLookup.set(
          `${c.workspace_id}:${(c.part_number as string).toLowerCase()}`,
          { description: c.description as string, category: c.category as string | null, cost: Number(c.cost_price) || 0 },
        );
      }

      const { data: companyNames } = await supabase
        .from("crm_companies")
        .select("id, name");
      const companyMap = new Map<string, string>();
      for (const co of companyNames ?? []) {
        companyMap.set(co.id as string, co.name as string);
      }

      // Aggregate per workspace
      type WsAgg = {
        totalRevenue: number;
        totalCost: number;
        orderCount: number;
        lineCount: number;
        byCategory: Map<string, { revenue: number; cost: number; lines: number }>;
        bySource: Map<string, { revenue: number; orders: number }>;
        byCustomer: Map<string, { name: string; revenue: number; orders: number }>;
        partVelocity: Map<string, { desc: string; qty: number; revenue: number }>;
        orderIds: Set<string>;
      };

      const wsAgg = new Map<string, WsAgg>();

      for (const line of orderLines ?? []) {
        const order = (line as unknown as { parts_orders: { workspace_id: string; order_source: string; crm_company_id: string | null; created_at: string } }).parts_orders;
        const wsId = order.workspace_id;

        if (!wsAgg.has(wsId)) {
          wsAgg.set(wsId, {
            totalRevenue: 0, totalCost: 0, orderCount: 0, lineCount: 0,
            byCategory: new Map(), bySource: new Map(), byCustomer: new Map(),
            partVelocity: new Map(), orderIds: new Set(),
          });
        }
        const agg = wsAgg.get(wsId)!;

        const lineTotal = Number(line.line_total) || (Number(line.quantity) * Number(line.unit_price));
        const catKey = `${wsId}:${(line.part_number as string).toLowerCase()}`;
        const catInfo = catalogLookup.get(catKey);
        const lineCost = (catInfo?.cost ?? 0) * Number(line.quantity);
        const category = catInfo?.category ?? "Uncategorized";

        agg.totalRevenue += lineTotal;
        agg.totalCost += lineCost;
        agg.lineCount++;

        const orderId = `${wsId}:${order.created_at}:${order.order_source}`;
        if (!agg.orderIds.has(orderId)) {
          agg.orderIds.add(orderId);
          agg.orderCount++;
        }

        // By category
        if (!agg.byCategory.has(category)) agg.byCategory.set(category, { revenue: 0, cost: 0, lines: 0 });
        const cat = agg.byCategory.get(category)!;
        cat.revenue += lineTotal; cat.cost += lineCost; cat.lines++;

        // By source
        const src = order.order_source;
        if (!agg.bySource.has(src)) agg.bySource.set(src, { revenue: 0, orders: 0 });
        const srcAgg = agg.bySource.get(src)!;
        srcAgg.revenue += lineTotal; srcAgg.orders++;

        // By customer
        if (order.crm_company_id) {
          if (!agg.byCustomer.has(order.crm_company_id)) {
            agg.byCustomer.set(order.crm_company_id, { name: companyMap.get(order.crm_company_id) ?? "Unknown", revenue: 0, orders: 0 });
          }
          const cust = agg.byCustomer.get(order.crm_company_id)!;
          cust.revenue += lineTotal; cust.orders++;
        }

        // Velocity
        const pn = line.part_number as string;
        if (!agg.partVelocity.has(pn)) agg.partVelocity.set(pn, { desc: catInfo?.description ?? pn, qty: 0, revenue: 0 });
        const vel = agg.partVelocity.get(pn)!;
        vel.qty += Number(line.quantity); vel.revenue += lineTotal;
      }

      // Compute dead stock
      const { data: allInv } = await supabase
        .from("parts_inventory")
        .select("workspace_id, part_number, qty_on_hand, updated_at")
        .is("deleted_at", null)
        .gt("qty_on_hand", 0);

      const deadStockByWs = new Map<string, { value: number; count: number }>();
      const cutoff = new Date(Date.now() - DEAD_STOCK_DAYS * 86_400_000).toISOString();
      for (const inv of allInv ?? []) {
        const wsId = inv.workspace_id as string;
        const catKey = `${wsId}:${(inv.part_number as string).toLowerCase()}`;
        const catInfo = catalogLookup.get(catKey);
        const qty = Number(inv.qty_on_hand);
        const isDead = (inv.updated_at as string) < cutoff;
        if (isDead) {
          if (!deadStockByWs.has(wsId)) deadStockByWs.set(wsId, { value: 0, count: 0 });
          const ds = deadStockByWs.get(wsId)!;
          ds.value += (catInfo?.cost ?? 0) * qty;
          ds.count++;
        }
      }

      // Total inventory value
      const invValueByWs = new Map<string, number>();
      for (const inv of allInv ?? []) {
        const wsId = inv.workspace_id as string;
        const catKey = `${wsId}:${(inv.part_number as string).toLowerCase()}`;
        const catInfo = catalogLookup.get(catKey);
        invValueByWs.set(wsId, (invValueByWs.get(wsId) ?? 0) + (catInfo?.cost ?? 0) * Number(inv.qty_on_hand));
      }

      // Upsert snapshots
      for (const [wsId, agg] of wsAgg) {
        const topCategories = [...agg.byCategory.entries()]
          .map(([cat, d]) => ({ category: cat, revenue: d.revenue, cost: d.cost, margin: d.revenue - d.cost, line_count: d.lines }))
          .sort((a, b) => b.revenue - a.revenue).slice(0, 20);

        const topCustomers = [...agg.byCustomer.entries()]
          .map(([id, d]) => ({ company_id: id, company_name: d.name, revenue: d.revenue, order_count: d.orders }))
          .sort((a, b) => b.revenue - a.revenue).slice(0, 20);

        const bySource = [...agg.bySource.entries()]
          .map(([src, d]) => ({ order_source: src, revenue: d.revenue, order_count: d.orders }));

        const fastest = [...agg.partVelocity.entries()]
          .map(([pn, d]) => ({ part_number: pn, description: d.desc, total_qty: d.qty, total_revenue: d.revenue }))
          .sort((a, b) => b.total_qty - a.total_qty).slice(0, 20);

        const ds = deadStockByWs.get(wsId) ?? { value: 0, count: 0 };

        const snapshot = {
          workspace_id: wsId,
          snapshot_date: today,
          total_revenue: Math.round(agg.totalRevenue * 100) / 100,
          total_cost: Math.round(agg.totalCost * 100) / 100,
          total_margin: Math.round((agg.totalRevenue - agg.totalCost) * 100) / 100,
          order_count: agg.orderCount,
          line_count: agg.lineCount,
          revenue_by_category: topCategories,
          revenue_by_branch: [],
          revenue_by_source: bySource,
          top_customers: topCustomers,
          fastest_moving: fastest,
          slowest_moving: [],
          total_inventory_value: Math.round((invValueByWs.get(wsId) ?? 0) * 100) / 100,
          dead_stock_value: Math.round(ds.value * 100) / 100,
          dead_stock_count: ds.count,
          computation_batch_id: batchId,
        };

        const { error: snapErr } = await supabase
          .from("parts_analytics_snapshots")
          .upsert(snapshot, { onConflict: "workspace_id,snapshot_date" });
        if (snapErr) {
          console.error("analytics snapshot upsert:", snapErr);
          results.errors++;
        } else {
          results.analytics_snapshots++;
        }
      }
    } catch (e) {
      console.error("analytics snapshot error:", e);
      results.errors++;
    }

    // ── 4C: Customer Parts Intelligence ───────────────────────────────────

    try {
      const { data: orderData } = await supabase
        .from("parts_orders")
        .select("id, workspace_id, crm_company_id, total, status, created_at")
        .not("crm_company_id", "is", null)
        .in("status", ["confirmed", "processing", "shipped", "delivered"]);

      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);
      const twoYearsAgo = new Date(now.getTime() - 730 * 86_400_000);

      type CustAgg = {
        wsId: string; companyId: string; spend12m: number; spendPrior12m: number;
        orderCount12m: number; lastOrderDate: string | null;
        monthlySpend: Map<string, number>;
      };

      const custAgg = new Map<string, CustAgg>();

      for (const o of orderData ?? []) {
        const coId = o.crm_company_id as string;
        const wsId = o.workspace_id as string;
        const key = `${wsId}:${coId}`;
        const createdAt = new Date(o.created_at as string);
        const total = Number(o.total) || 0;

        if (!custAgg.has(key)) {
          custAgg.set(key, { wsId, companyId: coId, spend12m: 0, spendPrior12m: 0, orderCount12m: 0, lastOrderDate: null, monthlySpend: new Map() });
        }
        const agg = custAgg.get(key)!;

        if (createdAt >= oneYearAgo) {
          agg.spend12m += total;
          agg.orderCount12m++;
        } else if (createdAt >= twoYearsAgo) {
          agg.spendPrior12m += total;
        }

        if (!agg.lastOrderDate || (o.created_at as string) > agg.lastOrderDate) {
          agg.lastOrderDate = o.created_at as string;
        }

        const month = (o.created_at as string).slice(0, 7);
        agg.monthlySpend.set(month, (agg.monthlySpend.get(month) ?? 0) + total);
      }

      // Fleet data
      const { data: fleetData } = await supabase
        .from("customer_fleet")
        .select("portal_customer_id, is_active, next_service_due, portal_customers!inner ( crm_company_id )")
        .eq("is_active", true);

      type FleetAgg = { count: number; approaching: number };
      const fleetByCompany = new Map<string, FleetAgg>();
      for (const f of fleetData ?? []) {
        const co = (f as unknown as { portal_customers: { crm_company_id: string } }).portal_customers;
        if (!co?.crm_company_id) continue;
        if (!fleetByCompany.has(co.crm_company_id)) fleetByCompany.set(co.crm_company_id, { count: 0, approaching: 0 });
        const agg = fleetByCompany.get(co.crm_company_id)!;
        agg.count++;
        if (f.next_service_due) {
          const due = new Date(f.next_service_due as string);
          if (due.getTime() - now.getTime() < 90 * 86_400_000) agg.approaching++;
        }
      }

      // Compute intelligence rows
      const intelBatch: Record<string, unknown>[] = [];

      for (const [, agg] of custAgg) {
        const daysSinceLast = agg.lastOrderDate
          ? Math.ceil((now.getTime() - new Date(agg.lastOrderDate).getTime()) / 86_400_000)
          : null;

        let spendTrend: string;
        if (agg.spendPrior12m === 0 && agg.spend12m > 0) spendTrend = "new";
        else if (agg.spend12m === 0 && agg.spendPrior12m > 0) spendTrend = "churned";
        else if (agg.spend12m > agg.spendPrior12m * 1.15) spendTrend = "growing";
        else if (agg.spend12m < agg.spendPrior12m * 0.85) spendTrend = "declining";
        else spendTrend = "stable";

        let churnRisk: string;
        if (daysSinceLast == null || daysSinceLast > 180) churnRisk = "high";
        else if (daysSinceLast > 90) churnRisk = "medium";
        else if (spendTrend === "declining") churnRisk = "low";
        else churnRisk = "none";

        const fleet = fleetByCompany.get(agg.companyId) ?? { count: 0, approaching: 0 };
        const predicted = fleet.approaching * (agg.orderCount12m > 0 ? agg.spend12m / agg.orderCount12m : 500);

        let outreach: string | null = null;
        if (churnRisk === "high" && fleet.count > 0) {
          outreach = `Customer hasn't ordered in ${daysSinceLast ?? "??"} days but has ${fleet.count} active fleet units. Potential re-engagement opportunity.`;
        } else if (fleet.approaching > 0) {
          outreach = `${fleet.approaching} machine(s) approaching service. Predicted parts need: $${predicted.toFixed(0)}.`;
        }

        const monthlySpend = [...agg.monthlySpend.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-12)
          .map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }));

        intelBatch.push({
          workspace_id: agg.wsId,
          crm_company_id: agg.companyId,
          total_spend_12m: Math.round(agg.spend12m * 100) / 100,
          total_spend_prior_12m: Math.round(agg.spendPrior12m * 100) / 100,
          spend_trend: spendTrend,
          monthly_spend: monthlySpend,
          order_count_12m: agg.orderCount12m,
          avg_order_value: agg.orderCount12m > 0 ? Math.round((agg.spend12m / agg.orderCount12m) * 100) / 100 : 0,
          last_order_date: agg.lastOrderDate?.slice(0, 10) ?? null,
          days_since_last_order: daysSinceLast,
          fleet_count: fleet.count,
          machines_approaching_service: fleet.approaching,
          predicted_next_quarter_spend: Math.round(predicted * 100) / 100,
          churn_risk: churnRisk,
          recommended_outreach: outreach,
          opportunity_value: Math.round(predicted * 100) / 100,
          computed_at: now.toISOString(),
          computation_batch_id: batchId,
        });
      }

      const CHUNK = 100;
      for (let i = 0; i < intelBatch.length; i += CHUNK) {
        const chunk = intelBatch.slice(i, i + CHUNK);
        const { error: intelErr } = await supabase
          .from("customer_parts_intelligence")
          .upsert(chunk, { onConflict: "workspace_id,crm_company_id" });
        if (intelErr) {
          console.error("customer intel upsert:", intelErr);
          results.errors++;
        } else {
          results.customer_intel_computed += chunk.length;
        }
      }
    } catch (e) {
      console.error("customer intel error:", e);
      results.errors++;
    }

    const elapsedMs = Date.now() - startMs;

    await logServiceCronRun(supabase, {
      jobName: "parts-network-optimizer",
      ok: results.errors === 0,
      metadata: { results, elapsed_ms: elapsedMs, batch_id: batchId },
    });

    return safeJsonOk({ ok: true, results, elapsed_ms: elapsedMs }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-network-optimizer", req });
    console.error("parts-network-optimizer error:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "parts-network-optimizer",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch { /* ignore logging failures */ }
    return safeJsonError("Internal server error", 500, null);
  }
});
