/**
 * Frontend wrappers for the semantic customer matching lane (Slice B).
 *
 * embedTranscript() → POSTs to the embed-text edge function, returns the
 * 1536-dim vector or an empty array on any failure mode.
 *
 * semanticMatchCustomers() → calls the match_customers_by_embedding RPC and
 * returns a Map<customer_id, similarity>. The voice matcher reads this map
 * client-side and folds cosine hits ≥ 0.7 into its scoring.
 *
 * Both functions are fail-open: every failure path returns an empty result
 * so the matcher treats the semantic lane as a no-op.
 */
import { supabase } from "@/lib/supabase";

export async function embedTranscript(text: string, signal?: AbortSignal): Promise<number[]> {
  if (!text.trim()) return [];
  if (signal?.aborted) return [];

  const fns = (supabase as unknown as {
    functions: {
      invoke: (
        name: string,
        opts: { body: Record<string, unknown>; signal?: AbortSignal },
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
  }).functions;

  try {
    const { data, error } = await fns.invoke("embed-text", {
      body: { text },
      signal,
    });
    if (signal?.aborted) return [];
    if (error || !data || typeof data !== "object") return [];
    const arr = (data as { embedding?: unknown }).embedding;
    if (!Array.isArray(arr)) return [];
    return arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return [];
  }
}

export async function semanticMatchCustomers(
  embedding: number[],
  topK = 10,
  minSimilarity = 0.7,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  if (embedding.length === 0) return new Map();
  if (signal?.aborted) return new Map();

  try {
    const { data, error } = await (supabase as unknown as {
      rpc: (
        fn: "match_customers_by_embedding",
        args: { p_query_embedding: number[]; p_top_k: number; p_min_similarity: number },
      ) => Promise<{
        data: Array<{ customer_id: string; similarity: number }> | null;
        error: { message?: string } | null;
      }>;
    }).rpc("match_customers_by_embedding", {
      p_query_embedding: embedding,
      p_top_k: topK,
      p_min_similarity: minSimilarity,
    });

    if (signal?.aborted) return new Map();
    if (error || !data) return new Map();
    return new Map(data.map((row) => [row.customer_id, Number(row.similarity)]));
  } catch {
    return new Map();
  }
}
