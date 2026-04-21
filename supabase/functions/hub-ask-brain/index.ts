/**
 * hub-ask-brain — "Ask the Project Brain" retrieval endpoint.
 *
 * Flow:
 *   1. Auth via hub-auth (stakeholders + internal, both allowed — any role in
 *      HUB_ALLOWED_ROLES).
 *   2. Embed the query via OpenAI text-embedding-3-small.
 *   3. Call match_hub_knowledge RPC (cosine similarity, workspace-scoped by
 *      the RPC itself via profiles lookup) to get top-k chunks + citation
 *      metadata.
 *   4. Ask Claude Sonnet 4.6 to answer using ONLY the retrieved chunks,
 *      citing each by numeric index (e.g., [1], [2]). Prompt enforces
 *      Rylee's plain-voice rule.
 *   5. Return { answer, citations[], model, elapsed_ms } where each citation
 *      carries the source title, drive/NotebookLM link, and chunk body.
 *
 * If no chunks match >= p_min_similarity, return a clean "not enough data"
 * response instead of hallucinating — every answer MUST be grounded.
 */

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireHubUser } from "../_shared/hub-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { embedText } from "../_shared/openai-embeddings.ts";

const ANSWER_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 640;
const TEMPERATURE = 0.2;
const ANTHROPIC_TIMEOUT_MS = 30_000;
const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_MIN_SIMILARITY = 0.7;

const SYSTEM_PROMPT = `You are Ask the Project Brain for QEP OS. You answer questions about what's been built, decided, and shipped in the Stakeholder Build Hub.

Rules (non-negotiable):
- Answer ONLY from the numbered source chunks below. Never invent facts, dates, commit SHAs, names, or dollar amounts.
- If the chunks don't support an answer, say exactly: "I don't have that in the project brain yet." Optionally suggest what would need to be added.
- Cite every non-trivial claim inline with its chunk number in square brackets, like [1] or [2, 3].
- Plain voice. Max 150 words. No bullet lists unless the user's question is itself list-shaped. No "I'd be happy to", no "Great question".
- If the user asks about something outside the hub (billing, personal contact info, etc.), politely say that's not in scope here.`;

interface RequestBody {
  query?: unknown;
  match_count?: unknown;
  min_similarity?: unknown;
}

interface Citation {
  index: number;
  source_id: string;
  chunk_index: number;
  source_title: string;
  source_type: string;
  notebooklm_source_id: string | null;
  related_build_item_id: string | null;
  related_decision_id: string | null;
  related_feedback_id: string | null;
  similarity: number;
  body: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const auth = await requireHubUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!anthropicKey) return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
    if (!openaiKey) return safeJsonError("OPENAI_API_KEY not configured", 500, origin);

    const body = ((await req.json().catch(() => null)) ?? {}) as RequestBody;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return safeJsonError("query required", 400, origin);
    if (query.length > 2000) return safeJsonError("query too long (max 2000 chars)", 400, origin);

    const matchCount = clampInt(body.match_count, 1, 20, DEFAULT_MATCH_COUNT);
    const minSim = clampFloat(body.min_similarity, 0.4, 0.95, DEFAULT_MIN_SIMILARITY);

    const startMs = Date.now();

    // 1. Embed query.
    const queryVec = await embedText(query);

    // 2. RPC — workspace isolation is enforced inside the RPC.
    const { data: matches, error: rpcErr } = await auth.supabase.rpc("match_hub_knowledge", {
      p_query_embedding: `[${queryVec.join(",")}]`,
      p_match_count: matchCount,
      p_min_similarity: minSim,
    });

    if (rpcErr) {
      throw new Error(`match_hub_knowledge failed: ${rpcErr.message}`);
    }

    const rows = (matches ?? []) as Array<{
      chunk_id: string;
      source_id: string;
      chunk_index: number;
      body: string;
      similarity: number;
      source_title: string;
      source_type: string;
      notebooklm_source_id: string | null;
      related_build_item_id: string | null;
      related_decision_id: string | null;
      related_feedback_id: string | null;
    }>;

    const citations: Citation[] = rows.map((r, i) => ({
      index: i + 1,
      source_id: r.source_id,
      chunk_index: r.chunk_index,
      source_title: r.source_title,
      source_type: r.source_type,
      notebooklm_source_id: r.notebooklm_source_id,
      related_build_item_id: r.related_build_item_id,
      related_decision_id: r.related_decision_id,
      related_feedback_id: r.related_feedback_id ?? null,
      similarity: Number(r.similarity.toFixed(3)),
      body: r.body,
    }));

    if (citations.length === 0) {
      return safeJsonOk(
        {
          answer: "I don't have that in the project brain yet.",
          citations: [],
          model: ANSWER_MODEL,
          elapsed_ms: Date.now() - startMs,
          no_matches: true,
        },
        origin,
      );
    }

    // 3. Build the prompt with numbered chunks.
    const chunksText = citations
      .map(
        (c) =>
          `[${c.index}] ${c.source_title} (${c.source_type}, similarity ${c.similarity})\n${c.body}`,
      )
      .join("\n\n---\n\n");

    const userPrompt = `Question: ${query}\n\nSource chunks:\n\n${chunksText}\n\nAnswer in plain voice with inline [n] citations. If the sources don't cover the question, say so.`;

    const answerRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANSWER_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });

    if (!answerRes.ok) {
      const text = await answerRes.text().catch(() => "");
      throw new Error(`anthropic ${answerRes.status}: ${text.slice(0, 300)}`);
    }

    const answerData = await answerRes.json();
    const textPart = ((answerData?.content ?? []) as Array<{ type: string; text?: string }>).find(
      (c) => c.type === "text",
    );
    const answer = (textPart?.text ?? "").trim();

    return safeJsonOk(
      {
        answer,
        citations,
        model: ANSWER_MODEL,
        elapsed_ms: Date.now() - startMs,
        no_matches: false,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "hub-ask-brain" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampFloat(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
