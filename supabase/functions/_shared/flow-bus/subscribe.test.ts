/**
 * Deno tests for the QRM Flow Bus subscribe helpers (Phase 0 P0.4).
 *
 * Run with:
 *   deno test supabase/functions/_shared/flow-bus/subscribe.test.ts
 *
 * Pure-function tests for matchesPattern() (the load-bearing pattern grammar
 * the future Day 7+ dispatcher will rely on). Mocked-client tests for
 * registerSubscription() upsert behavior + listActiveSubscriptionsForEvent
 * filtering.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  listActiveSubscriptionsForEvent,
  matchesPattern,
  registerSubscription,
  validateEventTypePattern,
} from "./subscribe.ts";
import type { FlowSubscriptionRow } from "./types.ts";

// ─── matchesPattern: literal patterns ─────────────────────────────────────

Deno.test("matchesPattern: literal pattern matches exactly equal event_type", () => {
  assertEquals(matchesPattern("follow_up.due", "follow_up.due"), true);
  assertEquals(matchesPattern("deal.stalled", "deal.stalled"), true);
});

Deno.test("matchesPattern: literal pattern does NOT match different event_type", () => {
  assertEquals(matchesPattern("follow_up.due", "follow_up.overdue"), false);
  assertEquals(matchesPattern("deal.stalled", "deal.closed_won"), false);
});

Deno.test("matchesPattern: literal pattern does NOT match prefix-only event", () => {
  // 'deal.stalled' is NOT a prefix-match against 'deal' literal
  assertEquals(matchesPattern("deal.stalled", "deal"), false);
  assertEquals(matchesPattern("deal", "deal.stalled"), false);
});

// ─── matchesPattern: universal '*' / '**' ────────────────────────────────

Deno.test("matchesPattern: '*' alone matches any event_type", () => {
  assertEquals(matchesPattern("deal.stalled", "*"), true);
  assertEquals(matchesPattern("follow_up.due", "*"), true);
  assertEquals(matchesPattern("a.b.c.d.e.f", "*"), true);
  assertEquals(matchesPattern("simple", "*"), true);
});

Deno.test("matchesPattern: '**' alone matches any event_type", () => {
  assertEquals(matchesPattern("deal.stalled", "**"), true);
  assertEquals(matchesPattern("a.b.c.d.e", "**"), true);
});

// ─── matchesPattern: single-segment glob ('deal.*') ──────────────────────

Deno.test("matchesPattern: 'deal.*' matches deal.stalled, deal.closed_won, deal.X", () => {
  assertEquals(matchesPattern("deal.stalled", "deal.*"), true);
  assertEquals(matchesPattern("deal.closed_won", "deal.*"), true);
  assertEquals(matchesPattern("deal.X", "deal.*"), true);
});

Deno.test("matchesPattern: 'deal.*' does NOT match follow_up.due (different prefix)", () => {
  assertEquals(matchesPattern("follow_up.due", "deal.*"), false);
});

Deno.test("matchesPattern: 'deal.*' does NOT match deal.stalled.severe (different segment count)", () => {
  // Single-segment glob — segment counts must match exactly
  assertEquals(matchesPattern("deal.stalled.severe", "deal.*"), false);
});

Deno.test("matchesPattern: 'deal.*' does NOT match bare 'deal'", () => {
  assertEquals(matchesPattern("deal", "deal.*"), false);
});

// ─── matchesPattern: multi-segment glob ('deal.**') ──────────────────────

Deno.test("matchesPattern: 'deal.**' matches deal.stalled.severe (multi-segment)", () => {
  assertEquals(matchesPattern("deal.stalled.severe", "deal.**"), true);
});

Deno.test("matchesPattern: 'deal.**' matches deal.stalled (single trailing segment)", () => {
  assertEquals(matchesPattern("deal.stalled", "deal.**"), true);
});

Deno.test("matchesPattern: 'deal.**' does NOT match follow_up.X (different prefix)", () => {
  assertEquals(matchesPattern("follow_up.due", "deal.**"), false);
});

// ─── matchesPattern: mid-segment wildcards ('a.*.c') ─────────────────────

Deno.test("matchesPattern: 'service.*.escalated' matches service.warranty.escalated", () => {
  assertEquals(matchesPattern("service.warranty.escalated", "service.*.escalated"), true);
});

Deno.test("matchesPattern: 'service.*.escalated' does NOT match service.warranty.resolved", () => {
  assertEquals(matchesPattern("service.warranty.resolved", "service.*.escalated"), false);
});

// ─── matchesPattern: empty inputs ────────────────────────────────────────

Deno.test("matchesPattern: empty event_type returns false", () => {
  assertEquals(matchesPattern("", "deal.*"), false);
  assertEquals(matchesPattern("", "*"), false);
});

Deno.test("matchesPattern: empty pattern returns false", () => {
  assertEquals(matchesPattern("deal.stalled", ""), false);
});

// ─── validateEventTypePattern (P1 fix) ───────────────────────────────────

Deno.test("validateEventTypePattern accepts literal patterns", () => {
  validateEventTypePattern("follow_up.due");
  validateEventTypePattern("deal.stalled");
  validateEventTypePattern("simple");
});

Deno.test("validateEventTypePattern accepts single-segment wildcards", () => {
  validateEventTypePattern("deal.*");
  validateEventTypePattern("*");
  validateEventTypePattern("a.*.c");
});

Deno.test("validateEventTypePattern accepts trailing multi-segment glob", () => {
  validateEventTypePattern("deal.**");
  validateEventTypePattern("**");
  validateEventTypePattern("a.b.c.**");
});

Deno.test("validateEventTypePattern REJECTS mid-segment '**' (P1 fix)", () => {
  // This is the silent-failure case the P1 fix prevents. Without
  // validation, a pattern like 'deal.**.escalated' would never match
  // anything at dispatch time and the user would be confused.
  assertThrows(
    () => validateEventTypePattern("deal.**.escalated"),
    Error,
    "'**' is only supported as the final segment",
  );
});

Deno.test("validateEventTypePattern REJECTS '**' at the leading position when followed by other segments", () => {
  assertThrows(
    () => validateEventTypePattern("**.deal.stalled"),
    Error,
    "'**' is only supported as the final segment",
  );
});

Deno.test("validateEventTypePattern REJECTS empty segments", () => {
  assertThrows(
    () => validateEventTypePattern("deal..stalled"),
    Error,
    "empty segment",
  );
});

Deno.test("validateEventTypePattern REJECTS leading dot", () => {
  assertThrows(
    () => validateEventTypePattern(".deal.stalled"),
    Error,
    "empty segment",
  );
});

Deno.test("validateEventTypePattern REJECTS trailing dot", () => {
  assertThrows(
    () => validateEventTypePattern("deal.stalled."),
    Error,
    "empty segment",
  );
});

Deno.test("validateEventTypePattern REJECTS empty pattern", () => {
  assertThrows(
    () => validateEventTypePattern(""),
    Error,
    "eventTypePattern is required",
  );
});

Deno.test("validateEventTypePattern REJECTS whitespace-only pattern", () => {
  assertThrows(
    () => validateEventTypePattern("   "),
    Error,
    "eventTypePattern is required",
  );
});

// ─── registerSubscription (mocked client) ────────────────────────────────

interface MockResponse<T> {
  data: T | null;
  error: { message?: string } | null;
}

interface MockClientCall {
  table: string;
  op: string;
  args: unknown[];
}

function makeMockClient<TUpsert, TSelect>(canned: {
  upsertResult?: MockResponse<TUpsert>;
  selectResult?: MockResponse<TSelect>;
}): {
  // deno-lint-ignore no-explicit-any
  client: any;
  calls: MockClientCall[];
} {
  const calls: MockClientCall[] = [];

  const upsertChain = {
    select: (_cols: string) => ({
      maybeSingle: () =>
        Promise.resolve(
          canned.upsertResult ?? { data: null, error: { message: "no upsertResult" } },
        ),
    }),
  };

  const selectChain = {
    eq: (_col: string, _val: unknown) => selectChain,
  };
  // The list helper calls .from(table).select(cols).eq().eq() and awaits the result
  // directly (not via maybeSingle), so the eq chain must be thenable.
  const selectChainThenable = {
    eq: (_col: string, _val: unknown) => selectChainThenable,
    then: (resolve: (value: MockResponse<TSelect>) => void) =>
      resolve(
        canned.selectResult ?? { data: null, error: { message: "no selectResult" } },
      ),
  };

  const fromTable = (table: string) => ({
    upsert: (row: unknown, _opts: unknown) => {
      calls.push({ table, op: "upsert", args: [row] });
      return upsertChain;
    },
    select: (cols: string) => {
      calls.push({ table, op: "select", args: [cols] });
      return selectChainThenable;
    },
  });

  return {
    // deno-lint-ignore no-explicit-any
    client: { from: fromTable } as any,
    calls,
  };
}

Deno.test("registerSubscription writes a row and returns it", async () => {
  const cannedRow: FlowSubscriptionRow = {
    id: "sub-1",
    workspace_id: "default",
    event_type_pattern: "deal.*",
    handler_module: "follow-up-engine",
    handler_name: "on_deal_stalled",
    enabled: true,
    created_at: "2026-04-08T20:00:00.000Z",
    updated_at: "2026-04-08T20:00:00.000Z",
  };
  const { client, calls } = makeMockClient<FlowSubscriptionRow, never>({
    upsertResult: { data: cannedRow, error: null },
  });
  const result = await registerSubscription(client, {
    workspaceId: "default",
    eventTypePattern: "deal.*",
    handlerModule: "follow-up-engine",
    handlerName: "on_deal_stalled",
  });
  assertEquals(result, cannedRow);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, "flow_subscriptions");
  assertEquals(calls[0].op, "upsert");
});

Deno.test("registerSubscription rejects empty workspaceId", async () => {
  const { client } = makeMockClient<FlowSubscriptionRow, never>({});
  await assertRejects(
    () =>
      registerSubscription(client, {
        workspaceId: "",
        eventTypePattern: "deal.*",
        handlerModule: "follow-up-engine",
        handlerName: "on_deal_stalled",
      }),
    Error,
    "workspaceId is required",
  );
});

Deno.test("registerSubscription rejects empty eventTypePattern", async () => {
  const { client } = makeMockClient<FlowSubscriptionRow, never>({});
  await assertRejects(
    () =>
      registerSubscription(client, {
        workspaceId: "default",
        eventTypePattern: "",
        handlerModule: "follow-up-engine",
        handlerName: "on_deal_stalled",
      }),
    Error,
    "eventTypePattern is required",
  );
});

Deno.test("registerSubscription rejects empty handlerModule", async () => {
  const { client } = makeMockClient<FlowSubscriptionRow, never>({});
  await assertRejects(
    () =>
      registerSubscription(client, {
        workspaceId: "default",
        eventTypePattern: "deal.*",
        handlerModule: "",
        handlerName: "on_deal_stalled",
      }),
    Error,
    "handlerModule is required",
  );
});

Deno.test("registerSubscription rejects empty handlerName", async () => {
  const { client } = makeMockClient<FlowSubscriptionRow, never>({});
  await assertRejects(
    () =>
      registerSubscription(client, {
        workspaceId: "default",
        eventTypePattern: "deal.*",
        handlerModule: "follow-up-engine",
        handlerName: "",
      }),
    Error,
    "handlerName is required",
  );
});

Deno.test("registerSubscription REJECTS mid-segment '**' before any DB call (P1 fix)", async () => {
  const { client, calls } = makeMockClient<FlowSubscriptionRow, never>({});
  await assertRejects(
    () =>
      registerSubscription(client, {
        workspaceId: "default",
        eventTypePattern: "deal.**.escalated",
        handlerModule: "follow-up-engine",
        handlerName: "on_deal_escalated",
      }),
    Error,
    "'**' is only supported as the final segment",
  );
  // No DB call should have been made — validation runs before the upsert.
  assertEquals(calls.length, 0);
});

Deno.test("registerSubscription REJECTS empty segments before any DB call (P1 fix)", async () => {
  const { client, calls } = makeMockClient<FlowSubscriptionRow, never>({});
  await assertRejects(
    () =>
      registerSubscription(client, {
        workspaceId: "default",
        eventTypePattern: "deal..stalled",
        handlerModule: "follow-up-engine",
        handlerName: "on_deal_stalled",
      }),
    Error,
    "empty segment",
  );
  assertEquals(calls.length, 0);
});

// ─── listActiveSubscriptionsForEvent (mocked client) ─────────────────────

Deno.test("listActiveSubscriptionsForEvent filters subscriptions by pattern match", async () => {
  const allSubs: FlowSubscriptionRow[] = [
    {
      id: "sub-1",
      workspace_id: "default",
      event_type_pattern: "deal.*",
      handler_module: "follow-up-engine",
      handler_name: "on_deal_stalled",
      enabled: true,
      created_at: "2026-04-08T20:00:00.000Z",
      updated_at: "2026-04-08T20:00:00.000Z",
    },
    {
      id: "sub-2",
      workspace_id: "default",
      event_type_pattern: "follow_up.*",
      handler_module: "follow-up-engine",
      handler_name: "on_follow_up_due",
      enabled: true,
      created_at: "2026-04-08T20:00:00.000Z",
      updated_at: "2026-04-08T20:00:00.000Z",
    },
    {
      id: "sub-3",
      workspace_id: "default",
      event_type_pattern: "*",
      handler_module: "audit-logger",
      handler_name: "log_all",
      enabled: true,
      created_at: "2026-04-08T20:00:00.000Z",
      updated_at: "2026-04-08T20:00:00.000Z",
    },
  ];
  const { client } = makeMockClient<never, FlowSubscriptionRow[]>({
    selectResult: { data: allSubs, error: null },
  });
  const matched = await listActiveSubscriptionsForEvent(client, "default", "deal.stalled");
  // Should match sub-1 (deal.*) and sub-3 (*) but NOT sub-2 (follow_up.*)
  assertEquals(matched.length, 2);
  const matchedIds = new Set(matched.map((s) => s.id));
  assert(matchedIds.has("sub-1"));
  assert(matchedIds.has("sub-3"));
  assert(!matchedIds.has("sub-2"));
});

Deno.test("listActiveSubscriptionsForEvent returns empty when no patterns match", async () => {
  const allSubs: FlowSubscriptionRow[] = [
    {
      id: "sub-1",
      workspace_id: "default",
      event_type_pattern: "deal.*",
      handler_module: "follow-up-engine",
      handler_name: "on_deal_stalled",
      enabled: true,
      created_at: "2026-04-08T20:00:00.000Z",
      updated_at: "2026-04-08T20:00:00.000Z",
    },
  ];
  const { client } = makeMockClient<never, FlowSubscriptionRow[]>({
    selectResult: { data: allSubs, error: null },
  });
  const matched = await listActiveSubscriptionsForEvent(client, "default", "follow_up.due");
  assertEquals(matched.length, 0);
});
