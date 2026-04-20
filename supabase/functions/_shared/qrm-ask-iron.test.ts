import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ASK_IRON_TOOLS,
  createAskIronSession,
  executeAskIronTool,
  MAX_PROPOSE_MOVES_PER_REQUEST,
  normalizeMoveFilters,
  normalizeProposeMoveInput,
  normalizeSearchInput,
  normalizeSignalFilters,
} from "./qrm-ask-iron.ts";
import type { RouterCtx } from "./crm-router-service.ts";

// ── Stub client (same shape as qrm-signals.test.ts + qrm-moves.test.ts) ────

interface StubResult {
  data: unknown;
  error: Error | null;
}

interface StubCapture {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
  orderColumn?: string;
  limit?: number;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

function makeStubClient(
  results: Record<string, StubResult | StubResult[]>,
): { client: SupabaseClient; captures: StubCapture[] } {
  const captures: StubCapture[] = [];
  const cursors: Record<string, number> = {};

  const pullResult = (table: string): StubResult => {
    const bucket = results[table];
    if (!bucket) return { data: [], error: null };
    if (Array.isArray(bucket)) {
      const idx = cursors[table] ?? 0;
      cursors[table] = idx + 1;
      return bucket[Math.min(idx, bucket.length - 1)];
    }
    return bucket;
  };

  const makeBuilder = (capture: StubCapture, result: StubResult) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        capture.filters.push({ op: "eq", column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        capture.filters.push({ op: "in", column, value });
        return builder;
      },
      gte: (column: string, value: unknown) => {
        capture.filters.push({ op: "gte", column, value });
        return builder;
      },
      is: (column: string, value: unknown) => {
        capture.filters.push({ op: "is", column, value });
        return builder;
      },
      ilike: (column: string, value: unknown) => {
        capture.filters.push({ op: "ilike", column, value });
        return builder;
      },
      or: (expr: string) => {
        capture.filters.push({ op: "or", column: "_or", value: expr });
        return builder;
      },
      order: (column: string) => {
        capture.orderColumn = column;
        return builder;
      },
      limit: (n: number) => {
        capture.limit = n;
        return Promise.resolve(result);
      },
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      insert: (payload: Record<string, unknown>) => {
        capture.insert = payload;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        capture.update = payload;
        return builder;
      },
      then: (resolve: (value: StubResult) => unknown) => resolve(result),
    });
    return builder;
  };

  const client = {
    from: (table: string) => {
      const capture: StubCapture = { table, filters: [] };
      captures.push(capture);
      const result = pullResult(table);
      return makeBuilder(capture, result);
    },
  } as unknown as SupabaseClient;

  return { client, captures };
}

function makeCtx(
  db: SupabaseClient,
  opts: {
    role?: "rep" | "admin" | "manager" | "owner";
    userId?: string;
    workspaceId?: string;
    isServiceRole?: boolean;
    admin?: SupabaseClient;
  } = {},
): RouterCtx {
  return {
    admin: opts.admin ?? db,
    callerDb: db,
    caller: {
      authHeader: "Bearer token",
      userId: opts.userId ?? "user-1",
      role: opts.role ?? "rep",
      isServiceRole: opts.isServiceRole ?? false,
      workspaceId: opts.workspaceId ?? "ws-1",
    },
    workspaceId: opts.workspaceId ?? "ws-1",
    requestId: "req-ask-iron",
    route: "/qrm/ask-iron",
    method: "POST",
    ipInet: null,
    userAgent: null,
  };
}

// ── Catalog ────────────────────────────────────────────────────────────────

Deno.test("ASK_IRON_TOOLS exposes the six tools", () => {
  const names = ASK_IRON_TOOLS.map((t) => t.name).sort();
  assertEquals(names, [
    "get_company_detail",
    "get_deal_detail",
    "list_my_moves",
    "list_recent_signals",
    "propose_move",
    "search_entities",
  ]);
});

Deno.test("ASK_IRON_TOOLS every tool has a non-empty description", () => {
  for (const tool of ASK_IRON_TOOLS) {
    // A Claude tool without a description is a silent regression — the model
    // can't pick intelligently if description is blank.
    assertEquals(
      tool.description.length > 20,
      true,
      `tool ${tool.name} description is too short`,
    );
  }
});

// ── normalizeMoveFilters ───────────────────────────────────────────────────

Deno.test("normalizeMoveFilters defaults to suggested+accepted", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager" });
  const f = normalizeMoveFilters({}, ctx);
  assertEquals(f.statuses.sort(), ["accepted", "suggested"]);
});

Deno.test("normalizeMoveFilters drops unknown statuses silently", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager" });
  const f = normalizeMoveFilters(
    { statuses: ["suggested", "bogus", "completed"] },
    ctx,
  );
  assertEquals(f.statuses.sort(), ["completed", "suggested"]);
});

Deno.test("normalizeMoveFilters pins rep callers to their own userId even if model passes a different id", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
  // Model (or a curious prompt) tries to peek at another rep's queue.
  const f = normalizeMoveFilters({ assigned_rep_id: "rep-other" }, ctx);
  assertEquals(f.assignedRepId, "rep-me");
});

Deno.test("normalizeMoveFilters lets managers query any rep", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager" });
  const f = normalizeMoveFilters({ assigned_rep_id: "rep-other" }, ctx);
  assertEquals(f.assignedRepId, "rep-other");
});

Deno.test("normalizeMoveFilters caps limit at 50 and floors at 1", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager" });
  assertEquals(normalizeMoveFilters({ limit: 9999 }, ctx).limit, 50);
  assertEquals(normalizeMoveFilters({ limit: 0 }, ctx).limit, 1);
  assertEquals(normalizeMoveFilters({ limit: "abc" }, ctx).limit, 15);
});

// ── normalizeSignalFilters ─────────────────────────────────────────────────

Deno.test("normalizeSignalFilters defaults since_hours to 48", () => {
  const now = new Date("2026-04-20T12:00:00Z").getTime();
  const f = normalizeSignalFilters({}, now);
  assertEquals(f.sinceIso, "2026-04-18T12:00:00.000Z");
});

Deno.test("normalizeSignalFilters caps since_hours at 168 (one week)", () => {
  const now = new Date("2026-04-20T12:00:00Z").getTime();
  const f = normalizeSignalFilters({ since_hours: 10_000 }, now);
  // 168 hours = 7 days back
  assertEquals(f.sinceIso, "2026-04-13T12:00:00.000Z");
});

Deno.test("normalizeSignalFilters accepts known severity floors", () => {
  const f = normalizeSignalFilters({ severity_at_least: "high" });
  assertEquals(f.severityAtLeast, "high");
});

Deno.test("normalizeSignalFilters rejects unknown severity floors", () => {
  const f = normalizeSignalFilters({ severity_at_least: "extreme" });
  assertEquals(f.severityAtLeast, null);
});

Deno.test("normalizeSignalFilters filters non-string kinds out", () => {
  const f = normalizeSignalFilters({
    kinds: ["inbound_email", 42, null, "telematics_fault"],
  });
  assertEquals(f.kinds, ["inbound_email", "telematics_fault"]);
});

// ── normalizeSearchInput ───────────────────────────────────────────────────

Deno.test("normalizeSearchInput trims the query string", () => {
  const f = normalizeSearchInput({ query: "  acme  " });
  assertEquals(f.query, "acme");
});

Deno.test("normalizeSearchInput drops unknown entity types", () => {
  const f = normalizeSearchInput({ query: "acme", types: ["company", "bogus"] });
  assertEquals(f.types, ["company"]);
});

// ── executor: list_my_moves ─────────────────────────────────────────────────

Deno.test("executeAskIronTool list_my_moves scopes a rep caller to their own id", async () => {
  const { client, captures } = makeStubClient({
    moves: {
      data: [
        {
          id: "m-1",
          kind: "call_now",
          status: "suggested",
          title: "Ring Acme",
          rationale: "Hot lead",
          priority: 80,
          entity_type: "deal",
          entity_id: "d-1",
          assigned_rep_id: "rep-me",
          due_at: null,
          created_at: "2026-04-20T10:00:00Z",
        },
      ],
      error: null,
    },
  });
  const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });

  const res = await executeAskIronTool(ctx, "list_my_moves", {});
  assertEquals(res.ok, true);

  const mv = captures.find((c) => c.table === "moves");
  if (!mv) throw new Error("moves query not captured");
  const ws = mv.filters.find((f) => f.column === "workspace_id");
  assertEquals(ws?.value, "ws-1");
  const rep = mv.filters.find((f) => f.column === "assigned_rep_id");
  assertEquals(rep?.value, "rep-me");
});

Deno.test("executeAskIronTool list_my_moves ignores LLM-supplied rep id for rep callers", async () => {
  // This is the key scoping test: a malformed or adversarial LLM response
  // tries to peek at another rep — normalizeMoveFilters must pin us.
  const { client, captures } = makeStubClient({
    moves: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });

  await executeAskIronTool(ctx, "list_my_moves", {
    assigned_rep_id: "rep-other",
  });

  const mv = captures.find((c) => c.table === "moves");
  if (!mv) throw new Error("moves query not captured");
  const rep = mv.filters.find((f) => f.column === "assigned_rep_id");
  assertEquals(rep?.value, "rep-me"); // NOT rep-other
});

Deno.test("executeAskIronTool list_my_moves honors manager's explicit rep id", async () => {
  const { client, captures } = makeStubClient({
    moves: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "manager" });

  await executeAskIronTool(ctx, "list_my_moves", {
    assigned_rep_id: "rep-other",
  });

  const mv = captures.find((c) => c.table === "moves");
  if (!mv) throw new Error("moves query not captured");
  const rep = mv.filters.find((f) => f.column === "assigned_rep_id");
  assertEquals(rep?.value, "rep-other");
});

// ── executor: list_recent_signals ───────────────────────────────────────────

Deno.test("executeAskIronTool list_recent_signals expands severity_at_least to IN list", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });

  await executeAskIronTool(ctx, "list_recent_signals", {
    severity_at_least: "high",
  });

  const q = captures.find((c) => c.table === "signals");
  if (!q) throw new Error("signals query not captured");
  const sev = q.filters.find((f) => f.op === "in" && f.column === "severity");
  assertEquals((sev?.value as string[]).sort(), ["critical", "high"]);
});

Deno.test("executeAskIronTool list_recent_signals applies workspace + since_hours window", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep", workspaceId: "ws-xyz" });

  await executeAskIronTool(ctx, "list_recent_signals", { since_hours: 24 });

  const q = captures.find((c) => c.table === "signals");
  if (!q) throw new Error("signals query not captured");
  const ws = q.filters.find((f) => f.column === "workspace_id");
  assertEquals(ws?.value, "ws-xyz");
  const since = q.filters.find((f) => f.column === "occurred_at" && f.op === "gte");
  assertEquals(typeof since?.value, "string");
});

// ── executor: search_entities ───────────────────────────────────────────────

Deno.test("executeAskIronTool search_entities returns empty on empty query", async () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const res = await executeAskIronTool(ctx, "search_entities", { query: "  " });
  assertEquals(res.ok, false);
  assertEquals(res.error, "query required");
});

Deno.test("executeAskIronTool search_entities scopes each subquery to workspace", async () => {
  const { client, captures } = makeStubClient({
    crm_companies: { data: [], error: null },
    crm_contacts: { data: [], error: null },
    crm_deals_rep_safe: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep", workspaceId: "ws-y" });

  await executeAskIronTool(ctx, "search_entities", { query: "acme" });

  for (const cap of captures) {
    const ws = cap.filters.find((f) => f.column === "workspace_id");
    if (!ws) throw new Error(`no workspace_id on ${cap.table}`);
    assertEquals(ws.value, "ws-y");
  }
});

Deno.test("executeAskIronTool search_entities respects explicit types=[company]", async () => {
  const { client, captures } = makeStubClient({
    crm_companies: { data: [{ id: "co-1", name: "Acme", city: "Tulsa", state: "OK" }], error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });

  await executeAskIronTool(ctx, "search_entities", {
    query: "acme",
    types: ["company"],
  });

  const tables = captures.map((c) => c.table);
  assertEquals(tables.includes("crm_companies"), true);
  assertEquals(tables.includes("crm_contacts"), false);
  assertEquals(tables.includes("crm_deals_rep_safe"), false);
});

// ── executor: get_deal_detail / get_company_detail ──────────────────────────

Deno.test("executeAskIronTool get_deal_detail returns found:false for missing deal", async () => {
  const { client } = makeStubClient({
    crm_deals_rep_safe: { data: null, error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });
  const res = await executeAskIronTool(ctx, "get_deal_detail", {
    deal_id: "missing",
  });
  assertEquals(res.ok, true);
  assertEquals((res.data as { found: boolean }).found, false);
});

Deno.test("executeAskIronTool get_company_detail scopes to workspace + soft-delete", async () => {
  const { client, captures } = makeStubClient({
    crm_companies: {
      data: { id: "co-1", name: "Acme", city: "Tulsa", state: "OK" },
      error: null,
    },
  });
  const ctx = makeCtx(client, { role: "rep", workspaceId: "ws-1" });
  const res = await executeAskIronTool(ctx, "get_company_detail", {
    company_id: "co-1",
  });
  assertEquals(res.ok, true);

  const q = captures.find((c) => c.table === "crm_companies");
  if (!q) throw new Error("company query not captured");
  const soft = q.filters.find(
    (f) => f.op === "is" && f.column === "deleted_at",
  );
  assertEquals(soft?.value, null);
});

// ── executor: unknown tool / error handling ─────────────────────────────────

Deno.test("executeAskIronTool returns an error for an unknown tool name", async () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const res = await executeAskIronTool(ctx, "delete_all_deals", {});
  assertEquals(res.ok, false);
  assertEquals(res.error?.startsWith("Unknown tool"), true);
});

Deno.test("executeAskIronTool surfaces DB errors without leaking stack traces", async () => {
  const { client } = makeStubClient({
    signals: { data: null, error: new Error("permission denied for relation signals") },
  });
  const ctx = makeCtx(client, { role: "rep" });
  const res = await executeAskIronTool(ctx, "list_recent_signals", {});
  assertEquals(res.ok, false);
  assertEquals(res.error, "permission denied for relation signals");
});

// ── normalizeProposeMoveInput ───────────────────────────────────────────────

Deno.test("normalizeProposeMoveInput rejects unknown kind", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  try {
    normalizeProposeMoveInput({ kind: "nuke_pipeline", title: "x" }, ctx);
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:kind");
  }
});

Deno.test("normalizeProposeMoveInput rejects missing title", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  try {
    normalizeProposeMoveInput({ kind: "call_now" }, ctx);
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:title");
  }
});

Deno.test("normalizeProposeMoveInput rejects entity_id without entity_type", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  try {
    normalizeProposeMoveInput(
      { kind: "call_now", title: "x", entity_id: "c-1" },
      ctx,
    );
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:entity_type");
  }
});

Deno.test("normalizeProposeMoveInput rejects activity/workspace entity scopes", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager" });
  try {
    normalizeProposeMoveInput(
      { kind: "other", title: "log it", entity_type: "workspace", entity_id: "ws-1" },
      ctx,
    );
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:entity_type");
  }
});

Deno.test("normalizeProposeMoveInput rejects past due_at beyond clock skew", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  try {
    normalizeProposeMoveInput(
      { kind: "call_now", title: "x", due_at: "2020-01-01T00:00:00Z" },
      ctx,
    );
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:due_at");
  }
});

Deno.test("normalizeProposeMoveInput pins rep callers to self regardless of model input", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
  const n = normalizeProposeMoveInput(
    { kind: "call_now", title: "x", assigned_rep_id: "rep-other" },
    ctx,
  );
  assertEquals(n.assignedRepId, "rep-me");
});

Deno.test("normalizeProposeMoveInput lets elevated callers route to another rep (and defaults to self if omitted)", () => {
  const { client } = makeStubClient({});
  const mgrCtx = makeCtx(client, { role: "manager", userId: "mgr-1" });
  const routed = normalizeProposeMoveInput(
    { kind: "send_quote", title: "x", assigned_rep_id: "rep-7" },
    mgrCtx,
  );
  assertEquals(routed.assignedRepId, "rep-7");
  const selfAssigned = normalizeProposeMoveInput(
    { kind: "send_quote", title: "x" },
    mgrCtx,
  );
  assertEquals(selfAssigned.assignedRepId, "mgr-1");
});

Deno.test("normalizeProposeMoveInput defaults priority to 55 and clamps to 0..100", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  assertEquals(
    normalizeProposeMoveInput({ kind: "call_now", title: "x" }, ctx).priority,
    55,
  );
  assertEquals(
    normalizeProposeMoveInput(
      { kind: "call_now", title: "x", priority: 500 },
      ctx,
    ).priority,
    100,
  );
  assertEquals(
    normalizeProposeMoveInput(
      { kind: "call_now", title: "x", priority: -1 },
      ctx,
    ).priority,
    0,
  );
});

Deno.test("normalizeProposeMoveInput clamps runaway titles with an ellipsis", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const long = "a".repeat(400);
  const n = normalizeProposeMoveInput({ kind: "call_now", title: long }, ctx);
  assertEquals(n.title.length <= 120, true);
  assertEquals(n.title.endsWith("…"), true);
});

// ── executor: propose_move ──────────────────────────────────────────────────

Deno.test(
  "executeAskIronTool propose_move inserts with workspace + ask_iron provenance",
  async () => {
    // Stub the admin insert — `createMove` hits ctx.admin.from("moves").insert().
    // We want to capture the insert row and verify workspace + provenance.
    const { client: callerDb } = makeStubClient({});
    const insertedRow = {
      id: "m-iron-1",
      workspace_id: "ws-1",
      kind: "call_now",
      status: "suggested",
      title: "Call Acme about CAT 305",
      priority: 55,
      entity_type: "deal",
      entity_id: "deal-7",
      assigned_rep_id: "rep-me",
      due_at: null,
    };
    const { client: admin, captures: adminCaptures } = makeStubClient({
      moves: { data: insertedRow, error: null },
    });
    const ctx = makeCtx(callerDb, { role: "rep", userId: "rep-me", admin });

    const res = await executeAskIronTool(
      ctx,
      "propose_move",
      {
        kind: "call_now",
        title: "Call Acme about CAT 305",
        rationale: "Operator asked for a follow-up",
        entity_type: "deal",
        entity_id: "deal-7",
      },
      createAskIronSession(),
    );

    assertEquals(res.ok, true);
    const data = res.data as { move: { id: string } };
    assertEquals(data.move.id, "m-iron-1");

    const movesInsert = adminCaptures.find((c) => c.table === "moves");
    if (!movesInsert?.insert) throw new Error("insert payload not captured");
    const row = movesInsert.insert as Record<string, unknown>;
    assertEquals(row.workspace_id, "ws-1");
    assertEquals(row.kind, "call_now");
    assertEquals(row.recommender, "ask_iron");
    assertEquals(row.recommender_version, "v1");
    assertEquals(row.assigned_rep_id, "rep-me");
    assertEquals(row.priority, 55);
    const payload = row.payload as Record<string, unknown>;
    assertEquals(payload.proposed_via, "ask_iron");
    assertEquals(payload.proposer_user_id, "rep-me");
  },
);

Deno.test(
  "executeAskIronTool propose_move rep cannot route moves to another rep",
  async () => {
    const { client: callerDb } = makeStubClient({});
    const { client: admin, captures: adminCaptures } = makeStubClient({
      moves: { data: { id: "m-1" }, error: null },
    });
    const ctx = makeCtx(callerDb, { role: "rep", userId: "rep-me", admin });

    const res = await executeAskIronTool(
      ctx,
      "propose_move",
      {
        kind: "send_follow_up",
        title: "Email the buyer",
        assigned_rep_id: "rep-other", // ← Iron/operator tries to hijack
      },
      createAskIronSession(),
    );
    assertEquals(res.ok, true);
    const row = adminCaptures.find((c) => c.table === "moves")?.insert as
      | Record<string, unknown>
      | undefined;
    // Rep-scoping pins to self even when the model passes a different id.
    assertEquals(row?.assigned_rep_id, "rep-me");
  },
);

Deno.test(
  `executeAskIronTool propose_move enforces session cap (max ${MAX_PROPOSE_MOVES_PER_REQUEST} per request)`,
  async () => {
    const { client: callerDb } = makeStubClient({});
    const { client: admin } = makeStubClient({
      moves: { data: { id: "m-1" }, error: null },
    });
    const ctx = makeCtx(callerDb, { role: "manager", userId: "mgr-1", admin });
    const session = createAskIronSession();

    // Drive the session up to the cap. Each of these should succeed.
    for (let i = 0; i < MAX_PROPOSE_MOVES_PER_REQUEST; i++) {
      const res = await executeAskIronTool(
        ctx,
        "propose_move",
        { kind: "other", title: `move ${i}` },
        session,
      );
      assertEquals(res.ok, true);
    }
    assertEquals(session.proposedMoveCount, MAX_PROPOSE_MOVES_PER_REQUEST);

    // One more call should be refused — the session is full.
    const overflow = await executeAskIronTool(
      ctx,
      "propose_move",
      { kind: "other", title: "one too many" },
      session,
    );
    assertEquals(overflow.ok, false);
    assertEquals(overflow.error?.includes("budget exhausted"), true);
    // Count must NOT increment on a rejected call.
    assertEquals(session.proposedMoveCount, MAX_PROPOSE_MOVES_PER_REQUEST);
  },
);

Deno.test(
  "executeAskIronTool propose_move returns a structured error for an unknown kind (no throw)",
  async () => {
    // Validation errors from normalize bubble as `tool_result.error` rather
    // than a 500. That's intentional: Claude sees the error string and can
    // apologize to the operator / pick a different kind.
    const { client: callerDb } = makeStubClient({});
    const ctx = makeCtx(callerDb, { role: "rep" });
    const res = await executeAskIronTool(
      ctx,
      "propose_move",
      { kind: "smoke_signal", title: "x" },
      createAskIronSession(),
    );
    assertEquals(res.ok, false);
    assertEquals(res.error, "VALIDATION_ERROR:kind");
  },
);

Deno.test(
  "executeAskIronTool propose_move works without a session (budget is off)",
  async () => {
    // Unit-test convenience: allow calling without a session to smoke-test
    // a single propose in isolation. The edge function always passes one.
    const { client: callerDb } = makeStubClient({});
    const { client: admin } = makeStubClient({
      moves: { data: { id: "m-ad-hoc" }, error: null },
    });
    const ctx = makeCtx(callerDb, { role: "rep", userId: "rep-1", admin });
    const res = await executeAskIronTool(
      ctx,
      "propose_move",
      { kind: "call_now", title: "Ad-hoc propose" },
    );
    assertEquals(res.ok, true);
  },
);

Deno.test(
  "executeAskIronTool propose_move rejects cross-workspace rep routing (elevated caller)",
  async () => {
    // A manager/admin/owner tries to route a move to a rep that lives in a
    // *different* workspace. The guard inside toolProposeMove should check
    // profiles.workspace_id via the admin client and throw before the insert
    // ever fires. This mirrors the same defense in toolListMyMoves but is
    // strictly more important because propose_move is a write.
    const { client: callerDb } = makeStubClient({});
    const { client: admin, captures: adminCaptures } = makeStubClient({
      // profiles lookup returns a rep whose workspace_id doesn't match.
      profiles: { data: { id: "rep-other", workspace_id: "ws-other" }, error: null },
      // If the guard is bypassed, this is what createMove would write to.
      moves: { data: { id: "m-should-not-insert" }, error: null },
    });
    const ctx = makeCtx(callerDb, {
      role: "manager",
      userId: "mgr-1",
      workspaceId: "ws-1",
      admin,
    });

    const res = await executeAskIronTool(
      ctx,
      "propose_move",
      {
        kind: "send_follow_up",
        title: "Email the buyer",
        assigned_rep_id: "rep-other",
      },
      createAskIronSession(),
    );

    assertEquals(res.ok, false);
    assertEquals(res.error, "rep not in workspace");

    // Verify the profiles lookup actually happened and the moves insert
    // did NOT — otherwise the guard is ornamental.
    const profilesCap = adminCaptures.find((c) => c.table === "profiles");
    if (!profilesCap) throw new Error("profiles lookup never ran");
    const movesCap = adminCaptures.find((c) => c.table === "moves");
    assertEquals(movesCap?.insert, undefined);
  },
);

Deno.test(
  "executeAskIronTool propose_move allows elevated routing to a rep in the SAME workspace",
  async () => {
    // Flip side of the guard: when profiles.workspace_id matches, the insert
    // proceeds. This keeps the happy-path "assign Jim's move to Jane" flow
    // working for managers.
    const { client: callerDb } = makeStubClient({});
    const { client: admin, captures: adminCaptures } = makeStubClient({
      profiles: { data: { id: "rep-other", workspace_id: "ws-1" }, error: null },
      moves: { data: { id: "m-ok" }, error: null },
    });
    const ctx = makeCtx(callerDb, {
      role: "manager",
      userId: "mgr-1",
      workspaceId: "ws-1",
      admin,
    });

    const res = await executeAskIronTool(
      ctx,
      "propose_move",
      {
        kind: "send_follow_up",
        title: "Email the buyer",
        assigned_rep_id: "rep-other",
      },
      createAskIronSession(),
    );
    assertEquals(res.ok, true);
    const movesCap = adminCaptures.find((c) => c.table === "moves");
    if (!movesCap?.insert) throw new Error("expected insert to fire");
    assertEquals(
      (movesCap.insert as Record<string, unknown>).assigned_rep_id,
      "rep-other",
    );
  },
);

Deno.test("normalizeProposeMoveInput rejects unknown due_at strings", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  try {
    normalizeProposeMoveInput(
      { kind: "call_now", title: "x", due_at: "not-a-date" },
      ctx,
    );
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:due_at");
  }
});
