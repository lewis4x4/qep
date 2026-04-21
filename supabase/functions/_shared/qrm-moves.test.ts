import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createMove,
  listMoves,
  parseMoveListFilters,
  patchMove,
  validateMoveCreatePayload,
} from "./qrm-moves.ts";
import type { RouterCtx } from "./crm-router-service.ts";

// Supabase query-builder stub: captures every eq/in filter and the final
// update/insert payload. Each terminal (single, then, limit) resolves to the
// pre-canned result passed into the factory. Mirrors the crm-router-search
// test fixture so the pattern stays consistent.
interface StubResult {
  data: unknown;
  error: Error | null;
}

interface StubCapture {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
  update?: Record<string, unknown>;
  insert?: Record<string, unknown>;
}

function makeStubClient(
  results: Record<string, StubResult | StubResult[]>,
): {
  client: SupabaseClient;
  captures: StubCapture[];
} {
  const captures: StubCapture[] = [];

  // Per-table queues let a single test simulate a sequence of calls to the
  // same table (e.g. PATCH /moves: UPDATE → PGRST116 → re-SELECT). Each
  // call consumes the head; if the queue is empty we fall back to an empty
  // list so a stray call doesn't crash.
  const queues: Record<string, StubResult[]> = {};
  for (const [k, v] of Object.entries(results)) {
    if (Array.isArray(v)) queues[k] = [...v];
  }

  const nextResult = (table: string): StubResult => {
    const queue = queues[table];
    if (queue && queue.length > 0) return queue.shift()!;
    const scalar = results[table];
    if (!scalar || Array.isArray(scalar)) return { data: [], error: null };
    return scalar;
  };

  const makeBuilder = (capture: StubCapture, result: StubResult) => {
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        capture.filters.push({ op: "eq", column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        capture.filters.push({ op: "in", column, value });
        return builder;
      },
      is: (column: string, value: unknown) => {
        capture.filters.push({ op: "is", column, value });
        return builder;
      },
      order: () => builder,
      limit: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      update: (payload: Record<string, unknown>) => {
        capture.update = payload;
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        capture.insert = payload;
        return builder;
      },
      then: (resolve: (value: StubResult) => unknown) => resolve(result),
    };
    return builder;
  };

  const client = {
    from: (table: string) => {
      const capture: StubCapture = { table, filters: [] };
      captures.push(capture);
      const result = nextResult(table);
      return makeBuilder(capture, result);
    },
  } as unknown as SupabaseClient;

  return { client, captures };
}

function makeCtx(
  callerDb: SupabaseClient,
  opts: {
    admin?: SupabaseClient;
    role?: "rep" | "manager" | "admin" | "owner";
    isServiceRole?: boolean;
    userId?: string | null;
  } = {},
): RouterCtx {
  return {
    admin: opts.admin ?? ({} as SupabaseClient),
    callerDb,
    caller: {
      authHeader: "Bearer token",
      userId: opts.userId ?? "user-1",
      role: opts.role ?? "rep",
      isServiceRole: opts.isServiceRole ?? false,
      workspaceId: "ws-1",
    },
    workspaceId: "ws-1",
    requestId: "req-moves",
    route: "/qrm/moves",
    method: "GET",
    ipInet: null,
    userAgent: null,
  };
}

// ---------------------------------------------------------------------------
// parseMoveListFilters
// ---------------------------------------------------------------------------

Deno.test("parseMoveListFilters defaults to active statuses when none given", () => {
  const filters = parseMoveListFilters(new URLSearchParams());
  assertEquals(filters.statuses.sort(), ["accepted", "suggested"]);
  assertEquals(filters.limit, 50);
  assertEquals(filters.entityType, null);
  assertEquals(filters.entityId, null);
  assertEquals(filters.assignedRepId, null);
});

Deno.test("parseMoveListFilters parses comma-separated status list", () => {
  const filters = parseMoveListFilters(
    new URLSearchParams("status=suggested,completed,dismissed"),
  );
  assertEquals(filters.statuses.sort(), ["completed", "dismissed", "suggested"]);
});

Deno.test("parseMoveListFilters drops unknown statuses", () => {
  const filters = parseMoveListFilters(
    new URLSearchParams("status=robot,suggested"),
  );
  assertEquals(filters.statuses, ["suggested"]);
});

Deno.test("parseMoveListFilters caps limit at 200", () => {
  const filters = parseMoveListFilters(new URLSearchParams("limit=999"));
  assertEquals(filters.limit, 200);
});

Deno.test("parseMoveListFilters floors limit at 1", () => {
  const filters = parseMoveListFilters(new URLSearchParams("limit=0"));
  assertEquals(filters.limit, 1);
});

Deno.test("parseMoveListFilters accepts entity scope pair", () => {
  const filters = parseMoveListFilters(
    new URLSearchParams("entity_type=deal&entity_id=d-1"),
  );
  assertEquals(filters.entityType, "deal");
  assertEquals(filters.entityId, "d-1");
});

Deno.test("parseMoveListFilters rejects unknown entity_type", () => {
  const filters = parseMoveListFilters(
    new URLSearchParams("entity_type=robot&entity_id=r-1"),
  );
  assertEquals(filters.entityType, null);
  assertEquals(filters.entityId, "r-1"); // id still passes through
});

// ---------------------------------------------------------------------------
// listMoves
// ---------------------------------------------------------------------------

Deno.test("listMoves scopes rep callers to their own uid by default", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep", userId: "rep-42" });

  await listMoves(ctx, parseMoveListFilters(new URLSearchParams()));

  const movesQuery = captures.find((c) => c.table === "moves");
  if (!movesQuery) throw new Error("moves query not captured");
  const repFilter = movesQuery.filters.find(
    (f) => f.column === "assigned_rep_id",
  );
  assertEquals(repFilter?.value, "rep-42");
});

Deno.test("listMoves does NOT rep-scope elevated callers", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "manager", userId: "mgr-1" });

  await listMoves(ctx, parseMoveListFilters(new URLSearchParams()));

  const movesQuery = captures.find((c) => c.table === "moves");
  if (!movesQuery) throw new Error("moves query not captured");
  const repFilter = movesQuery.filters.find(
    (f) => f.column === "assigned_rep_id",
  );
  assertEquals(repFilter, undefined);
});

Deno.test("listMoves respects explicit assigned_rep_id filter", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "manager" });

  await listMoves(
    ctx,
    parseMoveListFilters(new URLSearchParams("assigned_rep_id=target-rep")),
  );

  const movesQuery = captures.find((c) => c.table === "moves");
  if (!movesQuery) throw new Error("moves query not captured");
  const repFilter = movesQuery.filters.find(
    (f) => f.column === "assigned_rep_id",
  );
  assertEquals(repFilter?.value, "target-rep");
});

Deno.test("listMoves filters by workspace, status list, and entity scope", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "admin" });

  await listMoves(
    ctx,
    parseMoveListFilters(
      new URLSearchParams(
        "status=suggested,accepted&entity_type=deal&entity_id=d-1",
      ),
    ),
  );

  const movesQuery = captures.find((c) => c.table === "moves");
  if (!movesQuery) throw new Error("moves query not captured");

  const workspaceFilter = movesQuery.filters.find(
    (f) => f.op === "eq" && f.column === "workspace_id",
  );
  assertEquals(workspaceFilter?.value, "ws-1");

  const statusIn = movesQuery.filters.find(
    (f) => f.op === "in" && f.column === "status",
  );
  assertEquals((statusIn?.value as string[]).sort(), ["accepted", "suggested"]);

  const typeFilter = movesQuery.filters.find(
    (f) => f.op === "eq" && f.column === "entity_type",
  );
  assertEquals(typeFilter?.value, "deal");

  const idFilter = movesQuery.filters.find(
    (f) => f.op === "eq" && f.column === "entity_id",
  );
  assertEquals(idFilter?.value, "d-1");
});

// ---------------------------------------------------------------------------
// patchMove
// ---------------------------------------------------------------------------

Deno.test("patchMove accept stamps status + accepted_at", async () => {
  const pretendRow = {
    id: "m-1",
    status: "accepted",
    accepted_at: "2026-04-20T00:00:00Z",
  };
  const { client, captures } = makeStubClient({
    moves: { data: pretendRow, error: null },
  });
  const ctx = makeCtx(client);

  const result = await patchMove(ctx, "m-1", { action: "accept" });

  const movesQuery = captures.find((c) => c.table === "moves");
  assertEquals(movesQuery?.update?.status, "accepted");
  assertEquals(typeof movesQuery?.update?.accepted_at, "string");
  assertEquals(result.move.id, "m-1");
  assertEquals(result.touchId, null);
  assertEquals(result.signalsSuppressed, 0);
});

Deno.test("patchMove snooze requires snoozedUntil in the future", async () => {
  const { client } = makeStubClient({ moves: { data: {}, error: null } });
  const ctx = makeCtx(client);

  await assertRejects(
    () => patchMove(ctx, "m-1", { action: "snooze" }),
    Error,
    "snoozedUntil_required",
  );

  await assertRejects(
    () =>
      patchMove(ctx, "m-1", {
        action: "snooze",
        snoozedUntil: "2020-01-01T00:00:00Z",
      }),
    Error,
    "snoozedUntil_must_be_future",
  );

  await assertRejects(
    () =>
      patchMove(ctx, "m-1", {
        action: "snooze",
        snoozedUntil: "not-a-date",
      }),
    Error,
    "snoozedUntil_must_be_future",
  );
});

Deno.test("patchMove snooze sets snoozed_until when the date is valid", async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const { client, captures } = makeStubClient({
    moves: { data: { id: "m-1", status: "snoozed" }, error: null },
  });
  const ctx = makeCtx(client);

  await patchMove(ctx, "m-1", { action: "snooze", snoozedUntil: future });

  const movesQuery = captures.find((c) => c.table === "moves");
  assertEquals(movesQuery?.update?.status, "snoozed");
  assertEquals(typeof movesQuery?.update?.snoozed_until, "string");
});

Deno.test("patchMove dismiss records reason when provided", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: { id: "m-1", status: "dismissed" }, error: null },
  });
  const ctx = makeCtx(client);

  await patchMove(ctx, "m-1", {
    action: "dismiss",
    reason: "customer unreachable",
  });

  const movesQuery = captures.find((c) => c.table === "moves");
  assertEquals(movesQuery?.update?.status, "dismissed");
  assertEquals(movesQuery?.update?.dismissed_reason, "customer unreachable");
  assertEquals(typeof movesQuery?.update?.dismissed_at, "string");
});

Deno.test("patchMove complete stamps completed_at", async () => {
  // Complete also fires the closure loop: touch insert + signal suppress.
  // The move is deal-scoped so a touch is written; signal_ids is empty so
  // suppression is a no-op.
  const moveRow = {
    id: "m-1",
    status: "completed",
    title: "Call back",
    kind: "call_now",
    entity_type: "deal",
    entity_id: "deal-1",
    signal_ids: [],
    workspace_id: "ws-1",
  };
  const { client } = makeStubClient({
    moves: { data: moveRow, error: null },
  });
  const { client: admin } = makeStubClient({
    touches: { data: { id: "touch-1" }, error: null },
  });
  const ctx = makeCtx(client, { admin });

  const result = await patchMove(ctx, "m-1", { action: "complete" });

  assertEquals(result.move.status, "completed");
  assertEquals(result.touchId, "touch-1");
  assertEquals(result.signalsSuppressed, 0);
});

Deno.test(
  "patchMove complete auto-logs a touch on the move's entity when none given",
  async () => {
    const moveRow = {
      id: "m-2",
      status: "completed",
      title: "Email the buyer",
      kind: "send_follow_up",
      entity_type: "contact",
      entity_id: "contact-7",
      signal_ids: [],
      workspace_id: "ws-1",
    };
    const { client } = makeStubClient({
      moves: { data: moveRow, error: null },
    });
    const { client: admin, captures: adminCaptures } = makeStubClient({
      touches: { data: { id: "touch-2" }, error: null },
    });
    const ctx = makeCtx(client, { admin, userId: "rep-7" });

    await patchMove(ctx, "m-2", { action: "complete" });

    const touchInsert = adminCaptures.find((c) => c.table === "touches");
    assertEquals(touchInsert?.insert?.channel, "other");
    assertEquals(touchInsert?.insert?.direction, "outbound");
    assertEquals(touchInsert?.insert?.summary, "Email the buyer");
    assertEquals(touchInsert?.insert?.contact_id, "contact-7");
    assertEquals(touchInsert?.insert?.from_move_id, "m-2");
    assertEquals(touchInsert?.insert?.actor_user_id, "rep-7");
    assertEquals((touchInsert?.insert?.metadata as Record<string, unknown>).source, "move_complete");
  },
);

Deno.test(
  "patchMove complete honors client-supplied touch payload (channel/summary/duration)",
  async () => {
    const moveRow = {
      id: "m-3",
      status: "completed",
      title: "Call back",
      kind: "call_now",
      entity_type: "deal",
      entity_id: "deal-3",
      signal_ids: [],
      workspace_id: "ws-1",
    };
    const { client } = makeStubClient({
      moves: { data: moveRow, error: null },
    });
    const { client: admin, captures: adminCaptures } = makeStubClient({
      touches: { data: { id: "t-3" }, error: null },
    });
    const ctx = makeCtx(client, { admin });

    await patchMove(ctx, "m-3", {
      action: "complete",
      touch: {
        channel: "call",
        summary: "Got the buyer on the phone",
        body: "They confirmed budget.",
        durationSeconds: 420,
      },
    });

    const touchInsert = adminCaptures.find((c) => c.table === "touches");
    assertEquals(touchInsert?.insert?.channel, "call");
    assertEquals(touchInsert?.insert?.summary, "Got the buyer on the phone");
    assertEquals(touchInsert?.insert?.body, "They confirmed budget.");
    assertEquals(touchInsert?.insert?.duration_seconds, 420);
  },
);

Deno.test(
  "patchMove complete suppresses the signals referenced by move.signal_ids",
  async () => {
    const moveRow = {
      id: "m-4",
      status: "completed",
      title: "Handle the SLA",
      kind: "escalate",
      entity_type: "deal",
      entity_id: "deal-4",
      signal_ids: ["sig-a", "sig-b", "sig-c"],
      workspace_id: "ws-1",
    };
    const { client } = makeStubClient({
      moves: { data: moveRow, error: null },
    });
    const { client: admin, captures: adminCaptures } = makeStubClient({
      touches: { data: { id: "t-4" }, error: null },
      // The stub .update() returns `result` via `then`; populate `data` so
      // the count guard doesn't crash. We can't easily simulate Supabase's
      // `count` return here, so assert on the update call shape instead.
      signals: { data: null, error: null },
    });
    const ctx = makeCtx(client, { admin });

    await patchMove(ctx, "m-4", { action: "complete" });

    const signalUpdate = adminCaptures.find((c) => c.table === "signals");
    assertEquals(typeof signalUpdate?.update?.suppressed_until, "string");
    const workspaceFilter = signalUpdate?.filters.find(
      (f) => f.op === "eq" && f.column === "workspace_id",
    );
    assertEquals(workspaceFilter?.value, "ws-1");
    const idsIn = signalUpdate?.filters.find(
      (f) => f.op === "in" && f.column === "id",
    );
    assertEquals((idsIn?.value as string[]).sort(), ["sig-a", "sig-b", "sig-c"]);
  },
);

Deno.test(
  "patchMove complete skips touch insert when move.entity_type is activity/rental/workspace",
  async () => {
    // Touches require at least one of (contact, company, deal, equipment).
    // An activity-typed move doesn't map to any of those, so we skip the
    // touch row but still suppress signals.
    const moveRow = {
      id: "m-5",
      status: "completed",
      title: "Log workspace-wide SLA check",
      kind: "pricing_review",
      entity_type: "workspace",
      entity_id: null,
      signal_ids: ["sig-w1"],
      workspace_id: "ws-1",
    };
    const { client } = makeStubClient({
      moves: { data: moveRow, error: null },
    });
    const { client: admin, captures: adminCaptures } = makeStubClient({
      signals: { data: null, error: null },
    });
    const ctx = makeCtx(client, { admin });

    const result = await patchMove(ctx, "m-5", { action: "complete" });

    assertEquals(result.touchId, null);
    const touchInsert = adminCaptures.find((c) => c.table === "touches");
    assertEquals(touchInsert, undefined);
    const signalUpdate = adminCaptures.find((c) => c.table === "signals");
    assertEquals(typeof signalUpdate?.update?.suppressed_until, "string");
  },
);

Deno.test("patchMove complete rejects unknown touch channel", async () => {
  const { client } = makeStubClient({
    moves: { data: { id: "m-6" }, error: null },
  });
  const ctx = makeCtx(client);

  await assertRejects(
    () =>
      patchMove(ctx, "m-6", {
        action: "complete",
        // deno-lint-ignore no-explicit-any
        touch: { channel: "smoke_signal" as any },
      }),
    Error,
    "touch_channel",
  );
});

Deno.test(
  "patchMove complete is idempotent when the move is already completed (PGRST116 branch)",
  async () => {
    // Simulate: stale client retries complete. The UPDATE is gated on
    // `completed_at IS NULL`, so it matches 0 rows and PostgREST returns
    // PGRST116. patchMove must fall through to a plain SELECT and return
    // the existing move WITHOUT re-running the touch + suppression
    // side-effects. This keeps move completion exactly-once.
    const existingMove = {
      id: "m-dup",
      status: "completed",
      completed_at: "2026-04-19T22:00:00Z",
      entity_type: "contact",
      entity_id: "contact-1",
      signal_ids: ["sig-x"],
      workspace_id: "ws-1",
      title: "Follow up",
      kind: "call_now",
    };
    const { client, captures } = makeStubClient({
      // Queue two results for `moves`: first the UPDATE miss, then the
      // re-SELECT returning the existing row.
      moves: [
        { data: null, error: { code: "PGRST116", message: "0 rows" } as unknown as Error },
        { data: existingMove, error: null },
      ],
    });
    const { client: admin, captures: adminCaptures } = makeStubClient({
      touches: { data: { id: "should-not-exist" }, error: null },
      signals: { data: null, error: null },
    });
    const ctx = makeCtx(client, { admin });

    const result = await patchMove(ctx, "m-dup", { action: "complete" });

    // Side-effects must NOT fire on the re-entry path.
    assertEquals(result.touchId, null);
    assertEquals(result.signalsSuppressed, 0);
    assertEquals(result.move.id, "m-dup");
    // Neither touches nor signals should have been touched.
    assertEquals(adminCaptures.find((c) => c.table === "touches"), undefined);
    assertEquals(adminCaptures.find((c) => c.table === "signals"), undefined);

    // Sanity: we should have hit `moves` twice — once for the gated UPDATE,
    // once for the re-SELECT.
    const moveCaptures = captures.filter((c) => c.table === "moves");
    assertEquals(moveCaptures.length, 2);
    // The first hit carries the `is completed_at null` filter.
    const firstHit = moveCaptures[0];
    assertEquals(
      firstHit.filters.some(
        (f) => f.op === "is" && f.column === "completed_at" && f.value === null,
      ),
      true,
    );
  },
);

Deno.test(
  "patchMove complete re-raises non-PGRST116 errors",
  async () => {
    // A 500 / connection-dropped should NOT be silently swallowed by the
    // double-completion guard — only PGRST116 is "already completed".
    const boomError = Object.assign(new Error("relation does not exist"), {
      code: "42P01",
    });
    const { client } = makeStubClient({
      moves: { data: null, error: boomError },
    });
    const ctx = makeCtx(client);

    await assertRejects(
      () => patchMove(ctx, "m-boom", { action: "complete" }),
      Error,
      "relation does not exist",
    );
  },
);

Deno.test("patchMove reopen clears dismiss/snooze fields back to suggested", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: { id: "m-1", status: "suggested" }, error: null },
  });
  const ctx = makeCtx(client);

  await patchMove(ctx, "m-1", { action: "reopen" });

  const movesQuery = captures.find((c) => c.table === "moves");
  assertEquals(movesQuery?.update?.status, "suggested");
  assertEquals(movesQuery?.update?.dismissed_at, null);
  assertEquals(movesQuery?.update?.dismissed_reason, null);
  assertEquals(movesQuery?.update?.snoozed_until, null);
});

Deno.test("patchMove rejects unknown actions", async () => {
  const { client } = makeStubClient({ moves: { data: {}, error: null } });
  const ctx = makeCtx(client);

  await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      patchMove(ctx, "m-1", { action: "nuke" as any }),
    Error,
    "unknown_action",
  );
});

// ---------------------------------------------------------------------------
// validateMoveCreatePayload
// ---------------------------------------------------------------------------

Deno.test("validateMoveCreatePayload enforces required fields", () => {
  // Missing kind
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    validateMoveCreatePayload({ title: "x" } as any);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "VALIDATION_ERROR:kind");
  }
  assertEquals(threw, true);

  // Missing title
  threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    validateMoveCreatePayload({ kind: "call_now" } as any);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "VALIDATION_ERROR:title");
  }
  assertEquals(threw, true);

  // Unknown kind
  threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    validateMoveCreatePayload({ kind: "robot" as any, title: "x" });
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "VALIDATION_ERROR:kind");
  }
  assertEquals(threw, true);
});

Deno.test("validateMoveCreatePayload caps priority and confidence ranges", () => {
  let threw = false;
  try {
    validateMoveCreatePayload({ kind: "call_now", title: "x", priority: 101 });
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "VALIDATION_ERROR:priority");
  }
  assertEquals(threw, true);

  threw = false;
  try {
    validateMoveCreatePayload({ kind: "call_now", title: "x", confidence: 2 });
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "VALIDATION_ERROR:confidence");
  }
  assertEquals(threw, true);
});

Deno.test("validateMoveCreatePayload accepts a well-formed payload", () => {
  // Should not throw
  validateMoveCreatePayload({
    kind: "call_now",
    title: "Call Acme about CAT 305",
    rationale: "Inbound query 20min ago",
    confidence: 0.82,
    priority: 90,
    entityType: "deal",
    entityId: "d-1",
    assignedRepId: "rep-1",
    draft: { script: "Hi..." },
    signalIds: ["s-1"],
    dueAt: "2026-04-20T17:00:00Z",
    recommender: "deterministic",
    recommenderVersion: "v1",
    payload: {},
  });
});

// ---------------------------------------------------------------------------
// createMove
// ---------------------------------------------------------------------------

Deno.test("createMove inserts via admin client with workspace stamped", async () => {
  // Capture admin inserts separately from caller DB.
  const { client: adminClient, captures: adminCaptures } = makeStubClient({
    moves: { data: { id: "m-new" }, error: null },
  });
  const { client: callerClient } = makeStubClient({});
  const ctx = makeCtx(callerClient, { admin: adminClient });

  await createMove(ctx, {
    kind: "send_quote",
    title: "Send quote for CAT 305",
    entityType: "deal",
    entityId: "d-1",
    assignedRepId: "rep-1",
    recommender: "deterministic",
    recommenderVersion: "v1",
  });

  const insert = adminCaptures.find((c) => c.table === "moves")?.insert;
  assertEquals(insert?.workspace_id, "ws-1");
  assertEquals(insert?.kind, "send_quote");
  assertEquals(insert?.title, "Send quote for CAT 305");
  assertEquals(insert?.entity_type, "deal");
  assertEquals(insert?.entity_id, "d-1");
  assertEquals(insert?.assigned_rep_id, "rep-1");
  // Priority defaults to 50 when omitted.
  assertEquals(insert?.priority, 50);
  // Empty signal_ids default.
  assertEquals(insert?.signal_ids, []);
  // Empty payload default.
  assertEquals(insert?.payload, {});
});
