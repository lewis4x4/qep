/**
 * QEP Flow Engine — shared type contracts.
 *
 * Mirrors `flow_workflow_definitions` + `flow_workflow_runs` + `flow_workflow_run_steps`
 * from migration 194 1:1. Workflow files under `supabase/functions/_shared/flow-workflows/`
 * import `FlowWorkflowDefinition` to get full IDE typing on the action chain.
 */

export type FlowEventType = string; // dot.namespace, e.g. 'quote.expired'

export type FlowConditionOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "nin"
  | "exists"
  | "within"
  | "role"
  | "count"
  | "and" | "or"
  | "not"
  | "no_recent_run";

export type FlowCondition =
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; field: string; value: unknown }
  | { op: "in" | "nin"; field: string; values: unknown[] }
  | { op: "exists"; field: string }
  | { op: "within"; field: string; hours: number }
  | { op: "role"; value: string }
  | { op: "count"; field: string; gte?: number; lte?: number }
  | { op: "and" | "or"; clauses: FlowCondition[] }
  | { op: "not"; clause: FlowCondition }
  | { op: "no_recent_run"; workflow_slug: string; hours: number };

export interface FlowActionStep {
  action_key: string;
  params: Record<string, unknown>;
  on_failure?: "continue" | "abort" | "retry";
  description?: string;
}

export interface FlowRetryPolicy {
  max: number;
  backoff: "fixed" | "exponential";
  base_seconds: number;
}

export interface FlowWorkflowDefinition {
  slug: string;
  name: string;
  description: string;
  owner_role: "ceo" | "cfo" | "coo" | "sales" | "service" | "parts" | "rental" | "accounting" | "shared";
  trigger_event_pattern: string; // exact 'quote.expired' or glob 'quote.*'
  conditions: FlowCondition[]; // implicit AND across array
  actions: FlowActionStep[];
  retry_policy?: Partial<FlowRetryPolicy>;
  affects_modules: string[];
  enabled?: boolean;
  dry_run?: boolean;
  run_cadence_seconds?: number;
}

export interface FlowEvent {
  event_id: string;
  flow_event_type: string;
  source_module: string;
  workspace_id: string;
  entity_type: string | null;
  entity_id: string | null;
  occurred_at: string;
  properties: Record<string, unknown>;
  correlation_id: string | null;
  parent_event_id: string | null;
}

/** Resolved context returned by flow_resolve_context (Slice 3 fills in real fields). */
export interface FlowContext {
  event: FlowEvent;
  // Hydrated by Slice 3 context resolver:
  company?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  equipment?: Record<string, unknown> | null;
  health_score?: number | null;
  ar_block_status?: string | null;
  customer_tier?: string | null;
  recent_runs?: Array<{ run_id: string; workflow_slug: string; status: string; finished_at: string | null }>;
  // Slice 1 keeps it minimal — runner walks event.properties.
}

export type FlowActionResult =
  | { status: "succeeded"; result: Record<string, unknown> }
  | { status: "failed"; error: string; retryable: boolean }
  | { status: "skipped"; reason: string };

export interface FlowAction {
  key: string;
  description: string;
  affects_modules: string[];
  /** Template literal with ${refs}; computed before execution. Stable for replay. */
  idempotency_key_template: string;
  /** Validates params shape. Throws on invalid. Slice 1 stub: identity. */
  validate?: (params: Record<string, unknown>) => Record<string, unknown>;
  execute: (
    params: Record<string, unknown>,
    context: FlowContext,
    deps: FlowActionDeps,
  ) => Promise<FlowActionResult>;
}

export interface FlowActionDeps {
  // Supabase admin client (service role) — actions write side effects through here.
  // Typed loosely to avoid pulling the supabase-js types into the type module.
  // deno-lint-ignore no-explicit-any
  admin: any;
  workspace_id: string;
  run_id: string;
  step_index: number;
  dry_run: boolean;
}
