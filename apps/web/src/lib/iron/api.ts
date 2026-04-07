/**
 * Wave 7 Iron Companion — client-side API wrappers around the three Iron edge
 * functions. All calls go through `supabase.functions.invoke` so the user JWT
 * is attached automatically.
 */
import { supabase } from "@/lib/supabase";
import type {
  IronExecuteResponse,
  IronOrchestratorResponse,
  IronUndoResponse,
} from "./types";

interface InvokeResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

const invokeFn = (supabase as unknown as {
  functions: {
    invoke: (name: string, opts: { body: unknown }) => Promise<InvokeResult<unknown>>;
  };
}).functions.invoke;

export async function ironOrchestrate(input: {
  text: string;
  conversation_id?: string;
  input_mode?: "text" | "voice" | "hybrid";
  route?: string;
  visible_entities?: Record<string, unknown>;
}): Promise<IronOrchestratorResponse> {
  const { data, error } = await invokeFn("iron-orchestrator", { body: input });
  if (error) throw new Error(error.message ?? "iron-orchestrator failed");
  return (data ?? { ok: false }) as IronOrchestratorResponse;
}

export async function ironExecuteFlowStep(input: {
  flow_id: string;
  conversation_id: string;
  idempotency_key: string;
  slots: Record<string, unknown>;
  high_value_confirmation_cents?: number;
  client_slot_updated_at?: Record<string, string>;
}): Promise<IronExecuteResponse> {
  const { data, error } = await invokeFn("iron-execute-flow-step", { body: input });
  if (error) throw new Error(error.message ?? "iron-execute-flow-step failed");
  return (data ?? { ok: false }) as IronExecuteResponse;
}

export async function ironUndoFlowRun(input: { run_id: string }): Promise<IronUndoResponse> {
  const { data, error } = await invokeFn("iron-undo-flow-run", { body: input });
  if (error) throw new Error(error.message ?? "iron-undo-flow-run failed");
  return (data ?? { ok: false }) as IronUndoResponse;
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
