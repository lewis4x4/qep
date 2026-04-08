/**
 * Deno tests for the QRM Flow Bus publish helper (Phase 0 P0.4).
 *
 * Run with:
 *   deno test supabase/functions/_shared/flow-bus/publish.test.ts
 *
 * Pure-function tests pin the row builder + validation contract. A small
 * mocked-client section verifies the dedupe round-trip + error propagation
 * without needing a real database.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  buildEventRow,
  FlowBusValidationError,
  publishFlowEvent,
  validatePublishInput,
} from "./publish.ts";
import type { PublishFlowEventInput } from "./types.ts";

// ─── validatePublishInput ─────────────────────────────────────────────────

Deno.test("validatePublishInput accepts a minimal valid input", () => {
  validatePublishInput({
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
  });
});

Deno.test("validatePublishInput rejects empty workspaceId", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
      }),
    FlowBusValidationError,
    "workspaceId is required",
  );
});

Deno.test("validatePublishInput rejects whitespace-only workspaceId", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "   ",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
      }),
    FlowBusValidationError,
    "workspaceId is required",
  );
});

Deno.test("validatePublishInput rejects empty eventType", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "default",
        eventType: "",
        sourceModule: "anomaly-scan",
      }),
    FlowBusValidationError,
    "eventType is required",
  );
});

Deno.test("validatePublishInput rejects empty sourceModule", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "",
      }),
    FlowBusValidationError,
    "sourceModule is required",
  );
});

Deno.test("validatePublishInput rejects invalid severity", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
        // deno-lint-ignore no-explicit-any
        severity: "extreme" as any,
      }),
    FlowBusValidationError,
    "severity must be one of",
  );
});

Deno.test("validatePublishInput accepts all valid severity values", () => {
  for (const severity of ["low", "medium", "high", "critical"] as const) {
    validatePublishInput({
      workspaceId: "default",
      eventType: "deal.stalled",
      sourceModule: "anomaly-scan",
      severity,
    });
  }
});

Deno.test("validatePublishInput rejects invalid commercial_relevance", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
        // deno-lint-ignore no-explicit-any
        commercialRelevance: "stratospheric" as any,
      }),
    FlowBusValidationError,
    "commercialRelevance must be one of",
  );
});

Deno.test("validatePublishInput rejects invalid status", () => {
  assertThrows(
    () =>
      validatePublishInput({
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
        // deno-lint-ignore no-explicit-any
        status: "snoozed" as any,
      }),
    FlowBusValidationError,
    "status must be one of",
  );
});

// ─── buildEventRow ────────────────────────────────────────────────────────

Deno.test("buildEventRow returns minimal row for minimal input", () => {
  const row = buildEventRow({
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
  });
  assertEquals(row.workspace_id, "default");
  assertEquals(row.event_type, "deal.stalled");
  assertEquals(row.source_module, "anomaly-scan");
  // Optional fields are undefined — DB defaults will fill them
  assertEquals(row.event_id, undefined);
  assertEquals(row.deal_id, undefined);
  assertEquals(row.severity, undefined);
  assertEquals(row.status, undefined);
});

Deno.test("buildEventRow populates ALL 17 ADD-033 fields when supplied", () => {
  const input: PublishFlowEventInput = {
    workspaceId: "default",
    eventId: "00000000-0000-0000-0000-000000000001",
    eventType: "deal.blocked",
    sourceModule: "anomaly-scan",
    sourceRecordId: "11111111-1111-1111-1111-111111111111",
    customerId: "22222222-2222-2222-2222-222222222222",
    companyId: "33333333-3333-3333-3333-333333333333",
    equipmentId: "44444444-4444-4444-4444-444444444444",
    dealId: "55555555-5555-5555-5555-555555555555",
    severity: "critical",
    commercialRelevance: "high",
    suggestedOwner: "66666666-6666-6666-6666-666666666666",
    requiredAction: "Resolve deposit blocker before quote expires.",
    recommendedDeadline: "2026-04-15T17:00:00.000Z",
    draftMessage: "Hi Marie, just confirming the deposit timing on your Yanmar order...",
    escalationRule: "manager_after_24h",
    status: "pending",
  };
  const row = buildEventRow(input);
  // ADD-033 #1
  assertEquals(row.event_id, "00000000-0000-0000-0000-000000000001");
  // #2
  assertEquals(row.event_type, "deal.blocked");
  // #3
  assertEquals(row.source_module, "anomaly-scan");
  // #4
  assertEquals(row.source_record_id, "11111111-1111-1111-1111-111111111111");
  // #5
  assertEquals(row.customer_id, "22222222-2222-2222-2222-222222222222");
  // #6
  assertEquals(row.company_id, "33333333-3333-3333-3333-333333333333");
  // #7
  assertEquals(row.equipment_id, "44444444-4444-4444-4444-444444444444");
  // #8
  assertEquals(row.deal_id, "55555555-5555-5555-5555-555555555555");
  // #9
  assertEquals(row.severity, "critical");
  // #10
  assertEquals(row.commercial_relevance, "high");
  // #11
  assertEquals(row.suggested_owner, "66666666-6666-6666-6666-666666666666");
  // #12
  assertEquals(row.required_action, "Resolve deposit blocker before quote expires.");
  // #13
  assertEquals(row.recommended_deadline, "2026-04-15T17:00:00.000Z");
  // #14
  assertEquals(row.draft_message, "Hi Marie, just confirming the deposit timing on your Yanmar order...");
  // #15
  assertEquals(row.escalation_rule, "manager_after_24h");
  // #16
  assertEquals(row.status, "pending");
  // #17 (created_at) — populated by DB default, not by buildEventRow
});

Deno.test("buildEventRow includes bus-specific fields when supplied", () => {
  const row = buildEventRow({
    workspaceId: "default",
    eventType: "follow_up.due",
    sourceModule: "follow-up-engine",
    payload: { touchpoint_id: "abc", cadence_id: "def" },
    idempotencyKey: "follow_up.due:abc",
    correlationId: "77777777-7777-7777-7777-777777777777",
    parentEventId: "88888888-8888-8888-8888-888888888888",
  });
  assertEquals(row.payload, { touchpoint_id: "abc", cadence_id: "def" });
  assertEquals(row.idempotency_key, "follow_up.due:abc");
  assertEquals(row.correlation_id, "77777777-7777-7777-7777-777777777777");
  assertEquals(row.parent_event_id, "88888888-8888-8888-8888-888888888888");
});

Deno.test("buildEventRow does NOT include undefined optional fields", () => {
  const row = buildEventRow({
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
    severity: "high",
    // dealId NOT supplied
  });
  // severity is set
  assertEquals(row.severity, "high");
  // dealId is NOT in the row at all (so DB default — null — applies)
  assert(!("deal_id" in row), "deal_id should not be present when not supplied");
});

// ─── Mocked-client tests for publishFlowEvent ────────────────────────────

interface MockResponse<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

interface MockClientCall {
  table: string;
  op: "insert" | "select";
  args: unknown[];
}

/**
 * Minimal Supabase client mock for testing publish round-trips. Records
 * every call so tests can assert call patterns. Returns canned responses
 * configured per test.
 */
function makeMockClient(canned: {
  insertResult?: MockResponse<{ id: string; event_id: string; published_at: string }>;
  lookupResult?: MockResponse<{ id: string; event_id: string; published_at: string }>;
}): {
  // deno-lint-ignore no-explicit-any
  client: any;
  calls: MockClientCall[];
} {
  const calls: MockClientCall[] = [];

  const insertChain = {
    select: (_cols: string) => ({
      maybeSingle: () =>
        Promise.resolve(
          canned.insertResult ?? { data: null, error: { message: "no insertResult configured" } },
        ),
    }),
  };

  const lookupChain = {
    eq: (_col: string, _val: unknown) => lookupChain,
    maybeSingle: () =>
      Promise.resolve(
        canned.lookupResult ?? { data: null, error: { message: "no lookupResult configured" } },
      ),
  };

  const fromTable = (table: string) => ({
    insert: (row: unknown) => {
      calls.push({ table, op: "insert", args: [row] });
      return insertChain;
    },
    select: (cols: string) => {
      calls.push({ table, op: "select", args: [cols] });
      return lookupChain;
    },
  });

  return {
    // deno-lint-ignore no-explicit-any
    client: { from: fromTable } as any,
    calls,
  };
}

Deno.test("publishFlowEvent fast path: returns insert result with deduped=false", async () => {
  const { client } = makeMockClient({
    insertResult: {
      data: {
        id: "row-1",
        event_id: "ev-1",
        published_at: "2026-04-08T20:00:00.000Z",
      },
      error: null,
    },
  });
  const result = await publishFlowEvent(client, {
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
  });
  assertEquals(result.eventId, "ev-1");
  assertEquals(result.rowId, "row-1");
  assertEquals(result.publishedAt, "2026-04-08T20:00:00.000Z");
  assertEquals(result.deduped, false);
});

Deno.test("publishFlowEvent dedupe path: 23505 unique violation triggers lookup, returns deduped=true", async () => {
  const { client } = makeMockClient({
    insertResult: {
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint idx_flow_events_idempotency_uq",
      },
    },
    lookupResult: {
      data: {
        id: "existing-row",
        event_id: "existing-event",
        published_at: "2026-04-07T12:00:00.000Z",
      },
      error: null,
    },
  });
  const result = await publishFlowEvent(client, {
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
    idempotencyKey: "deal.stalled:deal-abc",
  });
  assertEquals(result.eventId, "existing-event");
  assertEquals(result.rowId, "existing-row");
  assertEquals(result.publishedAt, "2026-04-07T12:00:00.000Z");
  assertEquals(result.deduped, true);
});

Deno.test("publishFlowEvent rejects validation errors before DB call", async () => {
  const { client, calls } = makeMockClient({});
  await assertRejects(
    () =>
      publishFlowEvent(client, {
        workspaceId: "",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
      }),
    FlowBusValidationError,
    "workspaceId is required",
  );
  // No DB call should have been made
  assertEquals(calls.length, 0);
});

Deno.test("publishFlowEvent propagates non-dedupe DB errors", async () => {
  const { client } = makeMockClient({
    insertResult: {
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table flow_events",
      },
    },
  });
  await assertRejects(
    () =>
      publishFlowEvent(client, {
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
      }),
    Error,
    "permission denied",
  );
});

Deno.test("publishFlowEvent throws if unique violation hit but no idempotencyKey was supplied", async () => {
  const { client } = makeMockClient({
    insertResult: {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    },
  });
  await assertRejects(
    () =>
      publishFlowEvent(client, {
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
        // no idempotencyKey
      }),
    Error,
    "unique violation but no idempotencyKey supplied",
  );
});
