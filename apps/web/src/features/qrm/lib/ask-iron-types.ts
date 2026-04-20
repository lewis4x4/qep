/**
 * Pure-type definitions for Ask Iron. Kept separate from the supabase client
 * so Bun tests can import these types without pulling in the supabase-js
 * import chain (same pattern as signals-types.ts).
 */

export type AskIronMessageRole = "user" | "assistant";

export interface AskIronMessage {
  role: AskIronMessageRole;
  content: string;
  /** Optional tool calls the model made while producing this reply. */
  toolTrace?: AskIronToolTraceEntry[];
  /** Moves Iron queued on the operator's Today during this reply. */
  proposedMoves?: AskIronProposedMove[];
}

export interface AskIronToolTraceEntry {
  tool: string;
  input: unknown;
  result: unknown;
  ok: boolean;
}

export interface AskIronResponse {
  answer: string;
  tool_trace: AskIronToolTraceEntry[];
  model: string;
  elapsed_ms: number;
  tokens_in: number;
  tokens_out: number;
  /**
   * Defensive — older edge deployments don't ship this field. Slice 6 adds
   * propose_move to the tool catalog; this counter tells the surface how
   * many Iron-authored moves landed on Today this turn.
   */
  truncated?: boolean;
  proposed_move_count?: number;
}

/**
 * A single move that Iron created on behalf of the operator this turn,
 * extracted from the tool_trace. Used by the surface to render a
 * "Queued on Today" chip below the assistant reply.
 */
export interface AskIronProposedMove {
  id: string;
  kind: string;
  title: string;
  priority: number;
  entity: { type: string; id: string } | null;
  dueAt: string | null;
}

export interface AskIronRequest {
  question: string;
  history?: Array<{ role: AskIronMessageRole; content: string }>;
}
