/**
 * Wave 7 Iron Companion v1.3 — pattern mining cron.
 *
 * Mines iron_messages for the friction signal: user turns where the
 * orchestrator returned CLARIFY or READ_ANSWER (i.e. couldn't dispatch a
 * flow). Groups by canonicalized intent signature, counts occurrences over
 * the last 14 days, and writes one row per repeated pattern (≥5 hits) to
 * iron_flow_suggestions.
 *
 * Pipeline:
 *   1. Auth via x-internal-service-secret header (cron) OR owner JWT (manual run)
 *   2. Read user-role iron_messages from the last 14 days that have a
 *      classifier_output with category in (CLARIFY, READ_ANSWER)
 *   3. Canonicalize each message → pattern_signature
 *   4. Group, count, dedupe by user
 *   5. Upsert suggestions where occurrences ≥ MIN_OCCURRENCES via
 *      iron_upsert_flow_suggestion RPC
 *   6. Return summary with counts
 *
 * Auth:
 *   • Cron callers: x-internal-service-secret header (matches flow-runner pattern)
 *   • Manual triggers (admin "Run mining now" button): owner JWT
 *
 * Cadence: nightly. Manual invocations always allowed.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET") ?? "";

const LOOKBACK_DAYS = 14;
const MIN_OCCURRENCES = 5;
const MAX_MESSAGES = 5000; // hard ceiling on the message scan
const MAX_EXAMPLES_PER_PATTERN = 5;

// Standard English stopwords + Iron-specific filler. Anything in this set
// is dropped before signature generation. Lowercase only.
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "here", "hey", "hi", "his",
  "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "my", "of",
  "on", "or", "our", "out", "over", "please", "she", "so", "some", "th", "thanks",
  "that", "the", "their", "then", "there", "they", "this", "to", "up", "us",
  "want", "was", "we", "what", "when", "where", "which", "who", "will", "with",
  "would", "you", "your", "iron", "anyone", "okay", "ok", "yeah", "uh", "um",
  "like", "really", "actually", "going", "get", "got",
]);

interface UserMessageRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  user_id: string | null;
  content: string;
  classifier_output: { category?: string } | null;
  created_at: string;
}

interface PatternBucket {
  signature: string;
  short_label: string;
  occurrences: number;
  unique_users: Set<string>;
  examples: Array<{ message: string; conversation_id: string; occurred_at: string }>;
  first_seen_at: string;
  last_seen_at: string;
  workspace_id: string;
}

interface MiningResult {
  scanned_messages: number;
  patterns_found: number;
  patterns_above_threshold: number;
  suggestions_upserted: number;
  duration_ms: number;
}

/**
 * Convert raw user text into a stable signature. Strategy:
 *   1. lowercase + strip punctuation
 *   2. tokenize on whitespace
 *   3. drop stopwords + words ≤ 2 chars
 *   4. take first 5 remaining "content" words
 *   5. sort alphabetically (so "pull part" and "part pull" hit the same bucket)
 *   6. join with single spaces
 *
 * The sort step is the key bit — operator phrasing varies wildly but the
 * underlying noun set is what matters for "this is the same intent."
 */
function canonicalize(text: string): { signature: string; short_label: string } {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { signature: "", short_label: "" };

  const tokens = cleaned
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (tokens.length === 0) return { signature: "", short_label: "" };

  const top = tokens.slice(0, 5);
  const signature = [...top].sort().join(" ");
  // Short label keeps the original ordering for human readability
  const short_label = top.join(" ");
  return { signature, short_label };
}

async function isAuthorizedCaller(req: Request, admin: SupabaseClient): Promise<boolean> {
  const internalSecret = req.headers.get("x-internal-service-secret");
  if (internalSecret && INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return true;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  try {
    const { data: userRes } = await admin.auth.getUser(auth.slice(7));
    const userId = userRes?.user?.id;
    if (!userId) return false;
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    return profile?.role === "owner";
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (!(await isAuthorizedCaller(req, admin))) {
    return safeJsonError("unauthorized", 401, origin);
  }

  const tickStart = Date.now();
  const result: MiningResult = {
    scanned_messages: 0,
    patterns_found: 0,
    patterns_above_threshold: 0,
    suggestions_upserted: 0,
    duration_ms: 0,
  };

  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();

    // Pull user-role iron_messages from the lookback window. Filter to ones
    // with a classifier_output (i.e. actually went through the orchestrator,
    // not voice-input pre-fills before classification).
    const { data: messages, error: msgErr } = await admin
      .from("iron_messages")
      .select("id, workspace_id, conversation_id, user_id, content, classifier_output, created_at")
      .eq("role", "user")
      .gte("created_at", cutoff)
      .not("classifier_output", "is", null)
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES);

    if (msgErr) throw new Error(`message scan failed: ${msgErr.message}`);

    result.scanned_messages = (messages ?? []).length;

    // Bucket by (workspace_id, signature)
    const buckets = new Map<string, PatternBucket>();

    for (const row of (messages ?? []) as UserMessageRow[]) {
      const cls = row.classifier_output;
      const category = cls?.category;
      // We only care about friction turns: orchestrator couldn't dispatch
      // a flow OR returned a read-only answer. FLOW_DISPATCH means Iron
      // already has a flow for this; no suggestion needed.
      if (category !== "CLARIFY" && category !== "READ_ANSWER") continue;

      const { signature, short_label } = canonicalize(row.content);
      if (!signature) continue;
      // Skip absurdly short signatures (single content word) — too generic
      if (signature.split(" ").length < 2) continue;

      const key = `${row.workspace_id}::${signature}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          signature,
          short_label,
          occurrences: 0,
          unique_users: new Set<string>(),
          examples: [],
          first_seen_at: row.created_at,
          last_seen_at: row.created_at,
          workspace_id: row.workspace_id,
        };
        buckets.set(key, bucket);
      }
      bucket.occurrences++;
      if (row.user_id) bucket.unique_users.add(row.user_id);
      if (row.created_at < bucket.first_seen_at) bucket.first_seen_at = row.created_at;
      if (row.created_at > bucket.last_seen_at) bucket.last_seen_at = row.created_at;
      if (bucket.examples.length < MAX_EXAMPLES_PER_PATTERN) {
        bucket.examples.push({
          message: row.content,
          conversation_id: row.conversation_id,
          occurred_at: row.created_at,
        });
      }
    }

    result.patterns_found = buckets.size;

    // Upsert all patterns above threshold
    for (const bucket of buckets.values()) {
      if (bucket.occurrences < MIN_OCCURRENCES) continue;
      result.patterns_above_threshold++;

      try {
        const { error: upsertErr } = await admin.rpc("iron_upsert_flow_suggestion", {
          p_workspace_id: bucket.workspace_id,
          p_pattern_signature: bucket.signature,
          p_short_label: bucket.short_label,
          p_new_examples: bucket.examples,
          p_occurrence_delta: bucket.occurrences,
          p_unique_users: bucket.unique_users.size,
          p_first_seen_at: bucket.first_seen_at,
          p_last_seen_at: bucket.last_seen_at,
        });
        if (upsertErr) {
          console.warn(`[iron-pattern-mining] upsert ${bucket.signature}: ${upsertErr.message}`);
          continue;
        }
        result.suggestions_upserted++;
      } catch (err) {
        console.warn(`[iron-pattern-mining] upsert exception:`, (err as Error).message);
      }
    }

    result.duration_ms = Date.now() - tickStart;

    // Cron audit (best-effort, non-blocking)
    try {
      await admin.from("service_cron_runs").insert({
        workspace_id: "default",
        job_name: "iron-pattern-mining",
        started_at: new Date(tickStart).toISOString(),
        finished_at: new Date().toISOString(),
        ok: true,
        metadata: { ...result, lookback_days: LOOKBACK_DAYS, min_occurrences: MIN_OCCURRENCES },
      });
    } catch {
      /* swallow — service_cron_runs may not exist on every deployment */
    }

    return safeJsonOk({ ok: true, ...result }, origin);
  } catch (err) {
    console.error("[iron-pattern-mining] fatal:", err);
    return safeJsonError(`mining_failed: ${(err as Error).message}`, 500, origin);
  }
});
