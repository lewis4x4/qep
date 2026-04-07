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

/**
 * Generic entity picker query — used by the slot-fill UI for entity_picker
 * slots. Reads through the user JWT, so RLS scopes results to the user's
 * workspace.
 */
export async function ironSearchEntities(opts: {
  table: string;
  search_column: string;
  query: string;
  limit?: number;
}): Promise<Array<{ id: string; label: string; updated_at?: string }>> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        ilike: (col: string, pattern: string) => {
          limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;
        };
      };
    };
  };

  const term = `%${opts.query.replace(/[%_]/g, "")}%`;
  const result = await sb
    .from(opts.table)
    .select(`id, ${opts.search_column}, updated_at`)
    .ilike(opts.search_column, term)
    .limit(opts.limit ?? 10);

  if (result.error) throw new Error(result.error.message ?? "entity search failed");
  return (result.data ?? []).map((row) => ({
    id: row.id as string,
    label: String(row[opts.search_column] ?? ""),
    updated_at: row.updated_at as string | undefined,
  }));
}
