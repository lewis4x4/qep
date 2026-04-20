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
}

export interface AskIronRequest {
  question: string;
  history?: Array<{ role: AskIronMessageRole; content: string }>;
}
