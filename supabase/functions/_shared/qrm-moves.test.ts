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

function makeStubClient(results: Record<string, StubResult>): {
  client: SupabaseClient;
  captures: StubCapture[];
} {
  const captures: StubCapture[] = [];

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
      const result = results[table] ?? { data: [], error: null };
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
  assertEquals((result as { id: string }).id, "m-1");
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
  const { client, captures } = makeStubClient({
    moves: { data: { id: "m-1", status: "completed" }, error: null },
  });
  const ctx = makeCtx(client);

  await patchMove(ctx, "m-1", { action: "complete" });

  const movesQuery = captures.find((c) => c.table === "moves");
  assertEquals(movesQuery?.update?.status, "completed");
  assertEquals(typeof movesQuery?.update?.completed_at, "string");
});

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
