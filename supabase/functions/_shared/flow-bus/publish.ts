/**
 * QRM Flow Bus — publish helper (Phase 0 P0.4).
 *
 * Publishes events to the `flow_events` table (migration 209). Handles
 * idempotency via the table's `(workspace_id, idempotency_key)` partial
 * unique index — duplicate publishes return the existing event id with
 * `deduped: true`.
 *
 * Uses an admin/service-role Supabase client for inserts (the `flow_events`
 * RLS policy gates inserts to service-role only). Callers should pass an
 * admin client, NOT a caller (user-context) client.
 *
 * Pure helpers (`buildEventRow`, `validatePublishInput`) are exported and
 * tested independently from the DB-bound `publishFlowEvent` function.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type {
  FlowEventInsertRow,
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

// ─── Row builder (pure) ───────────────────────────────────────────────────

/**
 * Convert a camelCase `PublishFlowEventInput` into the snake_case insert
 * row shape expected by PostgREST. Drops `undefined` fields so the database
 * supplies its own defaults (event_id, status, payload, created_at, etc.).
 *
 * Pure function — no IO, no side effects. Tested directly.
 */
export function buildEventRow(input: PublishFlowEventInput): FlowEventInsertRow {
  const row: FlowEventInsertRow = {
    workspace_id: input.workspaceId,
    event_type: input.eventType,
    source_module: input.sourceModule,
  };

  // ADD-033 fields (only set if supplied — let DB defaults handle the rest)
  if (input.eventId !== undefined) row.event_id = input.eventId;
  if (input.sourceRecordId !== undefined) row.source_record_id = input.sourceRecordId;
  if (input.customerId !== undefined) row.customer_id = input.customerId;
  if (input.companyId !== undefined) row.company_id = input.companyId;
  if (input.equipmentId !== undefined) row.equipment_id = input.equipmentId;
  if (input.dealId !== undefined) row.deal_id = input.dealId;
  if (input.severity !== undefined) row.severity = input.severity;
  if (input.commercialRelevance !== undefined) {
    row.commercial_relevance = input.commercialRelevance;
  }
  if (input.suggestedOwner !== undefined) row.suggested_owner = input.suggestedOwner;
  if (input.requiredAction !== undefined) row.required_action = input.requiredAction;
  if (input.recommendedDeadline !== undefined) {
    row.recommended_deadline = input.recommendedDeadline;
  }
  if (input.draftMessage !== undefined) row.draft_message = input.draftMessage;
  if (input.escalationRule !== undefined) row.escalation_rule = input.escalationRule;
  if (input.status !== undefined) row.status = input.status;

  // Bus-specific fields
  if (input.payload !== undefined) row.payload = input.payload;
  if (input.idempotencyKey !== undefined) row.idempotency_key = input.idempotencyKey;
  if (input.correlationId !== undefined) row.correlation_id = input.correlationId;
  if (input.parentEventId !== undefined) row.parent_event_id = input.parentEventId;

  return row;
}

// ─── Postgres unique-violation detection ──────────────────────────────────

/**
 * Constraint name created by migration 209 for the bus idempotency partial
 * unique index. The publish helper ONLY treats unique violations on this
 * specific constraint as bus dedup hits — every other unique violation is
 * surfaced as a real error so future schema changes (e.g. a UNIQUE on
 * event_id) don't silently corrupt dedupe semantics.
 */
const BUS_IDEMPOTENCY_CONSTRAINT_NAME = "idx_flow_events_idempotency_uq";

/**
 * Detect a unique-constraint violation that specifically came from the bus
 * idempotency partial index. Two checks combined:
 *
 *   1. SQLSTATE 23505 (PostgreSQL canonical unique_violation), AND
 *   2. The error message names the specific constraint
 *      `idx_flow_events_idempotency_uq`.
 *
 * Without the second check, ANY 23505 from a different unique constraint
 * (existing or future) would be falsely treated as a bus dedup hit. The
 * fallback (no error.code) requires both the canonical "duplicate key value
 * violates unique constraint" phrase AND the specific constraint name —
 * still strict.
 */
function isBusIdempotencyViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  const matchesIdempotencyConstraint = msg.includes(BUS_IDEMPOTENCY_CONSTRAINT_NAME);

  // Authoritative path: SQLSTATE present + constraint name confirmed.
  if (error.code === "23505") {
    return matchesIdempotencyConstraint;
  }

  // Fallback path: SQLSTATE missing (some client variants don't surface it),
  // but the message clearly names the bus constraint AND uses the canonical
  // PostgreSQL phrasing. Both conditions must hold.
  return matchesIdempotencyConstraint && msg.includes("duplicate key value violates");
}

// ─── Selectable subset for the dedupe SELECT path ────────────────────────

interface DedupeRow {
  id: string;
  event_id: string;
  published_at: string;
}

// ─── Main publish entrypoint (DB-bound) ──────────────────────────────────

/**
 * Publish a flow event to the bus. Inserts into `flow_events` and returns
 * the resulting event id + row id + published timestamp + a `deduped` flag.
 *
 * If `idempotencyKey` was supplied AND a row with the same `(workspaceId,
 * idempotencyKey)` already exists, the function catches the unique-
 * violation, looks up the existing row, and returns its identifiers with
 * `deduped: true`. Race-safe via the unique constraint.
 *
 * The dedupe path ONLY triggers on violations of the specific bus
 * idempotency constraint (`idx_flow_events_idempotency_uq`). Violations of
 * any other unique constraint are surfaced as real errors so future schema
 * changes don't silently corrupt dedupe semantics.
 *
 * @param client  An admin/service-role Supabase client. The `flow_events`
 *                RLS policy gates inserts to service-role only.
 * @param input   The publish input (camelCase), validated via
 *                `validatePublishInput`.
 * @returns       PublishFlowEventResult with eventId, rowId, publishedAt,
 *                and deduped flag.
 * @throws        FlowBusValidationError on bad input.
 * @throws        Error on any non-validation DB error (network, RLS, etc.)
 *                including unique violations on constraints OTHER than the
 *                bus idempotency partial index.
 */
export async function publishFlowEvent(
  client: SupabaseClient,
  input: PublishFlowEventInput,
): Promise<PublishFlowEventResult> {
  validatePublishInput(input);
  const row = buildEventRow(input);

  // Fast path: insert and return immediately.
  const insertRes = await client
    .from("flow_events")
    .insert(row)
    .select("id, event_id, published_at")
    .maybeSingle();

  if (!insertRes.error && insertRes.data) {
    const data = insertRes.data as DedupeRow;
    return {
      eventId: data.event_id,
      rowId: data.id,
      publishedAt: data.published_at,
      deduped: false,
    };
  }

  // Dedupe path: unique violation on the SPECIFIC bus idempotency constraint.
  // Other unique violations are NOT treated as dedupe — they propagate as
  // real errors so future schema changes don't corrupt dedupe semantics.
  if (isBusIdempotencyViolation(insertRes.error)) {
    if (!input.idempotencyKey) {
      // Defensive: a unique violation on the idempotency constraint without
      // an idempotency_key shouldn't happen given the partial index, but if
      // it does, surface the error rather than silently swallow it.
      throw new Error(
        `flow_events insert failed with bus idempotency violation but no idempotencyKey supplied: ${insertRes.error?.message}`,
      );
    }
    const lookupRes = await client
      .from("flow_events")
      .select("id, event_id, published_at")
      .eq("workspace_id", input.workspaceId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();

    if (lookupRes.error || !lookupRes.data) {
      throw new Error(
        `flow_events dedupe lookup failed for idempotency_key='${input.idempotencyKey}': ${
          lookupRes.error?.message ?? "no row returned"
        }`,
      );
    }
    const existing = lookupRes.data as DedupeRow;
    return {
      eventId: existing.event_id,
      rowId: existing.id,
      publishedAt: existing.published_at,
      deduped: true,
    };
  }

  // Non-validation, non-bus-dedupe error — propagate.
  // This explicitly INCLUDES unique violations on constraints OTHER than
  // the bus idempotency partial index (e.g. future UNIQUE constraints on
  // event_id, or violations from other tables in the same transaction).
  throw new Error(
    `flow_events insert failed: ${insertRes.error?.message ?? "unknown error"}`,
  );
}
