/**
 * Parts Predictive AI handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id on
 * customer_fleet queries. Forged body.workspace cannot widen or retarget scope.
 *
 * Service role: unscoped (all shops) when no workspace hint, or optional
 * x-workspace-id / body.workspace for one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";

// ── Config ──────────────────────────────────────────────────

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const MAX_TEMPERATURE = 0.3;
const ANTHROPIC_TIMEOUT_MS = 30_000;
const GROUNDING_MIN_HYBRID = 0.35;
const GROUNDING_MIN_COSINE = 0.45;
const SYSTEM_PROMPT_VERSION = "v1-2026-04-15";

const COST_PER_MTOK_IN = 3.0;
const COST_PER_MTOK_OUT = 15.0;

export interface RequestBody {
  workspace?: string | null;
  max_machines?: number;
  fleet_id?: string | null;
}

export type PredictiveAiWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type PredictiveAiAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

interface ClaudePlay {
  part_hint: string;
  projection_window: "30d" | "60d" | "90d";
  probability: number;
  reason: string;
}

interface ClaudeResponse {
  plays: ClaudePlay[];
}

interface GroundedPart {
  part_id: string;
  part_number: string;
  description: string;
  cosine_similarity: number;
  hybrid_score: number;
  match_source: string;
}

interface GroundingDebug {
  top_cosine: number | null;
  top_hybrid: number | null;
  top_match_source: string | null;
  top_part_number: string | null;
  candidate_count: number;
  passed: boolean;
}

const SYSTEM_PROMPT = `You are a parts intelligence AI for QEP, an equipment dealership that sells Yanmar, Bandit, ASV, Prinoth, Barko, CMI, Peterson, and similar industrial brands.

Given ONE customer machine and its recent service + parts history, predict up to 5 specific parts the customer will likely need in the next 30-90 days.

Think about:
- Seasonal patterns (cold → batteries/coolant; heat → hydraulic degradation; muddy/wet → filters/seals; dusty → air filters)
- Customer industry (forestry/tree care/construction/landscaping — different wear profiles)
- Hours-vs-service-interval math
- Recent parts ordered (the NEXT logical part in a typical failure sequence)
- Cross-machine wear propagation (when X fails, Y often follows within weeks)

Output STRICT JSON only, no markdown, no prose:
{
  "plays": [
    {
      "part_hint": "short description of what the part is — NOT a SKU, NOT a catalog number",
      "projection_window": "30d" | "60d" | "90d",
      "probability": 0.0-1.0,
      "reason": "one sentence the sales rep can say to the customer"
    }
  ]
}

Rules:
- NEVER invent part numbers or SKUs. Describe what the part IS in plain language. The system will match your hint to the real catalog.
- Skip fluids and consumables that dealerships don't typically stock.
- If nothing new to predict beyond the obvious maintenance schedule, return fewer plays or an empty array. Quality over quantity.
- Probability must reflect genuine confidence: 0.85+ for obvious next-in-sequence, 0.6-0.8 for pattern inference, 0.4-0.5 for weaker seasonal hunches.
- reason should be business-actionable — what the rep tells the customer, not what the AI thinks.

Output ONLY the JSON object. No code fences. No other text.`;

function normalizeWorkspaceId(value: unknown): string | null {
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

export function resolvePredictiveAiWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): PredictiveAiWorkspaceScope {
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

export async function authenticatePredictiveAi(
  req: Request,
  adminClient: SupabaseClient,
): Promise<PredictiveAiAuthResult> {
  const caller = await resolveCallerContext(req, adminClient);

  if (caller.isServiceRole) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: caller.workspaceId,
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

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

function buildUserMessage(ctx: Record<string, unknown>): string {
  const m = (ctx.machine ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`Customer: ${ctx.customer_name ?? "Unknown"}`);
  lines.push(
    `Machine: ${m.year ?? "?"} ${m.make ?? "?"} ${m.model ?? "?"}`,
  );
  lines.push(`Current hours: ${m.current_hours ?? "unknown"}`);
  if (m.service_interval_hours) {
    lines.push(`Service interval: ${m.service_interval_hours} hrs`);
  }
  if (m.last_service_date) {
    lines.push(`Last service: ${m.last_service_date}`);
  }
  if (m.machine_profile_notes) {
    lines.push(`Profile notes: ${String(m.machine_profile_notes).slice(0, 240)}`);
  }

  const orders = Array.isArray(ctx.recent_orders_6mo) ? ctx.recent_orders_6mo : [];
  if (orders.length > 0) {
    lines.push(`\nRecent parts orders (last 6 months):`);
    for (const o of orders.slice(0, 12)) {
      const order = o as Record<string, unknown>;
      lines.push(
        `  - ${order.ordered_at}: ${order.part_number ?? "?"} (${order.description ?? "—"}) × ${order.quantity ?? 1}`,
      );
    }
  } else {
    lines.push(`\nRecent parts orders: none in last 6 months`);
  }

  return lines.join("\n");
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: MAX_TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data?.content?.[0]?.text as string) ?? "";
  const usage = (data?.usage ?? {}) as Record<string, unknown>;

  return {
    text,
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
  };
}

function parseClaudeJson(raw: string): ClaudeResponse {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  const parsed = JSON.parse(s);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("response is not an object");
  }
  if (!Array.isArray(parsed.plays)) {
    throw new Error("plays field missing or not an array");
  }
  return parsed as ClaudeResponse;
}

async function groundPartHint(
  supabase: SupabaseClient,
  hint: string,
  manufacturerHint: string | null,
  modelHint: string | null,
): Promise<{ grounded: GroundedPart | null; debug: GroundingDebug }> {
  const debug: GroundingDebug = {
    top_cosine: null,
    top_hybrid: null,
    top_match_source: null,
    top_part_number: null,
    candidate_count: 0,
    passed: false,
  };
  try {
    const enrichedHint = [manufacturerHint, modelHint, hint]
      .filter((x) => x && x.trim())
      .join(" ")
      .trim();

    const embedding = await embedText(enrichedHint);
    const vectorLiteral = formatVectorLiteral(embedding);

    const { data, error } = await supabase.rpc("match_parts_hybrid", {
      p_query_embedding: vectorLiteral,
      p_query_text: enrichedHint,
      p_workspace: null,
      p_manufacturer: null,
      p_category: null,
      p_alpha: 0.6,
      p_match_count: 3,
    });

    if (error) {
      console.warn(`[grounding] RPC error for "${hint}":`, error.message);
      return { grounded: null, debug };
    }
    if (!data || data.length === 0) {
      return { grounded: null, debug };
    }

    const top = data[0] as {
      part_id: string;
      part_number: string;
      description: string | null;
      cosine_similarity: number;
      hybrid_score: number;
      match_source: string;
    };

    debug.candidate_count = data.length;
    debug.top_cosine = Number(top.cosine_similarity) || 0;
    debug.top_hybrid = Number(top.hybrid_score) || 0;
    debug.top_match_source = top.match_source;
    debug.top_part_number = top.part_number;

    const passes =
      debug.top_hybrid >= GROUNDING_MIN_HYBRID ||
      debug.top_cosine >= GROUNDING_MIN_COSINE ||
      top.match_source === "both";

    debug.passed = passes;
    if (!passes) {
      return { grounded: null, debug };
    }

    return {
      grounded: {
        part_id: top.part_id,
        part_number: top.part_number,
        description: top.description ?? hint,
        cosine_similarity: debug.top_cosine,
        hybrid_score: debug.top_hybrid,
        match_source: top.match_source,
      },
      debug,
    };
  } catch (err) {
    console.warn(`[parts-predictive-ai] grounding failed for hint "${hint}":`, err);
    return { grounded: null, debug };
  }
}

export interface PredictiveAiHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<PredictiveAiAuthResult>;
}

const defaultDependencies: PredictiveAiHandlerDependencies = {
  createAdminClient,
  authenticate: authenticatePredictiveAi,
};

export async function handlePartsPredictiveAi(
  req: Request,
  overrides: Partial<PredictiveAiHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate } = {
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
    const maxMachines = body.max_machines ?? 10;
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace);

    const workspaceScope = auth.isServiceRole
      ? resolvePredictiveAiWorkspace({
        isServiceRole: true,
        authWorkspaceId: auth.headerWorkspaceId,
        requestedWorkspaceId,
      })
      : resolvePredictiveAiWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId,
      });

    if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const calledBy = auth.isServiceRole
      ? "cron"
      : `user:${auth.userId}`;

    const batchId = `ai-predict-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

    // ── 1. Find eligible fleet rows (workspace-bound for JWT) ──
    let fleetQuery = adminClient
      .from("customer_fleet")
      .select("id, workspace_id, portal_customer_id, make, model, current_hours")
      .eq("is_active", true)
      .not("current_hours", "is", null)
      .order("updated_at", { ascending: false })
      .limit(maxMachines);

    if (body.fleet_id) fleetQuery = fleetQuery.eq("id", body.fleet_id);
    if (workspaceScope.mode === "scoped") {
      fleetQuery = fleetQuery.eq("workspace_id", workspaceScope.workspaceId);
    }

    const { data: fleets, error: fleetErr } = await fleetQuery;
    if (fleetErr) throw new Error(`fleet fetch failed: ${fleetErr.message}`);
    if (!fleets || fleets.length === 0) {
      return safeJsonOk({
        ok: true,
        called_by: calledBy,
        elapsed_ms: Date.now() - startMs,
        workspace_scope: workspaceScope.mode,
        workspace_id: workspaceScope.mode === "scoped"
          ? workspaceScope.workspaceId
          : null,
        machines_processed: 0,
        message: "No eligible fleet rows (need is_active=true + current_hours)",
      }, origin);
    }

    const totals = {
      machines_processed: 0,
      plays_proposed: 0,
      plays_grounded: 0,
      plays_written: 0,
      llm_errors: 0,
      grounding_rejections: 0,
      cost_cents: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
    };

    // ── 2. Per-machine pipeline ─────────────────────────────
    for (const fleet of fleets) {
      const machineStart = Date.now();
      let runStatus:
        | "success"
        | "llm_error"
        | "validation_error"
        | "grounding_failed"
        | "timeout" = "success";
      let runError: string | null = null;
      let runTokensIn = 0;
      let runTokensOut = 0;
      let runPlaysProposed = 0;
      let runPlaysGrounded = 0;
      let runPlaysWritten = 0;
      let rawResponse: unknown = null;
      const groundingRejections: Array<{
        hint: string;
        top_cosine: number | null;
        top_hybrid: number | null;
        top_match_source: string | null;
        top_part_number: string | null;
        candidate_count: number;
      }> = [];

      try {
        totals.machines_processed++;

        const { data: contextData, error: ctxErr } = await adminClient.rpc(
          "customer_fleet_llm_context",
          { p_fleet_id: fleet.id },
        );
        if (ctxErr || !contextData?.ok) {
          throw new Error(`context fetch failed: ${ctxErr?.message ?? "unknown"}`);
        }

        const userMessage = buildUserMessage(contextData as Record<string, unknown>);

        const claudeResp = await callClaude(anthropicKey, SYSTEM_PROMPT, userMessage);
        runTokensIn = claudeResp.tokens_in;
        runTokensOut = claudeResp.tokens_out;
        totals.total_tokens_in += runTokensIn;
        totals.total_tokens_out += runTokensOut;

        const runCostCents =
          (runTokensIn / 1_000_000) * COST_PER_MTOK_IN * 100 +
          (runTokensOut / 1_000_000) * COST_PER_MTOK_OUT * 100;
        totals.cost_cents += runCostCents;

        let parsed: ClaudeResponse;
        try {
          parsed = parseClaudeJson(claudeResp.text);
          rawResponse = parsed;
        } catch (parseErr) {
          runStatus = "validation_error";
          runError = `JSON parse failed: ${(parseErr as Error).message}`;
          rawResponse = { raw_text: claudeResp.text };
          throw parseErr;
        }

        runPlaysProposed = parsed.plays.length;
        totals.plays_proposed += runPlaysProposed;

        for (const play of parsed.plays) {
          try {
            const { grounded, debug } = await groundPartHint(
              adminClient,
              play.part_hint,
              fleet.make,
              fleet.model,
            );
            if (!grounded) {
              groundingRejections.push({
                hint: play.part_hint,
                top_cosine: debug.top_cosine,
                top_hybrid: debug.top_hybrid,
                top_match_source: debug.top_match_source,
                top_part_number: debug.top_part_number,
                candidate_count: debug.candidate_count,
              });
              totals.grounding_rejections++;
              continue;
            }
            const groundedPartId = grounded;
            runPlaysGrounded++;

            const daysOut =
              play.projection_window === "30d"
                ? 30
                : play.projection_window === "60d"
                  ? 60
                  : 90;
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + daysOut);
            const dueDateStr = dueDate.toISOString().slice(0, 10);

            const { error: writeErr } = await adminClient.rpc("write_ai_inferred_play", {
              p_workspace: fleet.workspace_id,
              p_portal_customer_id: (contextData as { portal_customer_id: string | null })
                .portal_customer_id,
              p_fleet_id: fleet.id,
              p_machine_profile_id: null,
              p_part_id: groundedPartId.part_id,
              p_part_number: groundedPartId.part_number,
              p_part_description: groundedPartId.description,
              p_projection_window: play.projection_window,
              p_projected_due_date: dueDateStr,
              p_probability: Math.max(0, Math.min(1, play.probability)),
              p_reason: play.reason,
              p_llm_reasoning: play.reason,
              p_llm_model: CLAUDE_MODEL,
              p_batch_id: batchId,
            });
            if (writeErr) {
              console.warn(`[parts-predictive-ai] write failed:`, writeErr.message);
              continue;
            }
            runPlaysWritten++;
            totals.plays_written++;
          } catch (innerErr) {
            console.warn(`[parts-predictive-ai] play processing error:`, (innerErr as Error).message);
          }
        }
        totals.plays_grounded += runPlaysGrounded;

        await adminClient.from("parts_llm_inference_runs").insert({
          workspace_id: fleet.workspace_id,
          portal_customer_id: (contextData as { portal_customer_id: string | null })
            .portal_customer_id,
          fleet_id: fleet.id,
          system_prompt_version: SYSTEM_PROMPT_VERSION,
          user_context: contextData,
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          temperature: MAX_TEMPERATURE,
          plays_proposed: runPlaysProposed,
          plays_grounded: runPlaysGrounded,
          plays_written: runPlaysWritten,
          raw_response: rawResponse,
          grounding_rejections:
            groundingRejections.length > 0 ? groundingRejections : null,
          tokens_in: runTokensIn,
          tokens_out: runTokensOut,
          cost_usd_cents: runCostCents,
          status: runStatus,
          error_message: runError,
          elapsed_ms: Date.now() - machineStart,
        });
      } catch (err) {
        totals.llm_errors++;
        console.error(`[parts-predictive-ai] machine ${fleet.id} failed:`, err);
        runStatus = runStatus === "success" ? "llm_error" : runStatus;
        runError = (err as Error).message;

        await adminClient.from("parts_llm_inference_runs").insert({
          workspace_id: fleet.workspace_id,
          portal_customer_id: null,
          fleet_id: fleet.id,
          system_prompt_version: SYSTEM_PROMPT_VERSION,
          user_context: null,
          model: CLAUDE_MODEL,
          plays_proposed: runPlaysProposed,
          plays_grounded: runPlaysGrounded,
          plays_written: runPlaysWritten,
          raw_response: rawResponse,
          tokens_in: runTokensIn,
          tokens_out: runTokensOut,
          status: runStatus,
          error_message: runError,
          elapsed_ms: Date.now() - machineStart,
        });
      }
    }

    return safeJsonOk({
      ok: true,
      called_by: calledBy,
      elapsed_ms: Date.now() - startMs,
      batch_id: batchId,
      workspace_scope: workspaceScope.mode,
      workspace_id: workspaceScope.mode === "scoped"
        ? workspaceScope.workspaceId
        : null,
      ...totals,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError(err.message, 400, origin);
    }
    throw err;
  }
}
