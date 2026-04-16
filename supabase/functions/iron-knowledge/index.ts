/**
 * Wave 7.2 Iron Companion — knowledge endpoint, agent edition.
 *
 * Iron's "ask anything, get any answer" backend. Now built as a proper
 * Anthropic tool-use agent: the model receives a library of structured
 * tools (lookup_part_inventory, search_parts, list_parts_orders,
 * lookup_company, search_equipment, list_service_jobs, semantic_kb_search,
 * web_search, etc.), decides which to call based on the user's question,
 * the function executes them server-side against the real Postgres tables,
 * and the results feed back into the model context until it produces a
 * final text answer.
 *
 * Pipeline per request:
 *   1. Auth via requireServiceUser
 *   2. Resolve workspace + persist user message to iron_messages
 *   3. Load conversation history (last 12 turns)
 *   4. Run the agent loop:
 *        a. Call Claude (non-streaming) with messages + tool definitions
 *        b. If response contains tool_use blocks, execute each tool and
 *           append tool_result blocks to the conversation
 *        c. Loop, max 6 iterations (5 tool rounds + 1 final answer)
 *        d. If final response is text, break
 *   5. Stream the final text back to the client as SSE chunks (sentence-ish)
 *   6. Persist assistant message + tool usage + token totals
 *
 * SSE shape (matches the previous version so the client parser works
 * unchanged):
 *   data: {"meta": { trace_id, conversation_id, model, tools_used }}
 *   data: {"text": "<chunk>"}
 *   ...
 *   data: {"sources": [...]}
 *   data: [DONE]
 *
 * Hard rules:
 *   - All tools are READ-ONLY. Mutations belong in iron-execute-flow-step.
 *   - User input always lives in user-role messages, never concatenated
 *     into the system prompt.
 *   - PII redaction on persistence to iron_messages (reuses Flare's regex).
 *   - Cost ladder mirrors iron-orchestrator (Sonnet → Haiku at soft cap,
 *     COST_LIMIT response at hard cap).
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { redactString } from "../_shared/redact-pii.ts";
import {
  IRON_MODEL_FULL,
  IRON_MODEL_REDUCED,
} from "../_shared/iron/classifier-core.ts";
import {
  executeIronTool,
  IRON_TOOL_DEFINITIONS,
  type ToolContext,
} from "../_shared/iron/tools.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";
import {
  buildEvidenceExcerpt,
  rerankKbEvidence,
  type KbEvidenceRow,
} from "../_shared/kb-retrieval.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY") ?? "";

const MAX_USER_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 12;
const ANTHROPIC_MAX_TOKENS = 4096;
const ANTHROPIC_TIMEOUT_MS = 90_000;
const MAX_AGENT_ITERATIONS = 6;
const MAX_TOOL_RESULT_BYTES = 8000;

interface RequestBody {
  conversation_id?: string;
  message: string;
  route?: string;
  enable_web?: boolean;
  context?: {
    kind?: string;
    entity_id?: string | null;
    title?: string | null;
    route?: string | null;
    evidence?: string | null;
  };
}

/* ─── Conversation persistence ──────────────────────────────────────────── */

async function lookupWorkspace(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", userId)
    .maybeSingle();
  return ((data as Record<string, unknown> | null)?.active_workspace_id as string) ?? "default";
}

async function ensureConversation(
  admin: SupabaseClient,
  userId: string,
  workspaceId: string,
  conversationId: string | undefined,
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
      input_mode: "text",
      route_at_start: route ?? null,
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(`conversation insert failed: ${error?.message ?? "unknown"}`);
  return data.id as string;
}

/**
 * The set of strings we NEVER want as a real iron message — these are
 * orchestrator placeholder values that leaked into iron_messages before
 * the Wave 7.3 routing fix. Any iron row whose trimmed content equals one
 * of these is noise and must be dropped from history before the agent sees it.
 */
const ORCHESTRATOR_NOISE_CONTENTS = new Set([
  "READ_ANSWER",
  "AGENTIC_TASK",
  "FLOW_DISPATCH",
  "HUMAN_ESCALATION",
  "CLARIFY",
  "COST_LIMIT",
]);

type HistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * Clean up the raw iron_messages history into a form the Anthropic API
 * will accept without choking. Three passes:
 *
 *   1. Drop noise iron rows (orchestrator placeholder categories).
 *   2. Dedupe consecutive same-role + same-content rows (happens when the
 *      orchestrator AND iron-knowledge both insert the same user message).
 *   3. Enforce strict role alternation — if two consecutive rows have the
 *      same role after dedupe, keep only the latest. Anthropic's Messages
 *      API rejects non-alternating sequences on the user side.
 *
 * Also ensures the final sequence doesn't end with an orphan user row
 * (we drop the current turn's user row since the caller appends it
 * explicitly to the agent messages array).
 */
function sanitizeHistory(
  rows: Array<{ role: string; content: string }>,
  currentUserText: string,
): HistoryTurn[] {
  // Pass 1: drop noise rows + normalize role
  const filtered: HistoryTurn[] = [];
  for (const row of rows) {
    if (typeof row.content !== "string") continue;
    const content = row.content.trim();
    if (!content) continue;
    const role: "user" | "assistant" =
      row.role === "iron" ? "assistant" : "user";
    if (role === "assistant" && ORCHESTRATOR_NOISE_CONTENTS.has(content)) {
      continue;
    }
    filtered.push({ role, content });
  }

  // Pass 2: dedupe consecutive same-role + same-content
  const deduped: HistoryTurn[] = [];
  for (const turn of filtered) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.role === turn.role && prev.content === turn.content) {
      continue;
    }
    deduped.push(turn);
  }

  // Pass 3: enforce strict role alternation (keep latest of any run).
  // Anthropic accepts consecutive tool_use blocks but not two plain user
  // turns in a row; collapsing here is safer than guessing what the API
  // will accept.
  const alternating: HistoryTurn[] = [];
  for (const turn of deduped) {
    const prev = alternating[alternating.length - 1];
    if (prev && prev.role === turn.role) {
      // Replace the prior same-role turn rather than appending
      alternating[alternating.length - 1] = turn;
      continue;
    }
    alternating.push(turn);
  }

  // Drop the current-turn user row if it's still at the tail — the caller
  // appends the current user message explicitly and we don't want a
  // duplicate at the end of the messages array.
  while (alternating.length > 0) {
    const tail = alternating[alternating.length - 1];
    if (tail.role === "user" && tail.content.trim() === currentUserText.trim()) {
      alternating.pop();
      continue;
    }
    break;
  }

  // Conversation must START with a user turn or be empty.
  while (alternating.length > 0 && alternating[0].role !== "user") {
    alternating.shift();
  }

  return alternating;
}

async function loadConversationHistory(
  admin: SupabaseClient,
  conversationId: string,
  limit: number,
  currentUserText: string,
): Promise<HistoryTurn[]> {
  // Overfetch so the sanitizer has enough rows to dedupe from — the final
  // result is capped at `limit` turns after cleaning.
  const { data } = await admin
    .from("iron_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit * 3);
  if (!data) return [];
  const sanitized = sanitizeHistory(
    data as Array<{ role: string; content: string }>,
    currentUserText,
  );
  // Keep the most recent `limit` turns
  return sanitized.slice(-limit);
}

/* ─── Cost ladder ───────────────────────────────────────────────────────── */

interface DegradationState {
  state: "full" | "reduced" | "cached" | "escalated";
  tokens_today: number;
}

// Wave 7.3 cost-ladder rebalance: match the orchestrator's DEFAULT_CAPS.
// Keep these two numbers in sync with iron-orchestrator/index.ts. Deferred
// cleanup: unify both functions to read from workspace_settings.iron_*
// columns via a shared helper instead of hardcoding.
const SOFT_CAP_TOKENS = 50_000;
const HARD_CAP_TOKENS = 150_000;

async function loadDegradationState(
  admin: SupabaseClient,
  userId: string,
): Promise<DegradationState> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("iron_usage_counters")
    .select("tokens_in, tokens_out, degradation_state")
    .eq("user_id", userId)
    .eq("bucket_date", today)
    .maybeSingle();

  const tokens = (data?.tokens_in ?? 0) + (data?.tokens_out ?? 0);
  let state: DegradationState["state"] = "full";
  if (tokens >= HARD_CAP_TOKENS) state = "cached";
  else if (tokens >= SOFT_CAP_TOKENS) state = "reduced";
  return { state, tokens_today: tokens };
}

/* ─── Anthropic types ───────────────────────────────────────────────────── */

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AgentMessage {
  role: "user" | "assistant";
  content: string | Array<AnthropicContentBlock | { type: "tool_result"; tool_use_id: string; content: string }>;
}

/* ─── Pre-retrieval evidence injection ─────────────────────────────────── */

/**
 * Run a quick semantic + keyword retrieval pass BEFORE the agent loop.
 * This gives the model pre-loaded evidence in its system prompt — the
 * same strategy that makes the standalone Knowledge Chat more accurate.
 * The agent can still call semantic_kb_search for additional lookups,
 * but this ensures relevant documents are available from turn 1.
 */
async function preRetrieveEvidence(
  admin: SupabaseClient,
  message: string,
  workspaceId: string,
  userRole: string,
): Promise<string | null> {
  try {
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(message);
    } catch {
      // Continue with keyword-only retrieval
    }

    const { data, error } = await admin.rpc("retrieve_document_evidence", {
      query_embedding: embedding ? formatVectorLiteral(embedding) : null,
      keyword_query: message.slice(0, 200),
      user_role: userRole,
      match_count: 8,
      semantic_match_threshold: 0.45,
      p_workspace_id: workspaceId,
    });

    if (error || !Array.isArray(data) || data.length === 0) return null;

    const ranked = await rerankKbEvidence(
      message,
      data as KbEvidenceRow[],
      { loggerTag: "iron-knowledge.pre-retrieve", finalCount: 4 },
    );

    if (ranked.length === 0) return null;

    // For single-hit, try to hydrate full document text
    if (ranked.length === 1) {
      const docId = ranked[0].source_id;
      const { data: doc } = await admin
        .from("documents")
        .select("raw_text")
        .eq("id", docId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (doc?.raw_text?.trim()) {
        const fullText = (doc.raw_text as string).replace(/\s+/g, " ").trim();
        const excerpt = fullText.length > 12000 ? fullText.slice(0, 11999) + "…" : fullText;
        return `## Pre-loaded Knowledge Base Evidence\n\n### ${ranked[0].source_title ?? "Document"}\n${excerpt}`;
      }
    }

    const blocks = ranked.map((row) => {
      const excerpt = buildEvidenceExcerpt(row);
      return `### ${row.source_title ?? "Untitled"}\n${excerpt.slice(0, 2400)}`;
    });

    return `## Pre-loaded Knowledge Base Evidence\n\n${blocks.join("\n\n")}`;
  } catch (err) {
    console.warn("[iron-knowledge] pre-retrieval failed (non-fatal):", err);
    return null;
  }
}

/* ─── System prompt ─────────────────────────────────────────────────────── */

function buildSystemPrompt(
  route: string | undefined,
  preloadedEvidence: string | null,
  context:
    | {
        kind?: string;
        entity_id?: string | null;
        title?: string | null;
        route?: string | null;
        evidence?: string | null;
      }
    | undefined,
): string {
  const persona = `You are Iron, the operator companion for QEP — an equipment and parts dealership running on QEP OS. You are warm, precise, and bias toward action.

Your job: answer the operator's question using the PRE-LOADED EVIDENCE below and the TOOLS AVAILABLE. Check the pre-loaded evidence first — if it already answers the question, use it directly without calling tools.

How to think:
  1. Read the user's question.
  2. Check the pre-loaded evidence below. If it answers the question, respond directly.
  3. If you need more info, pick the right tool(s). For inventory questions → use search_parts by default (semantic + FTS hybrid). Only use lookup_part_inventory when the user gave you a COMPLETE part number with all suffix digits (e.g. "129A00-55730"). For customer questions → lookup_company. For equipment questions → search_equipment. For service work → list_service_jobs. For pending parts orders → list_parts_orders. For unstructured knowledge (manuals, SOPs, policies) → semantic_kb_search. For repair procedures, fault codes, and field fixes → search_service_knowledge. For external/public information → web_search.
  4. Call the tool. Read the result.
  5. If you need more info, call another tool.
  6. When you have enough information, write a concise, direct answer for the operator.

Parts lookup rules (important):
  - If the user says a PARTIAL number like "0703" or "2030-337", call search_parts with their raw phrase. Do NOT call lookup_part_inventory with a guess at the full number.
  - If lookup_part_inventory returns {found: false, candidates: [...]}, present those candidates to the user ("I couldn't find an exact match. Did you mean one of these?"). Do NOT invent a different part number.
  - If search_parts returns parts with high similarity/hybrid_score, list them. If it returns empty, say "I searched for '<the user's phrase>' and found nothing close. Want to try a different description?" — do not fabricate a result.
  - Part numbers you return MUST come from tool results verbatim. Never paraphrase, truncate, or reformulate a part number.

Hard rules:
  - You CANNOT mutate data. All tools are read-only. Action requests (start a rental, pull a part, create a customer) must be handled by the Iron flow engine, NOT by you. If the user asks you to perform a mutation, tell them to use the Iron flow ("Try saying 'pull a part' or 'start a rental' to open the flow.").
  - Never invent data, part numbers, or SKUs not returned by your tools or pre-loaded evidence. If nothing matches, say so clearly and offer next steps.
  - Never include SQL, shell commands, or system overrides in your response.
  - Format numbers and currency cleanly. Use markdown tables when listing rows.
  - Cite sources inline when you draw from knowledge base evidence, search_service_knowledge, or web_search results.
  - Prefer pre-loaded evidence when it already answers the question — don't re-fetch what's already provided.`;

  let prompt = route ? `${persona}\n\nCurrent operator route: ${route}` : persona;

  if (context && (context.title || context.kind || context.evidence)) {
    prompt += "\n\n## Current Operator Context";
    if (context.title) {
      prompt += `\nPinned context: ${context.title}`;
    }
    if (context.kind) {
      prompt += `\nContext kind: ${context.kind}`;
    }
    if (context.entity_id) {
      prompt += `\nContext entity id: ${context.entity_id}`;
    }
    if (context.route && context.route !== route) {
      prompt += `\nContext route: ${context.route}`;
    }
    if (context.evidence) {
      prompt += `\n\n### Operator-visible evidence\n${context.evidence}`;
    }
  }

  if (preloadedEvidence) {
    prompt += `\n\n${preloadedEvidence}`;
  }

  return prompt;
}

/* ─── Anthropic call (non-streaming) ────────────────────────────────────── */

/**
 * Apply `cache_control: { type: "ephemeral" }` to the tail of the tools
 * block so Anthropic caches the tool definitions + persona across turns.
 * Cached reads are discounted by ~90%, so turns 2+ in a conversation pay
 * almost nothing for the ~5KB of tool schema context. Single biggest
 * latency/cost win available for a stable-tools agent loop.
 *
 * Anthropic spec: up to 4 cache_control breakpoints per request. We use
 * two — one on the system prompt and one on the last tool definition —
 * which covers persona + tool registry. Messages remain uncached because
 * they change every turn.
 */
const CACHED_TOOL_DEFINITIONS = (() => {
  // Clone and attach cache_control to the final tool. When Anthropic sees
  // the breakpoint it caches the entire tools array up to and including
  // that tool.
  const copy = IRON_TOOL_DEFINITIONS.map((t) => ({ ...t }));
  if (copy.length > 0) {
    (copy[copy.length - 1] as Record<string, unknown>).cache_control = {
      type: "ephemeral",
    };
  }
  return copy;
})();

async function callAnthropicWithTools(
  model: string,
  systemPrompt: string,
  messages: AgentMessage[],
): Promise<AnthropicMessageResponse> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      // System prompt as an array with a cache breakpoint — this keeps
      // the persona text cached between turns.
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: CACHED_TOOL_DEFINITIONS,
      messages,
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 400)}`);
  }

  return (await res.json()) as AnthropicMessageResponse;
}

/* ─── Agent loop ────────────────────────────────────────────────────────── */

interface AgentResult {
  finalText: string;
  toolsUsed: Array<{ name: string; input: unknown; result_summary: string }>;
  totalTokensIn: number;
  totalTokensOut: number;
  iterations: number;
  stopReason: string;
}

function summarizeToolResult(result: unknown): string {
  try {
    const json = JSON.stringify(result);
    if (json.length <= 240) return json;
    return json.slice(0, 237) + "...";
  } catch {
    return "<unserializable>";
  }
}

function truncateForModel(json: string): string {
  if (json.length <= MAX_TOOL_RESULT_BYTES) return json;
  // Truncate large results so the model context doesn't blow up
  return json.slice(0, MAX_TOOL_RESULT_BYTES - 50) + `\n... (truncated, ${json.length} bytes total)`;
}

async function runAgentLoop(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  ctx: ToolContext,
  model: string,
): Promise<AgentResult> {
  const messages: AgentMessage[] = [];
  for (const turn of history) messages.push({ role: turn.role, content: turn.content });
  messages.push({ role: "user", content: userMessage });

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const toolsUsed: AgentResult["toolsUsed"] = [];
  let finalText = "";
  let stopReason = "max_iterations";
  let iterations = 0;

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    iterations = i + 1;
    const response = await callAnthropicWithTools(model, systemPrompt, messages);
    totalTokensIn += response.usage.input_tokens;
    totalTokensOut += response.usage.output_tokens;
    stopReason = response.stop_reason;

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is AnthropicToolUseBlock => b.type === "tool_use",
      );

      // Append the assistant turn (text + tool_use blocks) to messages
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Execute every tool the model called this turn
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const block of toolUseBlocks) {
        const result = await executeIronTool(block.name, block.input, ctx);
        toolsUsed.push({
          name: block.name,
          input: block.input,
          result_summary: summarizeToolResult(result),
        });
        const resultJson = truncateForModel(JSON.stringify(result));
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultJson,
        });
      }

      messages.push({ role: "user", content: toolResults });
      // Loop again — model will see tool results and either call more tools or write final answer
      continue;
    }

    // Not tool_use → model returned a final text answer
    const textBlocks = response.content.filter(
      (b): b is AnthropicTextBlock => b.type === "text",
    );
    finalText = textBlocks.map((b) => b.text).join("\n").trim();
    break;
  }

  if (!finalText && stopReason === "max_iterations") {
    finalText =
      "I hit the maximum number of tool calls without reaching a final answer. Try narrowing your question or asking it more directly.";
  }

  return { finalText, toolsUsed, totalTokensIn, totalTokensOut, iterations, stopReason };
}

/* ─── Stream chunking ───────────────────────────────────────────────────── */

function chunkText(text: string, maxChunkChars = 80): string[] {
  if (!text) return [];
  // Split by sentence boundaries first, then word-bound the long ones
  const sentences = text.match(/[^.!?\n]+[.!?\n]?/g) ?? [text];
  const chunks: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if ((buffer + sentence).length > maxChunkChars && buffer.length > 0) {
      chunks.push(buffer);
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks;
}

/* ─── Main handler ──────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return safeJsonError("message is required", 400, origin);
  if (message.length > MAX_USER_MESSAGE_CHARS) {
    return safeJsonError("message too long", 400, origin);
  }

  const traceId = crypto.randomUUID();
  const userId = auth.userId;
  const role = auth.role;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const workspaceId = await lookupWorkspace(auth.supabase, userId);

  // Cost ladder
  const degradation = await loadDegradationState(admin, userId);
  if (degradation.state === "cached" || degradation.state === "escalated") {
    return safeJsonOk(
      {
        ok: false,
        category: "COST_LIMIT",
        message: "Your Iron usage for today is full. Resets at midnight.",
        tokens_today: degradation.tokens_today,
      },
      origin,
      200,
    );
  }
  const model = degradation.state === "full" ? IRON_MODEL_FULL : IRON_MODEL_REDUCED;

  // Conversation persistence
  const conversationId = await ensureConversation(
    admin,
    userId,
    workspaceId,
    body.conversation_id,
    body.route,
  );

  // Load prior history (sanitized — drops orchestrator noise rows and
  // dedupes consecutive same-role messages). The sanitizer also strips
  // any trailing user row matching `message` so we don't double-count
  // when the orchestrator already persisted it this turn.
  const historyForAgent = await loadConversationHistory(
    admin,
    conversationId,
    MAX_HISTORY_MESSAGES,
    message,
  );

  // Persist the current user message ONLY if the orchestrator didn't
  // already do it. We detect that by checking whether the database has
  // a user row for this conversation newer than ~5 seconds ago with
  // matching content — if yes, the orchestrator handed off here and
  // already wrote it; if no, we're being called directly (e.g., via the
  // knowledge-only template path) and need to persist ourselves.
  const recentCutoff = new Date(Date.now() - 5_000).toISOString();
  const { data: recentUserRows } = await admin
    .from("iron_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .eq("content", redactString(message))
    .gte("created_at", recentCutoff)
    .limit(1);
  const orchestratorAlreadyPersisted = (recentUserRows ?? []).length > 0;

  if (!orchestratorAlreadyPersisted) {
    await admin.from("iron_messages").insert({
      conversation_id: conversationId,
      workspace_id: workspaceId,
      user_id: userId,
      role: "user",
      content: redactString(message),
      classifier_output: null,
    });
  }

  // Pre-retrieve knowledge base evidence to inject into system prompt
  // (same strategy that makes the standalone Knowledge Chat more accurate)
  const preloadedEvidence = await preRetrieveEvidence(admin, message, workspaceId, role);
  const systemPrompt = buildSystemPrompt(body.route, preloadedEvidence, body.context);
  const toolCtx: ToolContext = {
    admin,
    workspaceId,
    userRole: role,
    tavilyApiKey: TAVILY_API_KEY,
  };

  // Run the agent loop
  let agentResult: AgentResult;
  try {
    agentResult = await runAgentLoop(
      systemPrompt,
      historyForAgent,
      message,
      toolCtx,
      model,
    );
  } catch (err) {
    return safeJsonError(`agent_failed: ${(err as Error).message}`, 502, origin);
  }

  // Build the SSE response
  const meta = {
    trace_id: traceId,
    conversation_id: conversationId,
    model,
    degradation_state: degradation.state,
    tokens_today: degradation.tokens_today,
    iterations: agentResult.iterations,
    tools_used: agentResult.toolsUsed.map((t) => t.name),
    stop_reason: agentResult.stopReason,
  };

  const sources = agentResult.toolsUsed.map((t, idx) => ({
    id: `tool-${idx}`,
    title: `${t.name}(${JSON.stringify(t.input).slice(0, 80)})`,
    kind: "tool" as const,
    confidence: 1.0,
    excerpt: t.result_summary,
    marker: `#${idx + 1}`,
  }));

  const encoder = new TextEncoder();
  const finalStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ meta })}\n\n`));

      // Sentence-chunk the final text for visible streaming feel
      const chunks = chunkText(agentResult.finalText, 80);
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
        );
        // small delay so the user perceives streaming, not a wall of text
        await new Promise((r) => setTimeout(r, 12));
      }

      if (sources.length > 0) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();

      // Persist assistant message + usage (fire-and-forget)
      void (async () => {
        try {
          await admin.from("iron_messages").insert({
            conversation_id: conversationId,
            workspace_id: workspaceId,
            user_id: userId,
            role: "iron",
            content: redactString(agentResult.finalText),
            classifier_output: {
              model,
              tools_used: agentResult.toolsUsed.map((t) => t.name),
              iterations: agentResult.iterations,
              stop_reason: agentResult.stopReason,
            } as Record<string, unknown>,
            tokens_in: agentResult.totalTokensIn,
            tokens_out: agentResult.totalTokensOut,
            model,
          });
          await admin.rpc("iron_increment_usage", {
            p_user_id: userId,
            p_workspace_id: workspaceId,
            p_classifications: 0,
            p_tokens_in: agentResult.totalTokensIn,
            p_tokens_out: agentResult.totalTokensOut,
            p_flow_executes: 0,
            p_cost_usd_micro: 0,
          });
        } catch (err) {
          console.error(`[iron-knowledge:${traceId}] post-stream persist failed`, err);
        }
      })();
    },
  });

  return new Response(finalStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Trace-Id": traceId,
      "X-Iron-Conversation-Id": conversationId,
      "Access-Control-Allow-Origin": origin ?? "",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
});
