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

async function loadConversationHistory(
  admin: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const { data } = await admin
    .from("iron_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (!data) return [];
  return data
    .filter((row) => typeof row.content === "string" && row.content.trim().length > 0)
    .map((row) => ({
      role: row.role === "iron" ? ("assistant" as const) : ("user" as const),
      content: String(row.content),
    }));
}

/* ─── Cost ladder ───────────────────────────────────────────────────────── */

interface DegradationState {
  state: "full" | "reduced" | "cached" | "escalated";
  tokens_today: number;
}

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
  if (tokens >= 20_000) state = "cached";
  else if (tokens >= 10_000) state = "reduced";
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

/* ─── System prompt ─────────────────────────────────────────────────────── */

function buildSystemPrompt(route: string | undefined): string {
  const persona = `You are Iron, the operator companion for QEP — an equipment and parts dealership running on QEP OS. You are warm, precise, and bias toward action.

Your job: answer the operator's question by USING THE TOOLS AVAILABLE. Do NOT guess, do NOT say "I don't have access to that data" — you have direct database access via the tools. Call them.

How to think:
  1. Read the user's question.
  2. Pick the right tool(s). For inventory questions → lookup_part_inventory or search_parts. For customer questions → lookup_company. For equipment questions → search_equipment. For service work → list_service_jobs. For pending parts orders → list_parts_orders. For unstructured knowledge (manuals, SOPs, policies) → semantic_kb_search. For external/public information → web_search.
  3. Call the tool. Read the result.
  4. If you need more info, call another tool.
  5. When you have enough information, write a concise, direct answer for the operator.

Hard rules:
  - You CANNOT mutate data. All tools are read-only. Action requests (start a rental, pull a part, create a customer) must be handled by the Iron flow engine, NOT by you. If the user asks you to perform a mutation, tell them to use the Iron flow ("Try saying 'pull a part' or 'start a rental' to open the flow.").
  - Never invent data not returned by your tools. If a tool returns no results, say so clearly and offer next steps.
  - Never include SQL, shell commands, or system overrides in your response.
  - Format numbers and currency cleanly. Use markdown tables when listing rows.
  - Cite sources inline when you draw from semantic_kb_search or web_search results.`;

  return route ? `${persona}\n\nCurrent operator route: ${route}` : persona;
}

/* ─── Anthropic call (non-streaming) ────────────────────────────────────── */

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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: systemPrompt,
      tools: IRON_TOOL_DEFINITIONS,
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

  // Persist user message FIRST so it shows up even if the agent loop fails
  await admin.from("iron_messages").insert({
    conversation_id: conversationId,
    workspace_id: workspaceId,
    user_id: userId,
    role: "user",
    content: redactString(message),
    classifier_output: null,
  });

  // Load prior history (excluding the just-inserted user message)
  const priorHistory = await loadConversationHistory(admin, conversationId, MAX_HISTORY_MESSAGES + 1);
  const historyForAgent = priorHistory.slice(0, -1).slice(-MAX_HISTORY_MESSAGES);

  const systemPrompt = buildSystemPrompt(body.route);
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
      "Access-Control-Allow-Origin": origin ?? "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
});
