/**
 * Parts auto-replenish handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot widen or retarget scope.
 *
 * Service role: unscoped (all shops) when no workspace hint, or optional
 * x-workspace-id / body.workspace / body.workspace_id for one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const VENDOR_SCORE_WEIGHTS = {
  lead_time: 0.25,
  fill_rate: 0.30,
  responsiveness: 0.25,
  price: 0.20,
} as const;

export interface RequestBody {
  workspace?: string | null;
  workspace_id?: string | null;
}

export type AutoReplenishWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type AutoReplenishAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

interface ReorderRow {
  workspace_id: string;
  branch_id: string;
  part_number: string;
  qty_on_hand: number;
  reorder_point: number;
  economic_order_qty: number | null;
  consumption_velocity: number | null;
}

interface VendorPartRow {
  vendor_id: string;
  part_number: string;
  unit_cost: number | null;
  lead_time_days: number | null;
  is_preferred: boolean;
}

interface VendorProfile {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  price_competitiveness: number | null;
  machine_down_priority: boolean;
}

interface ReplenishRule {
  is_enabled: boolean;
  auto_approve_max_dollars: number;
  daily_budget_cap: number;
  cooldown_days: number;
  excluded_part_numbers: string[];
  vendor_overrides: Record<string, string>;
}

export function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0 || internalSecret.length > 0;
}

export function resolveAutoReplenishWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): AutoReplenishWorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.headerWorkspaceId);
    if (explicit) {
      return { mode: "scoped", workspaceId: explicit };
    }
    return { mode: "unscoped" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  if (!workspaceId) {
    return { mode: "scoped", workspaceId: "" };
  }
  return { mode: "scoped", workspaceId };
}

export function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: AutoReplenishWorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

export async function authenticateAutoReplenish(
  req: Request,
  adminClient: SupabaseClient,
): Promise<AutoReplenishAuthResult> {
  if (isServiceRoleCaller(req)) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: normalizeWorkspaceId(req.headers.get("x-workspace-id")),
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  const caller = await resolveCallerContext(req, adminClient);

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (!["admin", "manager", "owner"].includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
  };
}

async function readRequestBody(req: Request): Promise<RequestBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as RequestBody;
}

export function computeVendorScore(
  vendor: VendorProfile,
  vpc: VendorPartRow | null,
  allVpcCosts: number[],
): { score: number; reason: string } {
  const leadHours = vpc?.lead_time_days != null
    ? vpc.lead_time_days * 24
    : (vendor.avg_lead_time_hours ?? 168);
  const maxLeadHours = 720;
  const leadScore = 1 - Math.min(leadHours, maxLeadHours) / maxLeadHours;

  const fillScore = vendor.fill_rate ?? 0.5;
  const respScore = Math.min(vendor.responsiveness_score ?? 0.5, 1);

  let priceScore = 0.5;
  if (vpc?.unit_cost != null && allVpcCosts.length > 1) {
    const minCost = Math.min(...allVpcCosts);
    const maxCost = Math.max(...allVpcCosts);
    priceScore = maxCost > minCost
      ? 1 - (vpc.unit_cost - minCost) / (maxCost - minCost)
      : 0.5;
  }

  const score =
    VENDOR_SCORE_WEIGHTS.lead_time * leadScore +
    VENDOR_SCORE_WEIGHTS.fill_rate * fillScore +
    VENDOR_SCORE_WEIGHTS.responsiveness * respScore +
    VENDOR_SCORE_WEIGHTS.price * priceScore;

  const parts: string[] = [];
  if (leadScore >= 0.7) parts.push("fast_delivery");
  if (fillScore >= 0.8) parts.push("high_fill_rate");
  if (respScore >= 0.7) parts.push("responsive");
  if (priceScore >= 0.7) parts.push("competitive_price");
  if (vendor.machine_down_priority) parts.push("machine_down_priority");

  return {
    score: Math.round(score * 10000) / 10000,
    reason: parts.join(", ") || "baseline_score",
  };
}

export interface AutoReplenishHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<AutoReplenishAuthResult>;
}

const defaultDependencies: AutoReplenishHandlerDependencies = {
  createAdminClient,
  authenticate: authenticateAutoReplenish,
};

export async function handlePartsAutoReplenish(
  req: Request,
  overrides: Partial<AutoReplenishHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError("Missing SUPABASE_URL / SERVICE_ROLE_KEY", 500, origin);
    }

    const adminClient = createClientFn();
    const auth = await authenticate(req, adminClient);
    if (!auth.ok) {
      const message = auth.status === 401 ? "Unauthorized" : "Forbidden";
      return safeJsonError(message, auth.status, origin);
    }

    if (req.method === "GET") {
      return safeJsonOk({
        ok: true,
        function: "parts-auto-replenish",
        ts: new Date().toISOString(),
      }, origin);
    }

    const body = await readRequestBody(req);
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace) ??
      normalizeWorkspaceId(body.workspace_id);

    const workspaceScope = auth.isServiceRole
      ? resolveAutoReplenishWorkspace({
        isServiceRole: true,
        headerWorkspaceId: auth.headerWorkspaceId,
        requestedWorkspaceId,
      })
      : resolveAutoReplenishWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId,
      });

    if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const supabase = adminClient;
    const batchId = `auto-replenish-${new Date().toISOString().slice(0, 13)}`;
    const scopedWorkspaceId = workspaceScope.mode === "scoped"
      ? workspaceScope.workspaceId
      : null;

    const results = {
      items_below_rop: 0,
      queue_entries_created: 0,
      auto_approved: 0,
      pending_approval: 0,
      scheduled_for_future: 0,
      forecast_driven_sizing: 0,
      vendor_price_corroborated: 0,
      potential_overpay_flags: 0,
      skipped_cooldown: 0,
      skipped_excluded: 0,
      skipped_disabled: 0,
      vendor_scores_updated: 0,
      errors: 0,
    };

    let reorderQuery = supabase
      .from("parts_inventory_reorder_status")
      .select(
        "workspace_id, branch_id, part_number, qty_on_hand, reorder_point, economic_order_qty, consumption_velocity",
      )
      .in("stock_status", ["stockout", "critical", "reorder"]);
    reorderQuery = applyWorkspaceFilter(reorderQuery, workspaceScope);

    const { data: reorderRows, error: roErr } = await reorderQuery;

    if (roErr) {
      console.warn("parts-auto-replenish: view not available, trying direct join");
      let invQuery = supabase
        .from("parts_inventory")
        .select("workspace_id, branch_id, part_number, qty_on_hand")
        .is("deleted_at", null);
      invQuery = applyWorkspaceFilter(invQuery, workspaceScope);

      const { data: invRows, error: invErr } = await invQuery;
      if (invErr) {
        return safeJsonError("Failed to fetch inventory", 500, origin);
      }
      if (!invRows?.length) {
        await logServiceCronRun(supabase, {
          jobName: "parts-auto-replenish",
          workspaceId: scopedWorkspaceId ?? undefined,
          ok: true,
          metadata: {
            results,
            note: "no inventory, view unavailable",
            workspace_scope: workspaceScope.mode,
            workspace_id: scopedWorkspaceId,
          },
        });
        return safeJsonOk({
          ok: true,
          results,
          workspace_scope: workspaceScope.mode,
          workspace_id: scopedWorkspaceId,
        }, origin);
      }
      await logServiceCronRun(supabase, {
        jobName: "parts-auto-replenish",
        workspaceId: scopedWorkspaceId ?? undefined,
        ok: true,
        metadata: {
          results,
          note: "reorder view unavailable; run parts-reorder-compute first",
          workspace_scope: workspaceScope.mode,
          workspace_id: scopedWorkspaceId,
        },
      });
      return safeJsonOk({
        ok: true,
        results,
        note: "reorder view unavailable",
        workspace_scope: workspaceScope.mode,
        workspace_id: scopedWorkspaceId,
      }, origin);
    }

    if (!reorderRows?.length) {
      await logServiceCronRun(supabase, {
        jobName: "parts-auto-replenish",
        workspaceId: scopedWorkspaceId ?? undefined,
        ok: true,
        metadata: {
          results,
          note: "all inventory above reorder points",
          workspace_scope: workspaceScope.mode,
          workspace_id: scopedWorkspaceId,
        },
      });
      return safeJsonOk({
        ok: true,
        results,
        workspace_scope: workspaceScope.mode,
        workspace_id: scopedWorkspaceId,
      }, origin);
    }

    results.items_below_rop = reorderRows.length;

    let rulesQuery = supabase
      .from("parts_replenishment_rules")
      .select("*");
    rulesQuery = applyWorkspaceFilter(rulesQuery, workspaceScope);
    const { data: ruleRows } = await rulesQuery;

    const ruleMap = new Map<string, ReplenishRule>();
    for (const r of ruleRows ?? []) {
      ruleMap.set(r.workspace_id, {
        is_enabled: r.is_enabled ?? false,
        auto_approve_max_dollars: Number(r.auto_approve_max_dollars) || 500,
        daily_budget_cap: Number(r.daily_budget_cap) || 0,
        cooldown_days: Number(r.cooldown_days) || 3,
        excluded_part_numbers: (r.excluded_part_numbers as string[]) ?? [],
        vendor_overrides: (r.vendor_overrides as Record<string, string>) ?? {},
      });
    }

    let queueQuery = supabase
      .from("parts_auto_replenish_queue")
      .select("workspace_id, part_number, branch_id, created_at")
      .in("status", ["pending", "approved", "auto_approved", "ordered"]);
    queueQuery = applyWorkspaceFilter(queueQuery, workspaceScope);
    const { data: existingQueue } = await queueQuery;

    const cooldownSet = new Set<string>();
    for (const eq of existingQueue ?? []) {
      cooldownSet.add(`${eq.workspace_id}:${eq.part_number}:${eq.branch_id}`);
    }

    const { data: vendorProfiles } = await supabase
      .from("vendor_profiles")
      .select("id, name, avg_lead_time_hours, responsiveness_score, fill_rate, price_competitiveness, machine_down_priority");

    const vendorMap = new Map<string, VendorProfile>();
    for (const v of vendorProfiles ?? []) {
      vendorMap.set(v.id, v as VendorProfile);
    }

    let vpcQuery = supabase
      .from("vendor_part_catalog")
      .select("workspace_id, vendor_id, part_number, unit_cost, lead_time_days, is_preferred")
      .eq("is_active", true);
    vpcQuery = applyWorkspaceFilter(vpcQuery, workspaceScope);
    const { data: vpcRows } = await vpcQuery;

    const vpcByWsPart = new Map<string, VendorPartRow[]>();
    for (const vpc of vpcRows ?? []) {
      const key = `${(vpc as Record<string, unknown>).workspace_id ?? "default"}:${(vpc.part_number as string).toLowerCase()}`;
      const arr = vpcByWsPart.get(key) ?? [];
      arr.push(vpc as VendorPartRow);
      vpcByWsPart.set(key, arr);
    }

    let catalogQuery = supabase
      .from("parts_catalog")
      .select("part_number, workspace_id, branch_code, cost_price, list_price, lead_time_days, safety_stock_qty, vendor_code, machine_code")
      .is("deleted_at", null);
    catalogQuery = applyWorkspaceFilter(catalogQuery, workspaceScope);
    const { data: catalogRows } = await catalogQuery;

    const costMap = new Map<string, number>();
    const catalogMeta = new Map<string, { lead_time_days: number | null; safety_stock_qty: number | null; vendor_code: string | null; branch_code: string | null }>();
    for (const c of catalogRows ?? []) {
      const cost = Number(c.cost_price) || Number(c.list_price) || 0;
      const pnKey = `${c.workspace_id}:${(c.part_number as string).toLowerCase()}`;
      if (cost > 0) costMap.set(pnKey, cost);
      catalogMeta.set(pnKey, {
        lead_time_days: c.lead_time_days != null ? Number(c.lead_time_days) : null,
        safety_stock_qty: c.safety_stock_qty != null ? Number(c.safety_stock_qty) : null,
        vendor_code: (c.vendor_code as string | null) ?? null,
        branch_code: (c.branch_code as string | null) ?? null,
      });
    }

    let forecastQuery = supabase
      .from("parts_demand_forecasts")
      .select("workspace_id, part_number, branch_id, predicted_qty, forecast_month")
      .gte("forecast_month", new Date().toISOString().slice(0, 10));
    forecastQuery = applyWorkspaceFilter(forecastQuery, workspaceScope);
    const { data: forecastRows } = await forecastQuery;

    const forecastMap = new Map<string, number>();
    const forecastCountMap = new Map<string, number>();
    for (const f of forecastRows ?? []) {
      const key = `${f.workspace_id}:${(f.part_number as string).toLowerCase()}:${f.branch_id}`;
      forecastMap.set(key, (forecastMap.get(key) ?? 0) + Number(f.predicted_qty));
      forecastCountMap.set(key, (forecastCountMap.get(key) ?? 0) + 1);
    }

    const { data: scheduleRows } = await supabase
      .from("vendor_order_schedules")
      .select("vendor_id, branch_code, frequency, day_of_week, is_active")
      .eq("is_active", true);

    const scheduleByVendor = new Map<string, Array<{ branch_code: string; frequency: string; day_of_week: string | null }>>();
    for (const s of scheduleRows ?? []) {
      const arr = scheduleByVendor.get(s.vendor_id as string) ?? [];
      arr.push({
        branch_code: (s.branch_code as string) ?? "",
        frequency: (s.frequency as string) ?? "on_demand",
        day_of_week: (s.day_of_week as string | null) ?? null,
      });
      scheduleByVendor.set(s.vendor_id as string, arr);
    }

    function resolveScheduledFor(vendorId: string, branch: string, fromDate: Date): Date | null {
      const entries = scheduleByVendor.get(vendorId);
      if (!entries || entries.length === 0) return null;
      const preferred = entries.find((e) => e.branch_code === branch) ?? entries.find((e) => e.branch_code === "") ?? entries[0];
      if (preferred.frequency === "daily" || preferred.frequency === "on_demand") return fromDate;
      if (!preferred.day_of_week) return fromDate;
      const dowMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
      };
      const target = dowMap[preferred.day_of_week.toLowerCase()] ?? 1;
      const today = fromDate.getDay();
      const daysAhead = (target - today + 7) % 7;
      const next = new Date(fromDate);
      next.setDate(next.getDate() + daysAhead);
      if (preferred.frequency === "biweekly" && daysAhead === 0) {
        const weekNum = Math.floor((next.getTime() / (1000 * 60 * 60 * 24) + 4) / 7);
        if (weekNum % 2 === 0) next.setDate(next.getDate() + 7);
      }
      return next;
    }

    const { data: vendorPriceRows } = await supabase
      .from("parts_vendor_prices")
      .select("vendor_id, part_number, list_price, effective_date")
      .order("effective_date", { ascending: false });

    const vendorPriceMap = new Map<string, number>();
    for (const vp of vendorPriceRows ?? []) {
      const key = `${vp.vendor_id}:${(vp.part_number as string).toLowerCase()}`;
      if (!vendorPriceMap.has(key) && vp.list_price != null) {
        vendorPriceMap.set(key, Number(vp.list_price));
      }
    }

    const queueInserts: Record<string, unknown>[] = [];
    const vendorScoreUpdates = new Map<string, { composite: number; parts: string }>();

    for (const item of reorderRows as ReorderRow[]) {
      if (scopedWorkspaceId && item.workspace_id !== scopedWorkspaceId) {
        continue;
      }

      const rule = ruleMap.get(item.workspace_id);

      if (!rule || !rule.is_enabled) {
        results.skipped_disabled++;
        continue;
      }

      if (rule.excluded_part_numbers.includes(item.part_number)) {
        results.skipped_excluded++;
        continue;
      }

      const cooldownKey = `${item.workspace_id}:${item.part_number}:${item.branch_id}`;
      if (cooldownSet.has(cooldownKey)) {
        results.skipped_cooldown++;
        continue;
      }

      const pnKey = `${item.workspace_id}:${item.part_number.toLowerCase()}`;
      const meta = catalogMeta.get(pnKey);
      const forecastKey = `${item.workspace_id}:${item.part_number.toLowerCase()}:${item.branch_id}`;
      const forecastTotal = forecastMap.get(forecastKey);
      const forecastMonths = forecastCountMap.get(forecastKey) ?? 0;
      const leadTimeDays = meta?.lead_time_days ?? 14;
      const safetyStockQty = meta?.safety_stock_qty ?? 0;

      let forecastBasedQty: number | null = null;
      let forecastCoveredDays: number | null = null;
      if (forecastTotal != null && forecastMonths > 0) {
        const monthlyAvg = forecastTotal / forecastMonths;
        const dailyVelocity = monthlyAvg / 30;
        const targetCover = dailyVelocity * (leadTimeDays + 30) + safetyStockQty;
        forecastBasedQty = Math.max(0, Math.ceil(targetCover - item.qty_on_hand));
        forecastCoveredDays = leadTimeDays + 30;
      }

      const naiveQty = Math.max(
        item.economic_order_qty ?? 1,
        (item.reorder_point ?? 1) - item.qty_on_hand,
      );

      const orderQty = forecastBasedQty != null
        ? Math.max(forecastBasedQty, item.economic_order_qty ?? 1)
        : naiveQty;

      const forecastDriven = forecastBasedQty != null;
      if (forecastDriven) results.forecast_driven_sizing++;

      const partVpcs = vpcByWsPart.get(`${item.workspace_id}:${item.part_number.toLowerCase()}`) ?? [];
      const allCosts = partVpcs
        .filter((v) => v.unit_cost != null)
        .map((v) => v.unit_cost!);

      let bestVendorId: string | null = null;
      let bestScore = -1;
      let bestReason = "no_vendors_mapped";
      let bestUnitCost: number | null = null;

      const overrideVendorId = rule.vendor_overrides[item.part_number];
      if (overrideVendorId && vendorMap.has(overrideVendorId)) {
        bestVendorId = overrideVendorId;
        bestScore = 1;
        bestReason = "workspace_vendor_override";
        const overrideVpc = partVpcs.find((v) => v.vendor_id === overrideVendorId);
        bestUnitCost = overrideVpc?.unit_cost ?? null;
      } else {
        for (const vpc of partVpcs) {
          const vendor = vendorMap.get(vpc.vendor_id);
          if (!vendor) continue;

          const { score, reason } = computeVendorScore(vendor, vpc, allCosts);
          const adjustedScore = vpc.is_preferred ? score + 0.05 : score;

          if (adjustedScore > bestScore) {
            bestScore = adjustedScore;
            bestVendorId = vpc.vendor_id;
            bestReason = vpc.is_preferred ? `preferred, ${reason}` : reason;
            bestUnitCost = vpc.unit_cost;
          }

          vendorScoreUpdates.set(vpc.vendor_id, {
            composite: score,
            parts: reason,
          });
        }

        if (!bestVendorId && vendorMap.size > 0) {
          for (const [vId, vendor] of vendorMap) {
            const { score, reason } = computeVendorScore(vendor, null, []);
            if (score > bestScore) {
              bestScore = score;
              bestVendorId = vId;
              bestReason = `fallback_no_mapping, ${reason}`;
            }
          }
        }
      }

      const unitCost = bestUnitCost ??
        costMap.get(`${item.workspace_id}:${item.part_number.toLowerCase()}`) ??
        null;
      const estimatedTotal = unitCost != null ? unitCost * orderQty : null;

      let cdkVendorListPrice: number | null = null;
      let vendorPriceCorroborated = false;
      let potentialOverpay = false;
      if (bestVendorId && unitCost != null) {
        const vpKey = `${bestVendorId}:${item.part_number.toLowerCase()}`;
        const vpListPrice = vendorPriceMap.get(vpKey) ?? null;
        if (vpListPrice != null) {
          cdkVendorListPrice = vpListPrice;
          vendorPriceCorroborated = true;
          results.vendor_price_corroborated++;
          if (unitCost > vpListPrice * 1.05) {
            potentialOverpay = true;
            results.potential_overpay_flags++;
          }
        }
      }

      let scheduledFor: string | null = null;
      let status = "pending";
      if (bestVendorId) {
        const now = new Date();
        const nextOrderDate = resolveScheduledFor(bestVendorId, item.branch_id, now);
        if (nextOrderDate && nextOrderDate.toDateString() !== now.toDateString()) {
          scheduledFor = nextOrderDate.toISOString().slice(0, 10);
          status = "scheduled";
          results.scheduled_for_future++;
        }
      }

      const shouldAutoApprove =
        status !== "scheduled" &&
        estimatedTotal != null && estimatedTotal <= rule.auto_approve_max_dollars;

      if (shouldAutoApprove) status = "auto_approved";

      queueInserts.push({
        workspace_id: item.workspace_id,
        part_number: item.part_number,
        branch_id: item.branch_id,
        qty_on_hand: item.qty_on_hand,
        reorder_point: item.reorder_point,
        recommended_qty: orderQty,
        economic_order_qty: item.economic_order_qty,
        selected_vendor_id: bestVendorId,
        vendor_score: bestScore >= 0 ? bestScore : null,
        vendor_selection_reason: potentialOverpay
          ? `${bestReason} (⚠ overpay flag)`
          : bestReason,
        estimated_unit_cost: unitCost,
        estimated_total: estimatedTotal,
        status,
        approved_at: shouldAutoApprove ? new Date().toISOString() : null,
        computation_batch_id: batchId,
        scheduled_for: scheduledFor,
        forecast_driven: forecastDriven,
        forecast_covered_days: forecastCoveredDays,
        vendor_price_corroborated: vendorPriceCorroborated,
        cdk_vendor_list_price: cdkVendorListPrice,
        potential_overpay_flag: potentialOverpay,
      });

      if (shouldAutoApprove) {
        results.auto_approved++;
      } else if (status !== "scheduled") {
        results.pending_approval++;
      }
    }

    const scopedInserts = scopedWorkspaceId
      ? queueInserts.filter((row) => row.workspace_id === scopedWorkspaceId)
      : queueInserts;

    const CHUNK = 100;
    for (let i = 0; i < scopedInserts.length; i += CHUNK) {
      const chunk = scopedInserts.slice(i, i + CHUNK);
      const { error: qErr } = await supabase
        .from("parts_auto_replenish_queue")
        .insert(chunk);
      if (qErr) {
        console.error(`parts-auto-replenish queue insert chunk ${i}:`, qErr);
        results.errors++;
      } else {
        results.queue_entries_created += chunk.length;
      }
    }

    for (const [vendorId, { composite }] of vendorScoreUpdates) {
      const { error: vsErr } = await supabase
        .from("vendor_profiles")
        .update({
          composite_score: composite,
          score_computed_at: new Date().toISOString(),
        })
        .eq("id", vendorId);
      if (vsErr) {
        console.warn(`parts-auto-replenish vendor score update ${vendorId}:`, vsErr);
      } else {
        results.vendor_scores_updated++;
      }
    }

    const elapsedMs = Date.now() - startMs;
    const calledBy = auth.isServiceRole
      ? "cron"
      : `user:${auth.userId}`;

    await logServiceCronRun(supabase, {
      jobName: "parts-auto-replenish",
      workspaceId: scopedWorkspaceId ?? undefined,
      ok: results.errors === 0,
      metadata: {
        results,
        elapsed_ms: elapsedMs,
        batch_id: batchId,
        workspace_scope: workspaceScope.mode,
        workspace_id: scopedWorkspaceId,
        called_by: calledBy,
      },
    });

    return safeJsonOk({
      ok: true,
      called_by: calledBy,
      results,
      elapsed_ms: elapsedMs,
      workspace_scope: workspaceScope.mode,
      workspace_id: scopedWorkspaceId,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError(err.message, 400, origin);
    }
    captureEdgeException(err, { fn: "parts-auto-replenish", req });
    console.error("parts-auto-replenish error:", err);
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
        await logServiceCronRun(supabase, {
          jobName: "parts-auto-replenish",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch { /* ignore secondary logging failures */ }
    return safeJsonError("Internal server error", 500, origin);
  }
}
