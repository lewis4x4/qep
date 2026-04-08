/**
 * Wave 7 Iron Companion — client-side API wrappers around the Iron edge
 * functions.
 *
 * Two non-obvious things this file exists to defend against:
 *
 * 1. **`this.region` binding bug** — never destructure `invoke` off
 *    `supabase.functions`. The FunctionsClient.invoke method dereferences
 *    `this.region` internally, so calling it as a free function throws
 *    "undefined is not an object (evaluating 'this.region')" in Safari.
 *    Always invoke through the live receiver.
 *
 * 2. **`fetchWithAuth` falls back to the anon key** — when no user session
 *    is hydrated yet, supabase-js's internal fetchWithAuth helper sets
 *    `Authorization: Bearer <ANON_KEY>` instead of failing loudly. The
 *    function then receives the anon key as a "user JWT", calls
 *    `auth.getUser(<anon-key>)`, and Supabase Auth correctly returns
 *    "Invalid JWT" because the anon key has no `sub` claim. The operator
 *    sees a meaningless 401.
 *
 *    To dodge this, every Iron call here EXPLICITLY resolves the session
 *    via `supabase.auth.getSession()` first and passes the access token
 *    in the invoke-level `headers` override. fetchWithAuth's
 *    `if (!headers.has('Authorization'))` check then leaves it alone.
 *    If there's no session at all, we fail with a clear "not signed in"
 *    message instead of letting the anon key reach the function.
 */
import { supabase } from "@/lib/supabase";
import type {
  IronExecuteResponse,
  IronOrchestratorResponse,
  IronUndoResponse,
} from "./types";

interface InvokeError {
  message?: string;
  name?: string;
  /** FunctionsHttpError carries the failed Response in `context`. */
  context?: Response;
}

interface InvokeResult<T> {
  data: T | null;
  error: InvokeError | null;
}

type SupabaseWithFunctions = {
  functions: {
    invoke: <T>(
      name: string,
      opts: { body: unknown; headers?: Record<string, string> },
    ) => Promise<InvokeResult<T>>;
  };
};

/**
 * Extract the real error message from a Supabase functions invoke error.
 *
 * The default `error.message` is "Edge Function returned a non-2xx status code"
 * — useless for diagnosis. The actual function response body lives in
 * `error.context` (a Response object). Read it, parse JSON if possible,
 * and surface whichever field carries meaning.
 */
async function explainInvokeError(error: InvokeError, fallback: string): Promise<string> {
  const ctx = error.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const text = await ctx.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: string; message?: string };
          const real = parsed?.error ?? parsed?.message;
          if (real && typeof real === "string") {
            return `${real} (HTTP ${ctx.status})`;
          }
        } catch {
          // Not JSON — return the first 200 chars of the body
          return `${text.slice(0, 200)} (HTTP ${ctx.status})`;
        }
        return `HTTP ${ctx.status}`;
      }
      return `HTTP ${ctx.status}`;
    } catch {
      // Body already consumed or not readable
    }
  }
  return error.message ?? fallback;
}

/**
 * Resolve the current user's FRESH access token, refreshing if needed.
 *
 * Why this is more than a one-liner: `auth.getSession()` is a passive
 * read of localStorage. It returns whatever token is stored, even if it
 * expired hours ago. supabase-js's auto-refresh runs in the background
 * on focus events and a few other triggers, but it does NOT run when
 * you call `getSession()` for an expired token. So if a user signs in,
 * walks away for >1 hour (the default jwt_expiry), and comes back, every
 * call to `getSession()` returns the dead access token until something
 * else triggers a refresh.
 *
 * This helper:
 *   1. Reads the current session
 *   2. Checks expires_at against now() with a 30s skew
 *   3. If expired or about to expire, explicitly calls refreshSession()
 *      which uses the still-valid refresh_token to mint a new access_token
 *   4. Returns whichever access_token is now fresh
 *   5. Throws a friendly "please reload + sign in" if the refresh itself
 *      fails (refresh_token revoked/expired) — which means the user has
 *      to actually re-authenticate
 */
async function requireUserAccessToken(): Promise<string> {
  const sb = supabase as unknown as {
    auth: {
      getSession: () => Promise<{
        data: { session: { access_token?: string | null; expires_at?: number | null } | null };
        error: { message?: string } | null;
      }>;
      refreshSession: () => Promise<{
        data: { session: { access_token?: string | null } | null };
        error: { message?: string } | null;
      }>;
    };
  };

  const { data, error } = await sb.auth.getSession();
  if (error) {
    throw new Error(`Iron auth: ${error.message ?? "session lookup failed"}`);
  }
  const session = data?.session;
  if (!session?.access_token) {
    throw new Error(
      "Iron: not signed in. Please reload the page and sign in again.",
    );
  }

  // Check expiry with a 30-second clock-skew buffer. If the token is
  // expired or within 30s of expiring, force a refresh BEFORE sending
  // it to the function. Without this, every Iron call after the 1-hour
  // jwt_expiry mark fails with "Invalid JWT" until something else
  // triggers supabase-js's auto-refresh.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  if (expiresAt && expiresAt < nowSeconds + 30) {
    const { data: refreshed, error: refreshError } = await sb.auth.refreshSession();
    if (refreshError || !refreshed?.session?.access_token) {
      throw new Error(
        "Iron: session expired and refresh failed. Please reload the page and sign in again.",
      );
    }
    return refreshed.session.access_token;
  }

  return session.access_token;
}

async function invokeIron<T>(
  name: string,
  body: unknown,
  fallbackError: string,
): Promise<T> {
  // ALWAYS resolve the user's JWT explicitly. Don't trust supabase-js's
  // fetchWithAuth fallback — it will silently substitute the anon key
  // and the function will reject it as "Invalid JWT".
  const accessToken = await requireUserAccessToken();
  const fns = (supabase as unknown as SupabaseWithFunctions).functions;
  const { data, error } = await fns.invoke<T>(name, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    const real = await explainInvokeError(error, fallbackError);
    throw new Error(`${name}: ${real}`);
  }
  return (data ?? ({} as T));
}

export async function ironOrchestrate(input: {
  text: string;
  conversation_id?: string;
  input_mode?: "text" | "voice" | "hybrid";
  route?: string;
  visible_entities?: Record<string, unknown>;
}): Promise<IronOrchestratorResponse> {
  const data = await invokeIron<IronOrchestratorResponse>(
    "iron-orchestrator",
    input,
    "iron-orchestrator failed",
  );
  return data.ok === undefined ? ({ ok: false } as IronOrchestratorResponse) : data;
}

export async function ironExecuteFlowStep(input: {
  flow_id: string;
  conversation_id: string;
  idempotency_key: string;
  slots: Record<string, unknown>;
  high_value_confirmation_cents?: number;
  client_slot_updated_at?: Record<string, string>;
}): Promise<IronExecuteResponse> {
  const data = await invokeIron<IronExecuteResponse>(
    "iron-execute-flow-step",
    input,
    "iron-execute-flow-step failed",
  );
  return data.ok === undefined ? ({ ok: false } as IronExecuteResponse) : data;
}

export async function ironUndoFlowRun(input: { run_id: string }): Promise<IronUndoResponse> {
  const data = await invokeIron<IronUndoResponse>(
    "iron-undo-flow-run",
    input,
    "iron-undo-flow-run failed",
  );
  return data.ok === undefined ? ({ ok: false } as IronUndoResponse) : data;
}

/* ─── Wave 7 v1.8: cross-system memory affinity ───────────────────────── */

/**
 * Bump the user's affinity score for an entity. Called when the Iron
 * entity_picker selects a row, so Iron's own picks reinforce future
 * recall. Also called as a fire-and-forget side effect — failures are
 * swallowed because affinity is a "feels psychic" UX layer, not a
 * correctness invariant.
 *
 * Only the v1.8 entity types in iron_memory.entity_type are accepted by
 * the server-side check constraint. The RPC silently no-ops on null
 * inputs, so callers can pass through optional values without guarding.
 */
export async function ironBumpMemory(
  entityType: string,
  entityId: string,
  actionType: string = "iron_pick",
): Promise<void> {
  if (!entityType || !entityId) return;
  try {
    const sb = supabase as unknown as {
      auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
    };
    const { data: userRes } = await sb.auth.getUser();
    if (!userRes?.user?.id) return;
    await sb.rpc("iron_bump_memory", {
      p_user_id: userRes.user.id,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_action_type: actionType,
    });
  } catch (err) {
    // Swallow — affinity is best-effort
    console.debug("[ironBumpMemory] swallowed:", err);
  }
}

interface MemoryRow {
  entity_id: string;
  relevance_score: number;
  last_accessed_at: string;
}

/**
 * Generic entity picker query — used by the slot-fill UI for entity_picker
 * slots. Reads through the user JWT, so RLS scopes results to the user's
 * workspace.
 *
 * v1.8: results are merged with the user's iron_memory affinity scores
 * for the same entity_type. Scored matches float to the top of the list,
 * so the most-recently-touched records appear first. Plain ILIKE matches
 * with no memory entry are appended below in label-sort order. Memory
 * lookups happen in parallel with the search, so latency is bounded by
 * the slower of the two queries — not the sum.
 */
export async function ironSearchEntities(opts: {
  table: string;
  search_column: string;
  query: string;
  limit?: number;
}): Promise<Array<{ id: string; label: string; updated_at?: string; affinity_score?: number }>> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        ilike: (col: string, pattern: string) => {
          limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;
        };
        eq: (col: string, val: string) => {
          gt: (col: string, val: number) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: MemoryRow[] | null; error: { message?: string } | null }>;
            };
          };
        };
      };
    };
  };

  const limit = opts.limit ?? 10;
  const term = `%${opts.query.replace(/[%_]/g, "")}%`;

  // Run search and memory lookup in parallel — total latency is bounded by
  // the slower of the two, not the sum. The memory query is keyed by the
  // RLS-enforced auth.uid() so we don't need to plumb the user id through.
  const [searchResult, memoryResult] = await Promise.all([
    sb.from(opts.table)
      .select(`id, ${opts.search_column}, updated_at`)
      .ilike(opts.search_column, term)
      .limit(limit * 2), // overfetch so the memory merge has more candidates to pick from
    sb.from("iron_memory")
      .select("entity_id, relevance_score, last_accessed_at")
      .eq("entity_type", opts.table)
      .gt("relevance_score", 0.05)
      .order("relevance_score", { ascending: false })
      .limit(50),
  ]);

  if (searchResult.error) throw new Error(searchResult.error.message ?? "entity search failed");

  // Build a quick lookup of memory rows
  const memoryById = new Map<string, MemoryRow>();
  if (!memoryResult.error && memoryResult.data) {
    for (const row of memoryResult.data) {
      memoryById.set(row.entity_id, row);
    }
  }

  const rows = (searchResult.data ?? []).map((row) => {
    const id = row.id as string;
    const memory = memoryById.get(id);
    return {
      id,
      label: String(row[opts.search_column] ?? ""),
      updated_at: row.updated_at as string | undefined,
      affinity_score: memory?.relevance_score,
    };
  });

  // Sort: known affinity first (desc), then alpha by label
  rows.sort((a, b) => {
    const sa = a.affinity_score ?? -1;
    const sb = b.affinity_score ?? -1;
    if (sa !== sb) return sb - sa;
    return a.label.localeCompare(b.label);
  });

  return rows.slice(0, limit);
}
