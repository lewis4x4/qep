/**
 * embed-text — one-shot inference wrapper around OpenAI's text-embedding-3-small.
 *
 * The voice matcher's semantic lane calls this with the transcript, then hands
 * the 1536-dim vector to match_customers_by_embedding to cosine-rank companies.
 *
 * Fail-open: missing OPENAI_API_KEY OR provider failure returns
 * `{ embedding: [] }` with 200. The client lane treats empty as no-op.
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { embedText } from "../_shared/openai-embeddings.ts";

const MAX_TEXT_CHARS = 8000;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return safeJsonError("Expected JSON body", 400, origin);
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS) : "";
  if (!text) return safeJsonOk({ embedding: [] }, origin);

  // No key → fail-open empty. Client matcher treats this as a no-op lane.
  if (!Deno.env.get("OPENAI_API_KEY")) {
    return safeJsonOk({ embedding: [] }, origin);
  }

  try {
    const embedding = await embedText(text);
    return safeJsonOk({ embedding }, origin);
  } catch {
    return safeJsonOk({ embedding: [] }, origin);
  }
});
