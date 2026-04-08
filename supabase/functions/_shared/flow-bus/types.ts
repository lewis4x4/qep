/**
 * QRM Flow Bus — TypeScript types (Phase 0 P0.4).
 *
 * Mirrors the schema in supabase/migrations/209_flow_bus.sql 1:1. Includes
 * the 17 ADD-033 canonical event-object fields plus the bus-specific fields
 * (payload, published_at, idempotency_key, correlation_id, parent_event_id).
 *
 * IMPORTANT: this file lives in `_shared/flow-bus/`, NOT `_shared/flow-engine/`.
 * The flow-engine namespace is the existing workflow execution engine
 * (migrations 194-196). The flow-bus namespace is the new pub/sub bus.
 * Two distinct architectures, two distinct namespaces. Imports must be
 * unambiguous: `_shared/flow-bus/types.ts` vs `_shared/flow-engine/types.ts`.
 */

// ─── Enums ────────────────────────────────────────────────────────────────

export type FlowEventSeverity = "low" | "medium" | "high" | "critical";

export type FlowEventCommercialRelevance = "high" | "medium" | "low" | "none";

export type FlowEventStatus =
  | "pending"
  | "in_progress"
  | "resolved"
  | "escalated"
  | "expired";

// ─── Core event row (mirrors flow_events table) ──────────────────────────

/**
 * Full row shape returned when reading from `flow_events`. All ADD-033
 * fields plus bus-specific fields plus standard timestamps.
 */
export interface FlowEventRow {
  // PK + workspace
  id: string;
  workspace_id: string;

  // ADD-033 canonical event-object fields (17 total)
  event_id: string;
  event_type: string;
  source_module: string;
  source_record_id: string | null;
  customer_id: string | null;
  company_id: string | null;
  equipment_id: string | null;
  deal_id: string | null;
  severity: FlowEventSeverity | null;
  commercial_relevance: FlowEventCommercialRelevance | null;
  suggested_owner: string | null;
  required_action: string | null;
  recommended_deadline: string | null;
  draft_message: string | null;
  escalation_rule: string | null;
  status: FlowEventStatus;
  // created_at counts as the 17th ADD-033 field — defined in standard timestamps below

  // Bus-specific fields
  payload: Record<string, unknown>;
  published_at: string;
  idempotency_key: string | null;
  correlation_id: string | null;
  parent_event_id: string | null;

  // Standard timestamps
  created_at: string;
  updated_at: string;
}

/**
 * Insert shape for the publish helper. Most fields are optional — the
 * publish helper supplies defaults for `event_id`, `status`, `payload`,
 * and the database supplies `id`, `published_at`, `created_at`, `updated_at`.
 *
 * Required: `workspaceId`, `eventType`, `sourceModule`. Everything else
 * is optional and defaults to a sensible value.
 */
export interface PublishFlowEventInput {
  // Required
  workspaceId: string;
  eventType: string;
  sourceModule: string;

  // Optional ADD-033 fields
  eventId?: string;  // defaults to gen_random_uuid() in the DB
  sourceRecordId?: string;
  customerId?: string;
  companyId?: string;
  equipmentId?: string;
  dealId?: string;
  severity?: FlowEventSeverity;
  commercialRelevance?: FlowEventCommercialRelevance;
  suggestedOwner?: string;
  requiredAction?: string;
  recommendedDeadline?: string;  // ISO timestamp
  draftMessage?: string;
  escalationRule?: string;
  status?: FlowEventStatus;  // defaults to 'pending'

  // Bus-specific
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
  parentEventId?: string;
}

/**
 * Result returned from `publishFlowEvent()`. Carries the bus event id, the
 * row id, the published timestamp, and a `deduped` flag indicating whether
 * the call was a fresh insert or a hit on an existing idempotent row.
 */
export interface PublishFlowEventResult {
  eventId: string;
  rowId: string;
  publishedAt: string;
  deduped: boolean;
}

// ─── DB row insert shape (snake_case, mirrors PostgREST) ─────────────────

/**
 * The exact shape passed to `client.from('flow_events').insert(...)`.
 * Snake_case to match PostgreSQL column names. Built by `buildEventRow()`
 * from a camelCase `PublishFlowEventInput`.
 */
export interface FlowEventInsertRow {
  workspace_id: string;
  event_id?: string;
  event_type: string;
  source_module: string;
  source_record_id?: string | null;
  customer_id?: string | null;
  company_id?: string | null;
  equipment_id?: string | null;
  deal_id?: string | null;
  severity?: FlowEventSeverity | null;
  commercial_relevance?: FlowEventCommercialRelevance | null;
  suggested_owner?: string | null;
  required_action?: string | null;
  recommended_deadline?: string | null;
  draft_message?: string | null;
  escalation_rule?: string | null;
  status?: FlowEventStatus;
  payload?: Record<string, unknown>;
  idempotency_key?: string | null;
  correlation_id?: string | null;
  parent_event_id?: string | null;
}

// ─── Subscription shapes ──────────────────────────────────────────────────

export interface FlowSubscriptionRow {
  id: string;
  workspace_id: string;
  event_type_pattern: string;
  handler_module: string;
  handler_name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegisterSubscriptionInput {
  workspaceId: string;
  eventTypePattern: string;
  handlerModule: string;
  handlerName: string;
  enabled?: boolean;  // defaults to true
}

// ─── Event type registry shapes ──────────────────────────────────────────

export interface FlowEventTypeRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterEventTypeInput {
  workspaceId: string;
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
}
