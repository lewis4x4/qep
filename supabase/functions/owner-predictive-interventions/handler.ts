/**
 * Owner predictive interventions handler — workspace-bound JWT + service-role paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace cannot widen or retarget scope.
 *
 * Service role: optional x-workspace-id / body.workspace for one shop.
 * Missing explicit workspace → 403 (fail closed; no "default" fallback).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
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

export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const MAX_TOKENS = 1536;
export const TEMPERATURE = 0.3;
export const ANTHROPIC_TIMEOUT_MS = 35_000;
export const CACHE_MAX_AGE_MS = 30 * 60_000;

export interface RequestBody {
  refresh?: boolean;
  workspace?: string | null;
}

export interface Intervention {
  title: string;
  projection: string;
  rationale: string;
  impact_usd?: number;
  horizon_days?: number;
  severity: "high" | "medium" | "low";
  action: { label: string; route: string };
}

export const ALLOWED_ROUTES = [
  "/owner",
  "/executive",
  "/qrm",
  "/qrm/deals",
  "/qrm/companies",
  "/qrm/exceptions",
  "/qrm/command/approvals",
  "/qrm/command/blockers",
  "/parts/companion/intelligence",
  "/parts/companion/replenish",
  "/parts/companion/predictive",
  "/parts/companion/pricing-rules",
  "/service",
  "/rentals",
];

export const SYSTEM_PROMPT = `You are the AI strategic advisor for the owner of Quality Equipment & Parts (QEP), a multi-branch equipment dealership.

Given a business snapshot, you project 3-4 forward-looking scenarios. Each is something that WILL happen if the owner does nothing, grounded in the current data.

Output STRICT JSON only (no markdown, no prose):
{
  "interventions": [
    {
      "title": "short noun phrase, 3-6 words",
      "projection": "ONE sentence: the trajectory with a concrete number + timeframe",
      "rationale": "ONE sentence: why, citing the driving signal from the data",
      "impact_usd": <integer dollar impact, or 0 if non-monetary>,
      "horizon_days": <integer: when the trajectory crosses the line>,
      "severity": "high" | "medium" | "low",
      "action": { "label": "verb phrase, max 3 words", "route": "/one/of/the/allowed/routes" }
    }
  ]
}

Allowed routes (action.route MUST be one of these EXACT strings):
${ALLOWED_ROUTES.map((r) => `  ${r}`).join("\n")}

Rules:
- 3-4 interventions. Mix severities — at least one high, at least one medium.
- Every number must come from the snapshot data. Don't invent amounts.
- projection always includes a specific number and a timeframe ("crosses $100K in 6 weeks", "delays 14 service jobs within 10 days").
- rationale points at the evidence ("12 SKUs drive 60% of the buildup", "4 deals haven't moved in 12+ days").
- Severity calibration: high = revenue impact >$50K OR operational breakdown; medium = $10-50K OR accumulating risk; low = watch-list.
- action.label is imperative ("Run clearance", "Review queue", "Open deal board").
- No duplicate titles. No two interventions with the same route unless the drivers are genuinely different.
- Output ONLY the JSON object. No code fences. No other text.`;

export type OwnerPredictiveAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

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

export function resolveOwnerPredictiveWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): { workspaceId: string } {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.headerWorkspaceId) ??
      normalizeWorkspaceId(params.authWorkspaceId);
    return { workspaceId: explicit ?? "" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  return { workspaceId: workspaceId ?? "" };
}

export async function authenticateOwnerPredictiveInterventions(
  req: Request,
  adminClient: SupabaseClient,
): Promise<OwnerPredictiveAuthResult> {
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

export function parseInterventions(raw: string): Intervention[] {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const parsed = JSON.parse(s);
  if (!parsed || !Array.isArray(parsed.interventions)) {
    throw new Error("interventions array missing");
  }
  const allowed = new Set(ALLOWED_ROUTES);
  return (parsed.interventions as Intervention[])
    .filter((i) => i && i.title && i.projection && i.action?.route)
    .map((i) => ({
      ...i,
      severity: (["high", "medium", "low"].includes(i.severity) ? i.severity : "medium") as Intervention["severity"],
      action: {
        label: i.action.label?.slice(0, 24) || "Open",
        route: allowed.has(i.action.route) ? i.action.route : "/owner",
      },
    }))
    .slice(0, 4);
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = ((data?.content?.[0]?.text as string) ?? "").trim();
  const usage = (data?.usage ?? {}) as Record<string, unknown>;
  return {
    text,
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
  };
}

export interface SnapshotQueries {
  summaryRpc: { p_workspace: string };
  scoreRpc: { p_workspace: string };
  branchFilter: { workspace_id: string };
  playsFilter: { workspace_id: string; status: string };
  stalledDealsFilter: { workspace_id: string };
}

export function buildSnapshotQueries(workspaceId: string): SnapshotQueries {
  return {
    summaryRpc: { p_workspace: workspaceId },
    scoreRpc: { p_workspace: workspaceId },
    branchFilter: { workspace_id: workspaceId },
    playsFilter: { workspace_id: workspaceId, status: "open" },
    stalledDealsFilter: { workspace_id: workspaceId },
  };
}

export async function gatherSnapshot(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{
  summary: unknown;
  health_score: unknown;
  branches: unknown[];
  top_open_predictive_plays: unknown[];
  stalled_deals: unknown[];
}> {
  const stalledCutoff = new Date(Date.now() - 14 * 86400_000).toISOString();

  const [summaryRes, scoreRes, branchRes, playsRes, stalledRes] = await Promise.all([
    supabase.rpc("owner_dashboard_summary", { p_workspace: workspaceId }),
    supabase.rpc("compute_ownership_health_score", { p_workspace: workspaceId }),
    supabase
      .from("v_branch_stack_ranking")
      .select("*")
      .eq("workspace_id", workspaceId),
    supabase
      .from("predicted_parts_plays")
      .select("part_number, part_description, projection_window, projected_revenue, recommended_order_qty, probability")
      .eq("workspace_id", workspaceId)
      .eq("status", "open")
      .order("projected_revenue", { ascending: false })
      .limit(10),
    supabase
      .from("qrm_deals")
      .select(
        `id, name, amount, updated_at, closed_at,
         qrm_deal_stages ( name, is_closed_won, is_closed_lost )`,
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .is("closed_at", null)
      .lt("updated_at", stalledCutoff)
      .order("amount", { ascending: false })
      .limit(10),
  ]);

  return {
    summary: summaryRes.data ?? null,
    health_score: scoreRes.data ?? null,
    branches: branchRes.data ?? [],
    top_open_predictive_plays: playsRes.data ?? [],
    stalled_deals: stalledRes.data ?? [],
  };
}

export interface OwnerPredictiveHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<OwnerPredictiveAuthResult>;
  callClaudeImpl: (
    apiKey: string,
    systemPrompt: string,
    userMessage: string,
  ) => Promise<{ text: string; tokens_in: number; tokens_out: number }>;
}

const defaultDependencies: OwnerPredictiveHandlerDependencies = {
  createAdminClient,
  authenticate: authenticateOwnerPredictiveInterventions,
  callClaudeImpl: (apiKey, systemPrompt, userMessage) =>
    callClaude(apiKey, systemPrompt, userMessage),
};

export async function handleOwnerPredictiveInterventions(
  req: Request,
  overrides: Partial<OwnerPredictiveHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate, callClaudeImpl } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Missing SUPABASE_URL / SERVICE_ROLE_KEY", 500, origin);
  }
  if (!anthropicKey) {
    return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
  }

  const adminClient = createClientFn();

  try {
    const auth = await authenticate(req, adminClient);
    if (!auth.ok) {
      const message = auth.status === 401 ? "Unauthorized" : "Forbidden";
      return safeJsonError(message, auth.status, origin);
    }

    const body = await readRequestBody(req);
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace);

    const { workspaceId } = auth.isServiceRole
      ? resolveOwnerPredictiveWorkspace({
        isServiceRole: true,
        authWorkspaceId: auth.headerWorkspaceId,
        requestedWorkspaceId,
        headerWorkspaceId: auth.headerWorkspaceId,
      })
      : resolveOwnerPredictiveWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId,
      });

    if (!workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const refresh = body.refresh === true;
    const supabase = adminClient;

    if (!refresh) {
      const { data: cached } = await supabase
        .from("owner_predictive_interventions_cache")
        .select("payload, generated_at, model")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (cached) {
        const ageMs = Date.now() - new Date(cached.generated_at).getTime();
        if (ageMs < CACHE_MAX_AGE_MS) {
          return safeJsonOk({
            ...cached.payload,
            cached: true,
            generated_at: cached.generated_at,
            model: cached.model ?? CLAUDE_MODEL,
            workspace_id: workspaceId,
          }, origin);
        }
      }
    }

    const snapshot = await gatherSnapshot(supabase, workspaceId);

    const prompt =
      "BUSINESS SNAPSHOT\n" + JSON.stringify(snapshot, null, 2) +
      "\n\nReturn 3-4 predictive interventions as STRICT JSON per the schema. Ground every number.";

    const claudeResp = await callClaudeImpl(anthropicKey, SYSTEM_PROMPT, prompt);
    const parsed = parseInterventions(claudeResp.text);

    const generatedAt = new Date().toISOString();
    const payload = { interventions: parsed, generated_at: generatedAt };

    await supabase
      .from("owner_predictive_interventions_cache")
      .upsert({
        workspace_id: workspaceId,
        payload,
        model: CLAUDE_MODEL,
        tokens_in: claudeResp.tokens_in,
        tokens_out: claudeResp.tokens_out,
        generated_at: generatedAt,
      }, { onConflict: "workspace_id" });

    return safeJsonOk({
      ...payload,
      cached: false,
      model: CLAUDE_MODEL,
      workspace_id: workspaceId,
      elapsed_ms: Date.now() - startMs,
      tokens_in: claudeResp.tokens_in,
      tokens_out: claudeResp.tokens_out,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError(err.message, 400, origin);
    }
    throw err;
  }
}
