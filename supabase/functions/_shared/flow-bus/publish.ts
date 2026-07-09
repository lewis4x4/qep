/**
 * QRM Flow Bus — publish helper.
 *
 * REPOINTED (N5.1 / m802): this helper used to insert into the m209
 * `flow_events` table ("Bus B") — a write-only bus with zero readers.
 * It now publishes onto the live event fabric via the `emit_event()` RPC
 * (analytics_events + pg_notify), which the flow-runner consumes through
 * the `flow_pending_events` view. `flow_events` is deprecated: rows are
 * kept as history, but nothing writes or reads it anymore.
 *
 * The public API (`publishFlowEvent`, `validatePublishInput`, input/result
 * types) is unchanged so the seven existing call sites did not move:
 * anomaly-scan, nudge-scheduler, qrm-command-center, follow-up-engine,
 * deal-timing-scan, _shared/parts-invoice, _shared/equipment-invoice.
 *
 * Field mapping:
 *   • eventType/sourceModule → emit_event p_event_type/p_source_module
 *   • entity: first of dealId → equipmentId → customerId → companyId →
 *     sourceRecordId becomes (p_entity_type, p_entity_id)
 *   • ADD-033 advisory fields + the id fields are folded into p_payload —
 *     `company_id`/`deal_id` keys matter: flow_resolve_context hydrates
 *     workflow context from them
 *   • idempotencyKey → payload.idempotency_key + a pre-emit dedupe probe
 *     against analytics_events (expression index idx_ae_flow_idempotency_key,
 *     m802). The probe is read-then-write, not constraint-backed: a
 *     concurrent same-key race can double-emit. Acceptable — these are
 *     advisory signals and workflow actions dedupe via
 *     flow_action_idempotency.
 *
 * Pure helpers (`buildEmitEventArgs`, `validatePublishInput`) are exported
 * and tested independently from the DB-bound `publishFlowEvent` function.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type {
  PublishFlowEventInput,
  PublishFlowEventResult,
} from "./types.ts";

// ─── Validation (pure) ────────────────────────────────────────────────────

const VALID_SEVERITY = new Set(["low", "medium", "high", "critical"]);
const VALID_COMMERCIAL_RELEVANCE = new Set(["high", "medium", "low", "none"]);
const VALID_STATUS = new Set([
  "pending",
  "in_progress",
  "resolved",
  "escalated",
  "expired",
]);

export class FlowBusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowBusValidationError";
  }
}

/**
 * Validate a `PublishFlowEventInput` before it touches the DB. Throws
 * `FlowBusValidationError` on any rule violation. Pure function — no IO,
 * no side effects.
 */
export function validatePublishInput(input: PublishFlowEventInput): void {
  if (!input.workspaceId || input.workspaceId.trim().length === 0) {
    throw new FlowBusValidationError("workspaceId is required");
  }
  if (!input.eventType || input.eventType.trim().length === 0) {
    throw new FlowBusValidationError("eventType is required");
  }
  if (!input.sourceModule || input.sourceModule.trim().length === 0) {
    throw new FlowBusValidationError("sourceModule is required");
  }
  if (input.severity !== undefined && !VALID_SEVERITY.has(input.severity)) {
    throw new FlowBusValidationError(
      `severity must be one of low/medium/high/critical, got '${input.severity}'`,
    );
  }
  if (
    input.commercialRelevance !== undefined &&
    !VALID_COMMERCIAL_RELEVANCE.has(input.commercialRelevance)
  ) {
    throw new FlowBusValidationError(
      `commercialRelevance must be one of high/medium/low/none, got '${input.commercialRelevance}'`,
    );
  }
  if (input.status !== undefined && !VALID_STATUS.has(input.status)) {
    throw new FlowBusValidationError(
      `status must be one of pending/in_progress/resolved/escalated/expired, got '${input.status}'`,
    );
  }
}

// ─── emit_event args builder (pure) ──────────────────────────────────────

/** Named-arg shape for the `emit_event` RPC (mig 196 signature). */
export interface EmitEventArgs {
  p_event_type: string;
  p_source_module: string;
  p_entity_type: string | null;
  p_entity_id: string | null;
  p_payload: Record<string, unknown>;
  p_workspace_id: string;
  p_correlation_id: string | null;
  p_parent_event_id: string | null;
  p_actor_type: string;
  p_actor_id: string | null;
}

/**
 * Convert a camelCase `PublishFlowEventInput` into named args for the
 * `emit_event` RPC. Entity precedence picks the most specific id; every
 * id + advisory field is folded into the payload so nothing the old bus
 * carried is lost, and `flow_resolve_context` can hydrate from
 * `company_id`/`deal_id`. Existing payload keys are never overwritten.
 *
 * Pure function — no IO, no side effects. Tested directly.
 */
export function buildEmitEventArgs(input: PublishFlowEventInput): EmitEventArgs {
  let entityType: string | null = null;
  let entityId: string | null = null;
  if (input.dealId) {
    entityType = "deal";
    entityId = input.dealId;
  } else if (input.equipmentId) {
    entityType = "equipment";
    entityId = input.equipmentId;
  } else if (input.customerId) {
    entityType = "customer";
    entityId = input.customerId;
  } else if (input.companyId) {
    entityType = "company";
    entityId = input.companyId;
  } else if (input.sourceRecordId) {
    entityType = "record";
    entityId = input.sourceRecordId;
  }

  const payload: Record<string, unknown> = { ...(input.payload ?? {}) };
  const fold = (key: string, value: unknown) => {
    if (value !== undefined && !(key in payload)) payload[key] = value;
  };
  fold("source_record_id", input.sourceRecordId);
  fold("customer_id", input.customerId);
  fold("company_id", input.companyId);
  fold("equipment_id", input.equipmentId);
  fold("deal_id", input.dealId);
  fold("severity", input.severity);
  fold("commercial_relevance", input.commercialRelevance);
  fold("suggested_owner", input.suggestedOwner);
  fold("required_action", input.requiredAction);
  fold("recommended_deadline", input.recommendedDeadline);
  fold("draft_message", input.draftMessage);
  fold("escalation_rule", input.escalationRule);
  fold("status", input.status);
  fold("idempotency_key", input.idempotencyKey);

  return {
    p_event_type: input.eventType,
    p_source_module: input.sourceModule,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_payload: payload,
    p_workspace_id: input.workspaceId,
    p_correlation_id: input.correlationId ?? null,
    p_parent_event_id: input.parentEventId ?? null,
    p_actor_type: "system",
    p_actor_id: null,
  };
}

// ─── Selectable subset for the dedupe probe ───────────────────────────────

interface ProbeRow {
  event_id: string;
  occurred_at: string;
}

// ─── Main publish entrypoint (DB-bound) ──────────────────────────────────

/**
 * Publish a flow event onto the live fabric. Calls the `emit_event` RPC
 * (inserts into `analytics_events` with `flow_event_type` set and fires
 * `pg_notify('flow_event')`) and returns the event id + published
 * timestamp + a `deduped` flag.
 *
 * If `idempotencyKey` was supplied, an existing event with the same
 * `(workspace_id, flow_event_type, properties->>'idempotency_key')` is
 * returned with `deduped: true` instead of emitting a duplicate.
 *
 * @param client  An admin/service-role Supabase client (`emit_event` is
 *                SECURITY DEFINER; analytics_events inserts are
 *                service-role territory).
 * @param input   The publish input (camelCase), validated via
 *                `validatePublishInput`.
 * @returns       PublishFlowEventResult with eventId, rowId (same value —
 *                analytics_events is keyed by event_id), publishedAt, and
 *                deduped flag.
 * @throws        FlowBusValidationError on bad input.
 * @throws        Error on any DB error (probe failure or emit_event RPC
 *                failure).
 */
export async function publishFlowEvent(
  client: SupabaseClient,
  input: PublishFlowEventInput,
): Promise<PublishFlowEventResult> {
  validatePublishInput(input);
  const args = buildEmitEventArgs(input);

  if (input.idempotencyKey) {
    const probe = await client
      .from("analytics_events")
      .select("event_id, occurred_at")
      .eq("workspace_id", input.workspaceId)
      .eq("flow_event_type", input.eventType)
      .eq("properties->>idempotency_key", input.idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (probe.error) {
      throw new Error(
        `flow event dedupe probe failed for idempotency_key='${input.idempotencyKey}': ${probe.error.message}`,
      );
    }
    if (probe.data) {
      const existing = probe.data as ProbeRow;
      return {
        eventId: existing.event_id,
        rowId: existing.event_id,
        publishedAt: existing.occurred_at,
        deduped: true,
      };
    }
  }

  const rpc = await client.rpc("emit_event", args);
  if (rpc.error || typeof rpc.data !== "string") {
    throw new Error(
      `emit_event failed for '${input.eventType}': ${rpc.error?.message ?? "no event id returned"}`,
    );
  }

  return {
    eventId: rpc.data,
    rowId: rpc.data,
    publishedAt: new Date().toISOString(),
    deduped: false,
  };
}
