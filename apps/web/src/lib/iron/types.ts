/**
 * Wave 7 Iron Companion — client-side type contracts.
 *
 * These mirror the slot schema declared in
 * supabase/functions/_shared/flow-engine/types.ts (IronFlowMetadata) and the
 * orchestrator/execute response shapes. Kept here so the client doesn't pull
 * Deno-flavoured imports.
 */

export type IronAvatarState =
  | "idle"
  | "thinking"
  | "speaking"
  | "listening"
  | "alert"
  | "flow_active"
  | "success";

export type IronSlotType =
  | "text"
  | "longtext"
  | "number"
  | "currency"
  | "entity_picker"
  | "choice"
  | "line_items"
  | "review";

export interface IronSlotDefinition {
  id: string;
  label: string;
  type: IronSlotType;
  required?: boolean;
  entity_table?: string;
  entity_search_column?: string;
  choices?: Array<{ value: string; label: string }>;
  placeholder?: string;
  helper_text?: string;
  prefill_from?: string;
  default_value?: unknown;
  show_if?: { slot_id: string; equals?: unknown; in?: unknown[]; truthy?: boolean };
  merge_strategy?: "reject" | "auto_if_unrelated" | "prompt_diff";
}

export interface IronFlowMetadata {
  iron_role: "iron_man" | "iron_woman" | "iron_advisor" | "iron_manager";
  short_label: string;
  voice_intent_keywords: string[];
  voice_open_prompt: string;
  voice_review_prompt: string;
  slot_schema: IronSlotDefinition[];
  action_key: string;
  prefill_from_route?: Record<string, string>;
}

export type IronClassifierCategory =
  | "FLOW_DISPATCH"
  | "READ_ANSWER"
  | "AGENTIC_TASK"
  | "HUMAN_ESCALATION"
  | "CLARIFY"
  | "COST_LIMIT";

export interface IronClassifierResult {
  category: IronClassifierCategory;
  confidence: number;
  flow_id: string | null;
  prefilled_slots: Record<string, unknown> | null;
  answer_query: string | null;
  agentic_brief: string | null;
  escalation_reason: string | null;
  clarification_needed: string | null;
}

export interface IronFlowDefinitionLite {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iron_metadata: IronFlowMetadata;
  high_value_threshold_cents: number | null;
}

export interface IronOrchestratorResponse {
  ok: boolean;
  conversation_id?: string;
  classification?: IronClassifierResult;
  flow_definition?: IronFlowDefinitionLite | null;
  degradation_state?: "full" | "reduced" | "cached" | "escalated";
  tokens_today?: number;
  latency_ms?: number;
  model?: string;
  message?: string;
  category?: string;
}

export interface IronLineItem {
  part_number: string;
  description?: string | null;
  quantity: number;
  unit_price?: number | null;
}

export interface IronExecuteResponse {
  ok: boolean;
  run_id?: string;
  status?: string;
  result?: Record<string, unknown>;
  undo_deadline?: string;
  undo_handler?: string | null;
  total_cents?: number;
  error?: string;
  failed_step?: string;
  conflict?: { slot_id: string; entity_table: string; current_updated_at: string };
  threshold_cents?: number;
  message?: string;
  replay?: boolean;
}

export interface IronUndoResponse {
  ok: boolean;
  run_id?: string;
  compensation_log?: Array<{ step: string; ok: boolean; detail?: string }>;
  error?: string;
  message?: string;
}
