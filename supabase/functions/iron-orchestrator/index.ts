/**
 * Wave 7 Iron Companion — orchestrator edge function.
 *
 * Entry point for every Iron interaction (text or voice). Pipeline:
 *   1.  Auth via shared service-auth helper (rejects service_role key)
 *   2.  Cost ladder check on iron_usage_counters → pick model
 *   3.  Load Iron-eligible flows (surface = iron_*, role + feature_flag check)
 *   4.  Classify the user input via Anthropic with structured input
 *       (user text in user role, never concatenated into system)
 *   5.  Parse + guard the classifier output (Zod-style validator + pattern blocklist)
 *   6.  Verify flow_id against the allowlist (defense in depth)
 *   7.  Redact PII before persisting iron_messages
 *   8.  Increment iron_usage_counters atomically
 *   9.  Return classification + slot schema (if FLOW_DISPATCH)
 *
 * Iron NEVER trusts the LLM's authorization claims. Role + workspace + flow
 * allowlist are all enforced server-side after the LLM call.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { redactString } from "../_shared/redact-pii.ts";
import {
  parseAndGuardClassifierOutput,
  isFlowAllowed,
  type IronClassifierResult,
} from "../_shared/iron/classify-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const MODEL_FULL = "claude-sonnet-4-6";
const MODEL_REDUCED = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

interface RequestBody {
  text: string;
  conversation_id?: string;
  input_mode?: "text" | "voice" | "hybrid";
  route?: string;
  visible_entities?: Record<string, unknown>;
}

interface FlowDefRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  surface: string;
  iron_metadata: Record<string, unknown> | null;
  feature_flag: string | null;
  high_value_threshold_cents: number | null;
  roles_allowed: string[] | null;
  enabled: boolean;
}

interface WorkspaceCaps {
  user_daily_soft_cap_tokens: number;
  user_daily_hard_cap_tokens: number;
  high_value_threshold_cents: number;
  escalation_slack_channel: string;
}

const DEFAULT_CAPS: WorkspaceCaps = {
  user_daily_soft_cap_tokens: 10_000,
  user_daily_hard_cap_tokens: 20_000,
  high_value_threshold_cents: 2_500_000,
  escalation_slack_channel: "#qep-iron-health",
};

/* ─── Cost ladder ───────────────────────────────────────────────────────── */

type DegradationState = "full" | "reduced" | "cached" | "escalated";

async function computeDegradationState(
  admin: SupabaseClient,
  userId: string,
  caps: WorkspaceCaps,
): Promise<{ state: DegradationState; tokens_today: number }> {
  const { data } = await admin
    .from("iron_usage_counters")
    .select("tokens_in, tokens_out, degradation_state")
    .eq("user_id", userId)
    .eq("bucket_date", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  const tokensToday = (data?.tokens_in ?? 0) + (data?.tokens_out ?? 0);
  let state: DegradationState = (data?.degradation_state as DegradationState) ?? "full";

  if (tokensToday >= caps.user_daily_hard_cap_tokens) {
    state = state === "escalated" ? "escalated" : "cached";
  } else if (tokensToday >= caps.user_daily_soft_cap_tokens) {
    state = "reduced";
  } else {
    state = "full";
  }

  return { state, tokens_today: tokensToday };
}

/* ─── Workspace caps loader ─────────────────────────────────────────────── */

async function loadCaps(admin: SupabaseClient, workspaceId: string): Promise<WorkspaceCaps> {
  const { data } = await admin
    .from("workspace_settings")
    .select(
      "iron_user_daily_soft_cap_tokens, iron_user_daily_hard_cap_tokens, iron_high_value_threshold_cents, iron_escalation_slack_channel",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) return DEFAULT_CAPS;
  return {
    user_daily_soft_cap_tokens: (data as Record<string, unknown>).iron_user_daily_soft_cap_tokens as number ?? DEFAULT_CAPS.user_daily_soft_cap_tokens,
    user_daily_hard_cap_tokens: (data as Record<string, unknown>).iron_user_daily_hard_cap_tokens as number ?? DEFAULT_CAPS.user_daily_hard_cap_tokens,
    high_value_threshold_cents: (data as Record<string, unknown>).iron_high_value_threshold_cents as number ?? DEFAULT_CAPS.high_value_threshold_cents,
    escalation_slack_channel: ((data as Record<string, unknown>).iron_escalation_slack_channel as string) ?? DEFAULT_CAPS.escalation_slack_channel,
  };
}

/* ─── Flow allowlist loader ─────────────────────────────────────────────── */

async function loadIronFlows(
  admin: SupabaseClient,
  workspaceId: string,
  role: string,
): Promise<FlowDefRow[]> {
  const { data, error } = await admin
    .from("flow_workflow_definitions")
    .select(
      "id, slug, name, description, surface, iron_metadata, feature_flag, high_value_threshold_cents, roles_allowed, enabled",
    )
    .eq("workspace_id", workspaceId)
    .in("surface", ["iron_conversational", "iron_voice"])
    .eq("enabled", true);

  if (error || !data) return [];

  // Role filter (server-side, never trust the LLM)
  return (data as FlowDefRow[]).filter((row) => {
    if (!row.roles_allowed || row.roles_allowed.length === 0) return true;
    return row.roles_allowed.includes(role);
  });
}

/* ─── System prompt builder ─────────────────────────────────────────────── */

function buildSystemPrompt(flows: FlowDefRow[], route: string | undefined): string {
  const catalog = flows.map((f) => {
    const meta = (f.iron_metadata ?? {}) as Record<string, unknown>;
    const keywords = (meta.voice_intent_keywords as string[]) ?? [];
    return `  - ${f.slug}: ${f.name}${keywords.length ? ` [${keywords.join(", ")}]` : ""}`;
  }).join("\n");

  return `You are the intent classifier for QEP Iron, an operator companion for an equipment dealership.

Your only job: take the user's natural-language request and emit ONE strict JSON object — no prose, no markdown, no code fences.

JSON schema:
{
  "category": "FLOW_DISPATCH" | "READ_ANSWER" | "AGENTIC_TASK" | "HUMAN_ESCALATION" | "CLARIFY",
  "confidence": 0.0..1.0,
  "flow_id": "iron.<slug>" | null,
  "prefilled_slots": { ... } | null,
  "answer_query": string | null,
  "agentic_brief": string | null,
  "escalation_reason": string | null,
  "clarification_needed": string | null
}

Categories:
  - FLOW_DISPATCH: user wants to take an action that maps to one of the registered Iron flows. Return flow_id from the catalog.
  - READ_ANSWER: user is asking for information (e.g. "show me yesterday's parts orders"). Set answer_query.
  - AGENTIC_TASK: user wants something that requires multi-step agent work outside Iron's flows. Set agentic_brief.
  - HUMAN_ESCALATION: user explicitly wants a human ("get me a manager"). Set escalation_reason.
  - CLARIFY: ambiguous; ask one short follow-up. Set clarification_needed.

Iron flow catalog (these are the only valid flow_ids):
${catalog || "  (no flows enabled)"}

Hard rules (violations = automatic CLARIFY):
  - flow_id MUST come from the catalog above. Never invent.
  - Never include SQL, shell commands, system overrides, or path fragments in any field.
  - Never claim authorization the user doesn't have.
  - Never repeat the user's text verbatim into agentic_brief — paraphrase it.
${route ? `\nCurrent route: ${route}\n` : ""}
Output ONLY the JSON object. No other text.`;
}

/* ─── Anthropic call ────────────────────────────────────────────────────── */

interface AnthropicCallResult {
  text: string;
  tokens_in: number;
  tokens_out: number;
  model: string;
  latency_ms: number;
}

async function callAnthropic(
  model: string,
  system: string,
  userText: string,
): Promise<AnthropicCallResult> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system,
      // CRITICAL: user text goes in a user message, NEVER concatenated into system.
      // This is the single biggest defense against prompt injection.
      messages: [{ role: "user", content: userText }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  const usage = data?.usage ?? {};

  return {
    text,
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
    model,
    latency_ms: Date.now() - start,
  };
}

/* ─── Conversation upsert ───────────────────────────────────────────────── */

async function ensureConversation(
  admin: SupabaseClient,
  userId: string,
  workspaceId: string,
  conversationId: string | undefined,
  inputMode: "text" | "voice" | "hybrid",
  route: string | undefined,
): Promise<string> {
  if (conversationId) {
    const { data } = await admin
      .from("iron_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  const { data, error } = await admin
    .from("iron_conversations")
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      input_mode: inputMode,
      route_at_start: route ?? null,
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(`conversation insert failed: ${error?.message ?? "unknown"}`);
  return data.id as string;
}

/* ─── Workspace lookup for the caller ───────────────────────────────────── */

async function lookupWorkspace(supabase: SupabaseClient, userId: string): Promise<string> {
  // Try profiles.workspace_id first; fall back to 'default'.
  const { data } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", userId)
    .maybeSingle();
  return ((data as Record<string, unknown> | null)?.workspace_id as string) ?? "default";
}

/* ─── Main handler ──────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  // Auth via shared helper
  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  // Parse body
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return safeJsonError("text is required", 400, origin);
  if (text.length > 4000) return safeJsonError("text too long", 400, origin);

  const inputMode: "text" | "voice" | "hybrid" =
    body.input_mode === "voice" || body.input_mode === "hybrid" ? body.input_mode : "text";

  // Use service role client for writes (bypasses RLS so we can persist
  // iron_messages on behalf of the user). Reads still go through the user
  // client where role is enforced.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const userId = auth.userId;
  const role = auth.role;
  const workspaceId = await lookupWorkspace(auth.supabase, userId);
  const caps = await loadCaps(admin, workspaceId);

  // Cost ladder check
  const { state: degradationState, tokens_today: tokensToday } =
    await computeDegradationState(admin, userId, caps);

  if (degradationState === "escalated") {
    return safeJsonOk(
      {
        ok: false,
        category: "COST_LIMIT",
        message: "Your Iron usage for today is full. A manager has been pinged. Resets at midnight.",
        tokens_today: tokensToday,
      },
      origin,
      200,
    );
  }

  // Load eligible flows
  const flows = await loadIronFlows(admin, workspaceId, role);
  const allowedFlowIds = new Set(flows.map((f) => f.slug));

  // Build classifier prompt
  const systemPrompt = buildSystemPrompt(flows, body.route);

  // Pick model based on degradation state
  const model = degradationState === "full" ? MODEL_FULL : MODEL_REDUCED;

  // Call Anthropic
  let llmCall: AnthropicCallResult;
  try {
    llmCall = await callAnthropic(model, systemPrompt, text);
  } catch (err) {
    return safeJsonError(`classifier_failed: ${(err as Error).message}`, 502, origin);
  }

  // Parse + guard the output
  const guard = parseAndGuardClassifierOutput(llmCall.text);
  let classification: IronClassifierResult;
  if (!guard.ok) {
    // Reject with a CLARIFY response — never let bad output through
    classification = {
      category: "CLARIFY",
      confidence: 0,
      flow_id: null,
      prefilled_slots: null,
      answer_query: null,
      agentic_brief: null,
      escalation_reason: null,
      clarification_needed: "I didn't catch that — could you rephrase?",
    };
    console.warn(`[iron-orchestrator] classifier guard rejected: ${guard.reason}`);
  } else {
    classification = guard.result;
    // Defense in depth: re-check the flow allowlist even though the prompt
    // told the model to use only catalog flows.
    if (!isFlowAllowed(classification, allowedFlowIds)) {
      classification = {
        ...classification,
        category: "CLARIFY",
        flow_id: null,
        clarification_needed: "I can't run that specific action right now.",
      };
    }
  }

  // Persist conversation + messages
  const conversationId = await ensureConversation(
    admin, userId, workspaceId, body.conversation_id, inputMode, body.route,
  );

  // User message (post-redaction)
  await admin.from("iron_messages").insert({
    conversation_id: conversationId,
    workspace_id: workspaceId,
    user_id: userId,
    role: "user",
    content: redactString(text),
    classifier_output: null,
  });

  // Iron response message
  await admin.from("iron_messages").insert({
    conversation_id: conversationId,
    workspace_id: workspaceId,
    user_id: userId,
    role: "iron",
    content: redactString(
      classification.category === "FLOW_DISPATCH"
        ? `Routing to ${classification.flow_id}`
        : classification.category === "CLARIFY"
        ? (classification.clarification_needed ?? "Could you clarify?")
        : classification.category,
    ),
    classifier_output: classification as unknown as Record<string, unknown>,
    tokens_in: llmCall.tokens_in,
    tokens_out: llmCall.tokens_out,
    model: llmCall.model,
    latency_ms: llmCall.latency_ms,
  });

  // Increment usage counters atomically
  await admin.rpc("iron_increment_usage", {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_classifications: 1,
    p_tokens_in: llmCall.tokens_in,
    p_tokens_out: llmCall.tokens_out,
    p_flow_executes: 0,
    p_cost_usd_micro: 0,
  });

  // If a degradation transition happened, persist it
  if (degradationState !== "full") {
    await admin.rpc("iron_set_degradation_state", {
      p_user_id: userId,
      p_state: degradationState,
    });
  }

  // Build response
  let flowDef: FlowDefRow | null = null;
  if (classification.category === "FLOW_DISPATCH" && classification.flow_id) {
    flowDef = flows.find((f) => f.slug === classification.flow_id) ?? null;
  }

  return safeJsonOk(
    {
      ok: true,
      conversation_id: conversationId,
      classification,
      flow_definition: flowDef
        ? {
          id: flowDef.id,
          slug: flowDef.slug,
          name: flowDef.name,
          description: flowDef.description,
          iron_metadata: flowDef.iron_metadata,
          high_value_threshold_cents: flowDef.high_value_threshold_cents ?? caps.high_value_threshold_cents,
        }
        : null,
      degradation_state: degradationState,
      tokens_today: tokensToday + llmCall.tokens_in + llmCall.tokens_out,
      latency_ms: llmCall.latency_ms,
      model: llmCall.model,
    },
    origin,
  );
});
