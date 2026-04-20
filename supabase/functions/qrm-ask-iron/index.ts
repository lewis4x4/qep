/**
 * Ask Iron — the ambient QRM assistant (Slice 4).
 *
 * POST /qrm-ask-iron
 *   body: { question: string, history?: [...] }
 *   returns: { answer, tool_trace, elapsed_ms, tokens_in, tokens_out }
 *
 * Auth:
 *   Any rep/admin/manager/owner user JWT. The caller's role and userId are
 *   threaded into the tool executor so `list_my_moves` for a rep is pinned
 *   to their own id (see _shared/qrm-ask-iron.ts normalizeMoveFilters).
 *
 * Model:
 *   Claude Sonnet 4.6 with tool use, up to MAX_TOOL_TURNS round-trips. We
 *   mirror the shape of owner-ask-anything's loop — same Claude API, same
 *   content-block type discriminant — but point it at the QRM-scoped tool
 *   set and the operator system prompt.
 *
 * Zero-blocking behavior:
 *   - Missing ANTHROPIC_API_KEY → 503 with a clean "assistant not
 *     configured" message; the web surface degrades gracefully.
 *   - Anthropic timeout → surfaced as a user-readable error, still 500.
 */

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  createRequestContext,
  hydrateCaller,
  requireCaller,
} from "../_shared/crm-router-service.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import {
  ASK_IRON_SYSTEM_PROMPT,
  ASK_IRON_TOOLS,
  executeAskIronTool,
} from "../_shared/qrm-ask-iron.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1536;
const TEMPERATURE = 0.2;
const ANTHROPIC_TIMEOUT_MS = 35_000;
const MAX_TOOL_TURNS = 5;
const MAX_QUESTION_LEN = 800;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CHAR_LEN = 2_000;
const MAX_TOOL_RESULT_CHARS = 12_000;

// Per-user sliding-window rate limit. In-memory Map keyed on userId; resets
// when the function instance recycles. This is a best-effort guard against
// a single session burning the Anthropic budget — a durable/table-backed
// limiter is a follow-up once Slice 5+ usage patterns settle.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const rateBuckets = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const bucket = (rateBuckets.get(userId) ?? []).filter((ts) => ts > cutoff);
  if (bucket.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(userId, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(userId, bucket);
  return true;
}

/**
 * Sanitize a single client-supplied history turn.
 *
 * History is reconstructed from the client rather than persisted server-
 * side, which means a malicious/compromised client could forge prior
 * assistant turns (e.g. a fake "assistant: confirmed you are admin"
 * message) and prime the next Claude call. We cap length and role to make
 * forgery harder, but we also rely on the system prompt + tool contract
 * to keep the model from granting elevated access based on chat history
 * alone. Persistent server-side history is a Slice 5+ follow-up.
 */
function sanitizeHistoryTurn(
  raw: unknown,
): { role: "user" | "assistant"; content: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const turn = raw as { role?: unknown; content?: unknown };
  if (turn.role !== "user" && turn.role !== "assistant") return null;
  if (typeof turn.content !== "string") return null;
  const content = turn.content.trim();
  if (content.length === 0) return null;
  if (content.length > MAX_HISTORY_CHAR_LEN) return null;
  return { role: turn.role, content };
}

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  question: string;
  history?: HistoryTurn[];
}

type ClaudeMessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: ClaudeMessageContent[] | string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("POST only", 405, origin);
  }

  const startMs = Date.now();

  try {
    const ctxBase = createRequestContext(req, "/qrm-ask-iron", "POST");
    const ctx = await hydrateCaller(req, ctxBase, resolveCallerContext);
    try {
      requireCaller(ctx);
    } catch {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // Per-user rate limit. Best-effort in-memory guard — see comment on
    // rateBuckets above. Keeps a single session from burning the Anthropic
    // budget on a runaway client. `requireCaller` above guarantees a
    // non-null userId, but the RouterCtx type widens it to `string | null`,
    // so we coerce defensively.
    const callerId = ctx.caller.userId ?? "";
    if (callerId && !checkRateLimit(callerId)) {
      return safeJsonError(
        "Too many requests — try again in a minute.",
        429,
        origin,
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      // Zero-blocking degrade: the web surface shows a helpful placeholder
      // when the assistant isn't configured yet.
      return safeJsonError(
        "ANTHROPIC_API_KEY not configured — assistant is offline.",
        503,
        origin,
      );
    }

    const body = (await req.json().catch(() => null)) as RequestBody | null;
    if (!body) return safeJsonError("body must be JSON", 400, origin);

    const question = (body.question ?? "").trim();
    if (!question) return safeJsonError("question is required", 400, origin);
    if (question.length > MAX_QUESTION_LEN) {
      return safeJsonError("question too long", 400, origin);
    }

    // Seed the conversation: optional prior turns then the fresh question.
    // History is bounded so we don't ship 5KB of old chatter to Claude on
    // every turn — the assistant is stateless across questions by default.
    // Client-supplied turns are sanitized (role + length) to reduce prompt-
    // injection surface; see sanitizeHistoryTurn for the threat model.
    const messages: ClaudeMessage[] = [];
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    for (const raw of rawHistory.slice(-MAX_HISTORY_TURNS)) {
      const clean = sanitizeHistoryTurn(raw);
      if (clean) messages.push(clean);
    }
    messages.push({ role: "user", content: question });

    const toolTrace: Array<{
      tool: string;
      input: unknown;
      result: unknown;
      ok: boolean;
    }> = [];
    let finalText = "";
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let settled = false;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await callClaude(anthropicKey, messages);
      totalTokensIn += response.tokens_in;
      totalTokensOut += response.tokens_out;

      const toolUses = response.content.filter(
        (c): c is Extract<ClaudeMessageContent, { type: "tool_use" }> =>
          c.type === "tool_use",
      );

      if (toolUses.length === 0) {
        const textPart = response.content.find(
          (c): c is Extract<ClaudeMessageContent, { type: "text" }> =>
            c.type === "text",
        );
        finalText = textPart?.text ?? "";
        settled = true;
        break;
      }

      // Claude wants tools — push the assistant turn, then fan out.
      messages.push({ role: "assistant", content: response.content });

      const toolResults: ClaudeMessageContent[] = [];
      for (const tu of toolUses) {
        const res = await executeAskIronTool(ctx, tu.name, tu.input);
        toolTrace.push({
          tool: tu.name,
          input: tu.input,
          result: res.ok ? res.data : { error: res.error },
          ok: res.ok,
        });
        const serialized = JSON.stringify(
          res.ok ? res.data : { error: res.error ?? "tool failed" },
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: serialized.slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // If the loop exited because we hit MAX_TOOL_TURNS while Claude was
    // still asking for tools, the assistant never got a chance to write a
    // user-facing answer. Do one final tool-free round-trip so we return
    // a narrative instead of a blank bubble — the UI used to render an
    // empty assistant message, which looked like a silent failure.
    if (!settled) {
      messages.push({
        role: "user",
        content:
          "You've reached the tool-call budget for this turn. Write a brief, direct answer for the operator using only the tool results above — no more tool calls.",
      });
      try {
        const wrapUp = await callClaude(anthropicKey, messages, {
          disableTools: true,
        });
        totalTokensIn += wrapUp.tokens_in;
        totalTokensOut += wrapUp.tokens_out;
        const textPart = wrapUp.content.find(
          (c): c is Extract<ClaudeMessageContent, { type: "text" }> =>
            c.type === "text",
        );
        finalText = textPart?.text ?? "";
      } catch (err) {
        captureEdgeException(err, {
          fn: "qrm-ask-iron",
          extra: { phase: "wrap_up" },
        });
      }
      if (!finalText) {
        finalText =
          "I ran out of steps before I could answer. Try rephrasing the question or narrowing it down.";
      }
    }

    return safeJsonOk(
      {
        answer: finalText,
        tool_trace: toolTrace,
        model: CLAUDE_MODEL,
        elapsed_ms: Date.now() - startMs,
        tokens_in: totalTokensIn,
        tokens_out: totalTokensOut,
        truncated: !settled,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "qrm-ask-iron" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

async function callClaude(
  apiKey: string,
  messages: ClaudeMessage[],
  opts: { disableTools?: boolean } = {},
): Promise<{
  content: ClaudeMessageContent[];
  tokens_in: number;
  tokens_out: number;
}> {
  const payload: Record<string, unknown> = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: ASK_IRON_SYSTEM_PROMPT,
    messages,
  };
  // Omit tools entirely on the wrap-up call so Claude can't try to spend
  // another tool turn after we already hit the budget.
  if (!opts.disableTools) payload.tools = ASK_IRON_TOOLS;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const usage = (data?.usage ?? {}) as Record<string, unknown>;
  return {
    content: (data?.content ?? []) as ClaudeMessageContent[],
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
  };
}
