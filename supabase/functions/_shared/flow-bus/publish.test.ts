/**
 * Deno tests for the QRM Flow Bus publish helper (repointed in N5.1/m802
 * from the deprecated flow_events table to the emit_event() RPC).
 *
 * Run with:
 *   deno test supabase/functions/_shared/flow-bus/publish.test.ts
 *
 * Pure-function tests pin the emit_event args builder + validation
 * contract. A small mocked-client section verifies the dedupe probe
 * round-trip + error propagation without needing a real database.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  buildEmitEventArgs,
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

// ─── buildEmitEventArgs ───────────────────────────────────────────────────

Deno.test("buildEmitEventArgs maps a minimal input to emit_event named args", () => {
  const args = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
  });
  assertEquals(args.p_event_type, "deal.stalled");
  assertEquals(args.p_source_module, "anomaly-scan");
  assertEquals(args.p_workspace_id, "default");
  assertEquals(args.p_entity_type, null);
  assertEquals(args.p_entity_id, null);
  assertEquals(args.p_payload, {});
  assertEquals(args.p_correlation_id, null);
  assertEquals(args.p_parent_event_id, null);
  assertEquals(args.p_actor_type, "system");
  assertEquals(args.p_actor_id, null);
});

Deno.test("buildEmitEventArgs entity precedence: deal wins over every other id", () => {
  const args = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "deal.blocked",
    sourceModule: "anomaly-scan",
    sourceRecordId: "11111111-1111-1111-1111-111111111111",
    customerId: "22222222-2222-2222-2222-222222222222",
    companyId: "33333333-3333-3333-3333-333333333333",
    equipmentId: "44444444-4444-4444-4444-444444444444",
    dealId: "55555555-5555-5555-5555-555555555555",
  });
  assertEquals(args.p_entity_type, "deal");
  assertEquals(args.p_entity_id, "55555555-5555-5555-5555-555555555555");
});

Deno.test("buildEmitEventArgs entity precedence: company then record fallback", () => {
  const companyOnly = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "parts_order.invoiced",
    sourceModule: "parts-order-manager",
    companyId: "33333333-3333-3333-3333-333333333333",
  });
  assertEquals(companyOnly.p_entity_type, "company");
  assertEquals(companyOnly.p_entity_id, "33333333-3333-3333-3333-333333333333");

  const recordOnly = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "deal_timing.alert_generated",
    sourceModule: "deal-timing-scan",
    sourceRecordId: "11111111-1111-1111-1111-111111111111",
  });
  assertEquals(recordOnly.p_entity_type, "record");
  assertEquals(recordOnly.p_entity_id, "11111111-1111-1111-1111-111111111111");
});

Deno.test("buildEmitEventArgs folds ids + advisory fields into payload for flow_resolve_context", () => {
  const args = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "deal.invoiced",
    sourceModule: "equipment-invoice-runner",
    dealId: "55555555-5555-5555-5555-555555555555",
    companyId: "33333333-3333-3333-3333-333333333333",
    severity: "critical",
    commercialRelevance: "high",
    suggestedOwner: "66666666-6666-6666-6666-666666666666",
    requiredAction: "Resolve deposit blocker before quote expires.",
    recommendedDeadline: "2026-04-15T17:00:00.000Z",
    draftMessage: "Hi Marie, just confirming the deposit timing...",
    escalationRule: "manager_after_24h",
    status: "pending",
    idempotencyKey: "deal.invoiced:abc",
    payload: { invoice_id: "inv-1" },
  });
  // flow_resolve_context hydrates from these two keys — they must exist.
  assertEquals(args.p_payload.company_id, "33333333-3333-3333-3333-333333333333");
  assertEquals(args.p_payload.deal_id, "55555555-5555-5555-5555-555555555555");
  // Original payload survives.
  assertEquals(args.p_payload.invoice_id, "inv-1");
  // Advisory fields carried.
  assertEquals(args.p_payload.severity, "critical");
  assertEquals(args.p_payload.commercial_relevance, "high");
  assertEquals(args.p_payload.suggested_owner, "66666666-6666-6666-6666-666666666666");
  assertEquals(args.p_payload.required_action, "Resolve deposit blocker before quote expires.");
  assertEquals(args.p_payload.recommended_deadline, "2026-04-15T17:00:00.000Z");
  assertEquals(args.p_payload.draft_message, "Hi Marie, just confirming the deposit timing...");
  assertEquals(args.p_payload.escalation_rule, "manager_after_24h");
  assertEquals(args.p_payload.status, "pending");
  assertEquals(args.p_payload.idempotency_key, "deal.invoiced:abc");
});

Deno.test("buildEmitEventArgs never overwrites caller-supplied payload keys", () => {
  const args = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "anomaly.detected",
    sourceModule: "anomaly-scan",
    companyId: "33333333-3333-3333-3333-333333333333",
    payload: { company_id: "explicit-wins", severity: "from-payload" },
    severity: "low",
  });
  assertEquals(args.p_payload.company_id, "explicit-wins");
  assertEquals(args.p_payload.severity, "from-payload");
});

Deno.test("buildEmitEventArgs omits undefined optional fields from payload", () => {
  const args = buildEmitEventArgs({
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
    severity: "high",
  });
  assertEquals(args.p_payload.severity, "high");
  assert(!("deal_id" in args.p_payload), "deal_id should not be present when not supplied");
  assert(!("idempotency_key" in args.p_payload), "idempotency_key should not be present when not supplied");
});

// ─── Mocked-client tests for publishFlowEvent ────────────────────────────

interface MockResponse<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

interface MockClientCall {
  op: "probe" | "rpc";
  args: unknown[];
}

/**
 * Minimal Supabase client mock for the repointed publish round-trips.
 * Records every call so tests can assert call patterns. Returns canned
 * responses configured per test.
 */
function makeMockClient(canned: {
  probeResult?: MockResponse<{ event_id: string; occurred_at: string }>;
  rpcResult?: MockResponse<string>;
}): {
  // deno-lint-ignore no-explicit-any
  client: any;
  calls: MockClientCall[];
} {
  const calls: MockClientCall[] = [];

  const probeChain = {
    select: (_cols: string) => probeChain,
    eq: (_col: string, _val: unknown) => probeChain,
    limit: (_n: number) => probeChain,
    maybeSingle: () =>
      Promise.resolve(
        canned.probeResult ?? { data: null, error: null },
      ),
  };

  return {
    client: {
      from: (table: string) => {
        calls.push({ op: "probe", args: [table] });
        return probeChain;
      },
      rpc: (fn: string, args: unknown) => {
        calls.push({ op: "rpc", args: [fn, args] });
        return Promise.resolve(
          canned.rpcResult ?? { data: null, error: { message: "no rpcResult configured" } },
        );
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    calls,
  };
}

Deno.test("publishFlowEvent emits via emit_event RPC and returns deduped=false", async () => {
  const { client, calls } = makeMockClient({
    rpcResult: { data: "ev-1", error: null },
  });
  const result = await publishFlowEvent(client, {
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
  });
  assertEquals(result.eventId, "ev-1");
  assertEquals(result.rowId, "ev-1");
  assertEquals(result.deduped, false);
  // No idempotencyKey → no probe; exactly one rpc call to emit_event.
  assertEquals(calls.length, 1);
  assertEquals(calls[0].op, "rpc");
  assertEquals(calls[0].args[0], "emit_event");
});

Deno.test("publishFlowEvent dedupe probe hit returns existing event with deduped=true and skips the RPC", async () => {
  const { client, calls } = makeMockClient({
    probeResult: {
      data: { event_id: "existing-event", occurred_at: "2026-04-07T12:00:00.000Z" },
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
  assertEquals(result.rowId, "existing-event");
  assertEquals(result.publishedAt, "2026-04-07T12:00:00.000Z");
  assertEquals(result.deduped, true);
  // Probe only — the emit RPC must not fire on a dedupe hit.
  assertEquals(calls.filter((c) => c.op === "rpc").length, 0);
});

Deno.test("publishFlowEvent probe miss falls through to the RPC", async () => {
  const { client, calls } = makeMockClient({
    probeResult: { data: null, error: null },
    rpcResult: { data: "ev-2", error: null },
  });
  const result = await publishFlowEvent(client, {
    workspaceId: "default",
    eventType: "deal.stalled",
    sourceModule: "anomaly-scan",
    idempotencyKey: "deal.stalled:deal-xyz",
  });
  assertEquals(result.eventId, "ev-2");
  assertEquals(result.deduped, false);
  assertEquals(calls.filter((c) => c.op === "rpc").length, 1);
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

Deno.test("publishFlowEvent propagates probe errors", async () => {
  const { client } = makeMockClient({
    probeResult: {
      data: null,
      error: { code: "42501", message: "permission denied for table analytics_events" },
    },
  });
  await assertRejects(
    () =>
      publishFlowEvent(client, {
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
        idempotencyKey: "deal.stalled:abc",
      }),
    Error,
    "dedupe probe failed",
  );
});

Deno.test("publishFlowEvent propagates emit_event RPC errors", async () => {
  const { client } = makeMockClient({
    rpcResult: { data: null, error: { message: "function emit_event does not exist" } },
  });
  await assertRejects(
    () =>
      publishFlowEvent(client, {
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
      }),
    Error,
    "emit_event failed",
  );
});

Deno.test("publishFlowEvent throws when the RPC returns no event id", async () => {
  const { client } = makeMockClient({
    rpcResult: { data: null, error: null },
  });
  await assertRejects(
    () =>
      publishFlowEvent(client, {
        workspaceId: "default",
        eventType: "deal.stalled",
        sourceModule: "anomaly-scan",
      }),
    Error,
    "no event id returned",
  );
});
