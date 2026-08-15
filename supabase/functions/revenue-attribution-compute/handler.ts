/**
 * Revenue Attribution Compute handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (rep/admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id and foreign deal_id cannot widen scope.
 *
 * Service role / cron: unscoped when no workspace hint (nightly scan-recent-wins),
 * or optional x-workspace-id / body.workspace / body.workspace_id to narrow.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  createAdminClient,
  resolveCallerContext,
  type CallerContext,
} from "../_shared/dge-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

export interface Touch {
  source_table: string;
  source_id: string;
  touch_type: string;
  occurred_at: string;
}

interface DealRow {
  id: string;
  amount: number | null;
  closed_at: string | null;
  company_id: string | null;
  workspace_id: string;
}

interface DealEquipmentRow {
  role: string | null;
  crm_equipment: {
    vin_pin: string | null;
  } | {
    vin_pin: string | null;
  }[] | null;
}

export interface RequestBody {
  deal_id?: string;
  deal_ids?: string[];
  workspace?: string | null;
  workspace_id?: string | null;
}

export type RevenueAttributionWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type RevenueAttributionAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export interface RevenueAttributionHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  resolveCallerContext: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<CallerContext>;
  isServiceRoleCaller: (req: Request) => boolean;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
    deps: Pick<
      RevenueAttributionHandlerDependencies,
      "resolveCallerContext" | "isServiceRoleCaller"
    >,
  ) => Promise<RevenueAttributionAuthResult>;
}

const defaultDependencies: RevenueAttributionHandlerDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
  authenticate: authenticateRevenueAttribution,
};

function resolveDependencies(
  overrides: Partial<RevenueAttributionHandlerDependencies> = {},
): RevenueAttributionHandlerDependencies {
  return { ...defaultDependencies, ...overrides };
}

export function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveRevenueAttributionWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): RevenueAttributionWorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.authWorkspaceId);
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isLegacyServiceKeyValid(req: Request): boolean {
  const providedServiceKey = req.headers.get("x-service-role-key")?.trim();
  const expectedServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  return providedServiceKey !== undefined &&
    providedServiceKey !== "" &&
    expectedServiceKey.length > 0 &&
    providedServiceKey.length === expectedServiceKey.length &&
    timingSafeEqual(providedServiceKey, expectedServiceKey);
}

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  const legacyServiceKey = (req.headers.get("x-service-role-key") ?? "").trim();
  return authHeader.length > 0 ||
    apiKey.length > 0 ||
    internalSecret.length > 0 ||
    legacyServiceKey.length > 0;
}

export async function authenticateRevenueAttribution(
  req: Request,
  adminClient: SupabaseClient,
  deps: Pick<
    RevenueAttributionHandlerDependencies,
    "resolveCallerContext" | "isServiceRoleCaller"
  >,
): Promise<RevenueAttributionAuthResult> {
  const legacyServiceKey = isLegacyServiceKeyValid(req);
  const cronCaller = deps.isServiceRoleCaller(req);
  if (legacyServiceKey || cronCaller) {
    return { ok: true, isServiceRole: true };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  const caller = await deps.resolveCallerContext(req, adminClient);
  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
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

export function dealAccessibleInScope(
  deal: Pick<DealRow, "workspace_id"> | null,
  scope: RevenueAttributionWorkspaceScope,
): boolean {
  if (!deal) return false;
  if (scope.mode === "unscoped") return true;
  return deal.workspace_id === scope.workspaceId;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function readRequestBody(req: Request): Promise<RequestBody> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as RequestBody;
}

async function resolveDealIds(
  action: string,
  body: RequestBody,
  supabaseAdmin: SupabaseClient,
  scope: RevenueAttributionWorkspaceScope,
  origin: string | null,
): Promise<{ ok: true; dealIds: string[] } | { ok: false; response: Response }> {
  if (action === "compute") {
    const dealId = normalizeWorkspaceId(body.deal_id);
    if (!dealId) {
      return { ok: false, response: safeJsonError("deal_id required", 400, origin) };
    }
    return { ok: true, dealIds: [dealId] };
  }

  if (action === "batch") {
    const dealIds = Array.isArray(body.deal_ids)
      ? body.deal_ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .slice(0, 50)
      : [];
    if (dealIds.length === 0) {
      return { ok: false, response: safeJsonError("deal_ids[] required", 400, origin) };
    }
    return { ok: true, dealIds };
  }

  if (action === "scan-recent-wins") {
    let query = supabaseAdmin
      .from("qrm_deals")
      .select("id")
      .gt("closed_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .not("closed_at", "is", null)
      .gt("amount", 0)
      .limit(100);

    if (scope.mode === "scoped") {
      query = query.eq("workspace_id", scope.workspaceId);
    }

    const { data: recent } = await query;
    return {
      ok: true,
      dealIds: (recent ?? []).map((row) => (row as { id: string }).id),
    };
  }

  return { ok: false, response: safeJsonError("Not found", 404, origin) };
}

async function loadVoiceCapturesForDeal(
  supabaseAdmin: SupabaseClient,
  dealId: string,
  scope: RevenueAttributionWorkspaceScope,
): Promise<Touch[]> {
  const touches: Touch[] = [];

  try {
    let query = supabaseAdmin
      .from("voice_captures")
      .select("id, created_at, linked_deal_id, extracted_data, workspace_id")
      .eq("linked_deal_id", dealId)
      .order("created_at", { ascending: true });

    if (scope.mode === "scoped") {
      query = query.eq("workspace_id", scope.workspaceId);
    }

    const { data: linkedRows } = await query;
    for (const row of linkedRows ?? []) {
      touches.push({
        source_table: "voice_captures",
        source_id: String((row as { id: string }).id),
        touch_type: "voice_capture",
        occurred_at: String((row as { created_at: string }).created_at),
      });
    }

    if (scope.mode === "scoped") {
      const { data: legacyRows } = await supabaseAdmin
        .from("voice_captures")
        .select("id, created_at, extracted_data, workspace_id")
        .is("linked_deal_id", null)
        .eq("workspace_id", scope.workspaceId)
        .order("created_at", { ascending: true });

      for (const row of legacyRows ?? []) {
        const extracted = (row as { extracted_data?: Record<string, unknown> }).extracted_data ?? {};
        const legacyDealId = extracted.deal_id ?? extracted.dealId;
        if (legacyDealId !== dealId) continue;
        if (touches.some((touch) => touch.source_id === String((row as { id: string }).id))) {
          continue;
        }
        touches.push({
          source_table: "voice_captures",
          source_id: String((row as { id: string }).id),
          touch_type: "voice_capture",
          occurred_at: String((row as { created_at: string }).created_at),
        });
      }
    }
  } catch {
    // voice_captures may not exist on every deployment
  }

  return touches;
}

async function computeDealAttribution(
  supabaseAdmin: SupabaseClient,
  dealId: string,
  scope: RevenueAttributionWorkspaceScope,
): Promise<{ deal_id: string; touches: number; models_persisted: number; error?: string }> {
  const { data: deal } = await supabaseAdmin
    .from("qrm_deals")
    .select("id, amount, closed_at, company_id, workspace_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!dealAccessibleInScope(deal as DealRow | null, scope)) {
    return {
      deal_id: dealId,
      touches: 0,
      models_persisted: 0,
      error: "deal not found",
    };
  }

  if (!deal?.closed_at) {
    return { deal_id: dealId, touches: 0, models_persisted: 0, error: "deal not closed" };
  }

  const dealAmount = Number(deal.amount ?? 0);
  const closedAt = new Date(deal.closed_at as string).getTime();
  const touches: Touch[] = [];

  const { data: acts } = await supabaseAdmin
    .from("qrm_activities")
    .select("id, activity_type, occurred_at")
    .eq("deal_id", dealId)
    .order("occurred_at", { ascending: true });
  for (const activity of acts ?? []) {
    touches.push({
      source_table: "qrm_activities",
      source_id: (activity as { id: string }).id,
      touch_type: String((activity as { activity_type?: string }).activity_type ?? "activity"),
      occurred_at: String((activity as { occurred_at: string }).occurred_at),
    });
  }

  touches.push(...await loadVoiceCapturesForDeal(supabaseAdmin, dealId, scope));

  if (touches.length === 0) {
    return { deal_id: dealId, touches: 0, models_persisted: 0, error: "no touches found" };
  }

  touches.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const models: Array<{
    model: string;
    chain: Array<Touch & { weight: number; attributed: number }>;
    total: number;
  }> = [];

  models.push({
    model: "first_touch",
    chain: touches.map((touch, index) => ({
      ...touch,
      weight: index === 0 ? 1 : 0,
      attributed: index === 0 ? dealAmount : 0,
    })),
    total: dealAmount,
  });

  models.push({
    model: "last_touch",
    chain: touches.map((touch, index) => ({
      ...touch,
      weight: index === touches.length - 1 ? 1 : 0,
      attributed: index === touches.length - 1 ? dealAmount : 0,
    })),
    total: dealAmount,
  });

  const linearWeight = 1 / touches.length;
  models.push({
    model: "linear",
    chain: touches.map((touch) => ({
      ...touch,
      weight: linearWeight,
      attributed: dealAmount * linearWeight,
    })),
    total: dealAmount,
  });

  const halfLifeMs = 7 * 86_400_000;
  const decayWeights = touches.map((touch) => {
    const ageMs = closedAt - new Date(touch.occurred_at).getTime();
    return Math.pow(0.5, Math.max(0, ageMs) / halfLifeMs);
  });
  const decaySum = decayWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  models.push({
    model: "time_decay",
    chain: touches.map((touch, index) => ({
      ...touch,
      weight: decayWeights[index] / decaySum,
      attributed: dealAmount * (decayWeights[index] / decaySum),
    })),
    total: dealAmount,
  });

  let persisted = 0;
  for (const model of models) {
    const { error: upErr } = await supabaseAdmin
      .from("revenue_attribution")
      .upsert(
        {
          workspace_id: deal.workspace_id,
          deal_id: dealId,
          attribution_model: model.model,
          touch_chain: model.chain,
          attributed_amount: model.total,
          ai_confidence: 0.6,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,attribution_model" },
      );
    if (!upErr) persisted += 1;
  }

  const { data: equipmentRows } = await supabaseAdmin
    .from("crm_deal_equipment")
    .select("role, crm_equipment(vin_pin)")
    .eq("deal_id", dealId);

  const serials = ((equipmentRows ?? []) as DealEquipmentRow[])
    .filter((row) => !row.role || row.role === "subject")
    .map((row) => one(row.crm_equipment)?.vin_pin ?? null)
    .filter((value): value is string => Boolean(value));

  if (serials.length > 0 && typeof deal.company_id === "string" && deal.company_id.trim()) {
    const serialShare = dealAmount > 0 ? dealAmount / serials.length : 0;
    const { data: profile } = await supabaseAdmin
      .from("customer_profiles_extended")
      .select("id, revenue_attribution")
      .eq("crm_company_id", deal.company_id)
      .limit(1)
      .maybeSingle();

    if (profile?.id) {
      const currentAttribution =
        profile.revenue_attribution &&
          typeof profile.revenue_attribution === "object" &&
          !Array.isArray(profile.revenue_attribution)
          ? profile.revenue_attribution as Record<string, unknown>
          : {};
      const nextAttribution: Record<string, unknown> = { ...currentAttribution };

      for (const serial of serials) {
        const existing =
          nextAttribution[serial] &&
            typeof nextAttribution[serial] === "object" &&
            !Array.isArray(nextAttribution[serial])
            ? nextAttribution[serial] as Record<string, unknown>
            : {};
        const nextPurchase = Number(existing.purchase ?? 0) + serialShare;
        nextAttribution[serial] = {
          parts: Number(existing.parts ?? 0),
          service: Number(existing.service ?? 0),
          purchase: Math.round(nextPurchase * 100) / 100,
          rental: Number(existing.rental ?? 0),
        };
      }

      await supabaseAdmin
        .from("customer_profiles_extended")
        .update({ revenue_attribution: nextAttribution })
        .eq("id", profile.id);
    }
  }

  return { deal_id: dealId, touches: touches.length, models_persisted: persisted };
}

export async function handleRevenueAttributionCompute(
  req: Request,
  overrides: Partial<RevenueAttributionHandlerDependencies> = {},
): Promise<Response> {
  const deps = resolveDependencies(overrides);
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Server misconfiguration", 500, origin);
  }

  const supabaseAdmin = deps.createAdminClient();

  try {
    const auth = await deps.authenticate(req, supabaseAdmin, deps);
    if (!auth.ok) {
      const message = auth.status === 401 ? "Unauthorized" : "Forbidden";
      return safeJsonError(message, auth.status, origin);
    }

    const body = await readRequestBody(req);
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace) ??
      normalizeWorkspaceId(body.workspace_id);
    const headerWorkspaceId = normalizeWorkspaceId(req.headers.get("x-workspace-id"));

    const workspaceScope = auth.isServiceRole
      ? resolveRevenueAttributionWorkspace({
        isServiceRole: true,
        authWorkspaceId: headerWorkspaceId,
        requestedWorkspaceId,
      })
      : resolveRevenueAttributionWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId,
      });

    if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";
    const resolvedDeals = await resolveDealIds(
      action,
      body,
      supabaseAdmin,
      workspaceScope,
      origin,
    );
    if (!resolvedDeals.ok) return resolvedDeals.response;

    if (action === "compute" && !auth.isServiceRole) {
      const { data: deal } = await supabaseAdmin
        .from("qrm_deals")
        .select("id, workspace_id, closed_at")
        .eq("id", resolvedDeals.dealIds[0])
        .maybeSingle();
      if (!dealAccessibleInScope(deal as DealRow | null, workspaceScope)) {
        return safeJsonError("Deal not found", 404, origin);
      }
    }

    const results: Array<{
      deal_id: string;
      touches: number;
      models_persisted: number;
      error?: string;
    }> = [];

    for (const dealId of resolvedDeals.dealIds) {
      try {
        results.push(await computeDealAttribution(supabaseAdmin, dealId, workspaceScope));
      } catch (err) {
        results.push({
          deal_id: dealId,
          touches: 0,
          models_persisted: 0,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    return safeJsonOk({
      ok: true,
      workspace_scope: workspaceScope.mode,
      workspace_id: workspaceScope.mode === "scoped" ? workspaceScope.workspaceId : null,
      processed: results.length,
      successes: results.filter((result) => result.models_persisted > 0).length,
      failures: results.filter((result) => result.error).length,
      results,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    throw err;
  }
}
