import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ASK_IRON_TOOLS,
  createAskIronSession,
  executeAskIronTool,
  LIST_MY_TOUCHES_DEFAULT_HOURS,
  LIST_MY_TOUCHES_DEFAULT_LIMIT,
  LIST_MY_TOUCHES_MAX_LIMIT,
  LIST_MY_TOUCHES_TEXT_CAP,
  MAX_PROPOSE_MOVES_PER_REQUEST,
  normalizeListMyTouchesInput,
  normalizeMoveFilters,
  normalizeProposeMoveInput,
  normalizeSearchInput,
  normalizeSignalFilters,
  normalizeSummarizeCompanyInput,
  normalizeSummarizeDealInput,
  SUMMARIZE_COMPANY_DEAL_LIMIT,
  SUMMARIZE_DEAL_ACTIVITY_LIMIT,
  SUMMARIZE_DEAL_DEFAULT_DAYS,
  SUMMARIZE_DEAL_MAX_DAYS,
  SUMMARIZE_DEAL_SIGNAL_LIMIT,
  SUMMARIZE_DEAL_TEXT_CAP,
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

Deno.test("ASK_IRON_TOOLS exposes the nine tools", () => {
  const names = ASK_IRON_TOOLS.map((t) => t.name).sort();
  assertEquals(names, [
    "get_company_detail",
    "get_deal_detail",
    "list_my_moves",
    "list_my_touches",
    "list_recent_signals",
    "propose_move",
    "search_entities",
    "summarize_company",
    "summarize_deal",
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

// ── normalizeSummarizeDealInput (Slice 10) ──────────────────────────────────

Deno.test("normalizeSummarizeDealInput defaults lookback_days to 30", () => {
  const now = Date.parse("2026-04-20T12:00:00Z");
  const n = normalizeSummarizeDealInput({ deal_id: "d-1" }, now);
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
  // since = now - 30d
  assertEquals(n.sinceIso, new Date(now - 30 * 86400_000).toISOString());
});

Deno.test("normalizeSummarizeDealInput clamps lookback_days above max", () => {
  const n = normalizeSummarizeDealInput(
    { deal_id: "d-1", lookback_days: 9999 },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_MAX_DAYS);
});

Deno.test("normalizeSummarizeDealInput clamps lookback_days below 1", () => {
  const n = normalizeSummarizeDealInput(
    { deal_id: "d-1", lookback_days: 0 },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, 1);
});

Deno.test("normalizeSummarizeDealInput falls back to default when lookback is non-numeric", () => {
  const n = normalizeSummarizeDealInput(
    { deal_id: "d-1", lookback_days: "two weeks" },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeDealInput trims whitespace from deal_id", () => {
  const n = normalizeSummarizeDealInput(
    { deal_id: "  deal-42  " },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.dealId, "deal-42");
});

Deno.test("normalizeSummarizeDealInput throws VALIDATION_ERROR when deal_id is missing", () => {
  try {
    normalizeSummarizeDealInput({});
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:deal_id");
  }
});

Deno.test("normalizeSummarizeDealInput throws when deal_id is empty string", () => {
  try {
    normalizeSummarizeDealInput({ deal_id: "" });
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:deal_id");
  }
});

Deno.test("normalizeSummarizeDealInput throws when deal_id is whitespace-only", () => {
  try {
    normalizeSummarizeDealInput({ deal_id: "   " });
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:deal_id");
  }
});

// ── executor: summarize_deal (Slice 10) ────────────────────────────────────

Deno.test("executeAskIronTool summarize_deal returns found:false for missing/invisible deal", async () => {
  const { client } = makeStubClient({
    crm_deals_rep_safe: { data: null, error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });
  const res = await executeAskIronTool(ctx, "summarize_deal", {
    deal_id: "ghost",
  });
  assertEquals(res.ok, true);
  const payload = res.data as { found: boolean; lookback_days: number };
  assertEquals(payload.found, false);
  // Even on miss, lookback is echoed so Claude knows the window it searched.
  assertEquals(payload.lookback_days, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test(
  "executeAskIronTool summarize_deal short-circuits: no activity or signal query when deal missing",
  async () => {
    const { client, captures } = makeStubClient({
      crm_deals_rep_safe: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_deal", { deal_id: "ghost" });

    // Only the deal query should have fired.
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("crm_activities"), false);
    assertEquals(tables.includes("signals"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_deal bundles deal + activities + signals in one call",
  async () => {
    const { client, captures } = makeStubClient({
      crm_deals_rep_safe: {
        data: {
          id: "d-1",
          name: "Acme CAT 305",
          amount: 140000,
          stage: "proposal",
          expected_close_on: "2026-05-15",
          assigned_rep_id: "rep-me",
          company_id: "co-1",
          updated_at: "2026-04-18T12:00:00Z",
        },
        error: null,
      },
      crm_activities: {
        data: [
          {
            id: "a-1",
            activity_type: "call",
            body: "Follow-up on proposal",
            occurred_at: "2026-04-19T15:00:00Z",
            created_by: "rep-me",
          },
        ],
        error: null,
      },
      signals: {
        data: [
          {
            id: "s-1",
            kind: "quote_viewed",
            severity: "medium",
            source: "docuware",
            title: "Acme viewed proposal",
            description: "2nd view",
            occurred_at: "2026-04-19T16:00:00Z",
          },
        ],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep", workspaceId: "ws-1" });
    const res = await executeAskIronTool(ctx, "summarize_deal", {
      deal_id: "d-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      deal: { id: string };
      recent_activities: Array<{ id: string }>;
      open_signals: Array<{ id: string }>;
      counts: { activities: number; signals: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.deal.id, "d-1");
    assertEquals(payload.recent_activities.length, 1);
    assertEquals(payload.open_signals.length, 1);
    assertEquals(payload.counts.activities, 1);
    assertEquals(payload.counts.signals, 1);

    // All three queries must carry the workspace filter.
    for (const table of ["crm_deals_rep_safe", "crm_activities", "signals"]) {
      const q = captures.find((c) => c.table === table);
      if (!q) throw new Error(`missing capture for ${table}`);
      const ws = q.filters.find(
        (f) => f.op === "eq" && f.column === "workspace_id",
      );
      assertEquals(ws?.value, "ws-1", `${table} missing workspace_id filter`);
    }
  },
);

Deno.test(
  "executeAskIronTool summarize_deal filters activities to the exact deal_id and soft-delete-null",
  async () => {
    const { client, captures } = makeStubClient({
      crm_deals_rep_safe: {
        data: {
          id: "d-42",
          name: "Scope test",
          amount: null,
          stage: "qualified",
          expected_close_on: null,
          assigned_rep_id: null,
          company_id: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_deal", { deal_id: "d-42" });

    const activities = captures.find((c) => c.table === "crm_activities");
    if (!activities) throw new Error("no activity capture");
    const dealFilter = activities.filters.find(
      (f) => f.op === "eq" && f.column === "deal_id",
    );
    assertEquals(dealFilter?.value, "d-42");
    const softFilter = activities.filters.find(
      (f) => f.op === "is" && f.column === "deleted_at",
    );
    assertEquals(softFilter?.value, null);
  },
);

Deno.test(
  "executeAskIronTool summarize_deal filters signals to entity_type='deal' + entity_id",
  async () => {
    const { client, captures } = makeStubClient({
      crm_deals_rep_safe: {
        data: {
          id: "d-9",
          name: "Scope test",
          amount: 1,
          stage: "qualified",
          expected_close_on: null,
          assigned_rep_id: null,
          company_id: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_deal", { deal_id: "d-9" });

    const signals = captures.find((c) => c.table === "signals");
    if (!signals) throw new Error("no signal capture");
    const typeFilter = signals.filters.find(
      (f) => f.op === "eq" && f.column === "entity_type",
    );
    assertEquals(typeFilter?.value, "deal");
    const idFilter = signals.filters.find(
      (f) => f.op === "eq" && f.column === "entity_id",
    );
    assertEquals(idFilter?.value, "d-9");
  },
);

Deno.test(
  "executeAskIronTool summarize_deal hard-caps activity + signal limits regardless of lookback",
  async () => {
    const { client, captures } = makeStubClient({
      crm_deals_rep_safe: {
        data: {
          id: "d-big",
          name: "Chatty deal",
          amount: 1,
          stage: "qualified",
          expected_close_on: null,
          assigned_rep_id: null,
          company_id: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_deal", {
      deal_id: "d-big",
      lookback_days: 90,
    });

    const activities = captures.find((c) => c.table === "crm_activities");
    const signals = captures.find((c) => c.table === "signals");
    assertEquals(activities?.limit, SUMMARIZE_DEAL_ACTIVITY_LIMIT);
    assertEquals(signals?.limit, SUMMARIZE_DEAL_SIGNAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_deal truncates long activity bodies and signal descriptions",
  async () => {
    const longText = "x".repeat(SUMMARIZE_DEAL_TEXT_CAP + 500);
    const { client } = makeStubClient({
      crm_deals_rep_safe: {
        data: {
          id: "d-1",
          name: "Deal",
          amount: 1,
          stage: "qualified",
          expected_close_on: null,
          assigned_rep_id: null,
          company_id: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_activities: {
        data: [{
          id: "a-1",
          activity_type: "note",
          body: longText,
          occurred_at: "2026-04-19T15:00:00Z",
          created_by: null,
        }],
        error: null,
      },
      signals: {
        data: [{
          id: "s-1",
          kind: "quote_viewed",
          severity: "low",
          source: "docuware",
          title: "viewed",
          description: longText,
          occurred_at: "2026-04-19T16:00:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_deal", {
      deal_id: "d-1",
    });
    const payload = res.data as {
      recent_activities: Array<{ body: string | null }>;
      open_signals: Array<{ description: string | null }>;
    };
    // After truncation the field length must be <= cap.
    assertEquals(payload.recent_activities[0].body!.length <= SUMMARIZE_DEAL_TEXT_CAP, true);
    assertEquals(payload.open_signals[0].description!.length <= SUMMARIZE_DEAL_TEXT_CAP, true);
    // And must show the ellipsis marker (indicates we truncated, not just trimmed).
    assertEquals(payload.recent_activities[0].body!.endsWith("…"), true);
  },
);

Deno.test(
  "executeAskIronTool summarize_deal returns VALIDATION_ERROR for missing deal_id",
  async () => {
    const { client } = makeStubClient({});
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_deal", {});
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("VALIDATION_ERROR"), true);
  },
);

// ── normalizeSummarizeCompanyInput (Slice 11) ──────────────────────────────

Deno.test("normalizeSummarizeCompanyInput defaults lookback_days to the same window as deals", () => {
  const now = Date.parse("2026-04-20T12:00:00Z");
  const n = normalizeSummarizeCompanyInput({ company_id: "co-1" }, now);
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
  assertEquals(n.sinceIso, new Date(now - 30 * 86400_000).toISOString());
});

Deno.test("normalizeSummarizeCompanyInput clamps lookback above max", () => {
  const n = normalizeSummarizeCompanyInput(
    { company_id: "co-1", lookback_days: 9999 },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_MAX_DAYS);
});

Deno.test("normalizeSummarizeCompanyInput clamps lookback below 1", () => {
  const n = normalizeSummarizeCompanyInput(
    { company_id: "co-1", lookback_days: -5 },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, 1);
});

Deno.test("normalizeSummarizeCompanyInput trims whitespace from company_id", () => {
  const n = normalizeSummarizeCompanyInput(
    { company_id: "  co-42  " },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.companyId, "co-42");
});

Deno.test("normalizeSummarizeCompanyInput throws VALIDATION_ERROR when company_id is missing", () => {
  try {
    normalizeSummarizeCompanyInput({});
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:company_id");
  }
});

Deno.test("normalizeSummarizeCompanyInput throws when company_id is whitespace-only", () => {
  try {
    normalizeSummarizeCompanyInput({ company_id: "   " });
    throw new Error("expected throw");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:company_id");
  }
});

// ── executor: summarize_company (Slice 11) ─────────────────────────────────

Deno.test(
  "executeAskIronTool summarize_company returns found:false for missing/invisible company",
  async () => {
    const { client } = makeStubClient({
      crm_companies: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_company", {
      company_id: "ghost",
    });
    assertEquals(res.ok, true);
    const payload = res.data as { found: boolean; lookback_days: number };
    assertEquals(payload.found, false);
    assertEquals(payload.lookback_days, SUMMARIZE_DEAL_DEFAULT_DAYS);
  },
);

Deno.test(
  "executeAskIronTool summarize_company short-circuits: no deal/activity/signal query when company missing",
  async () => {
    const { client, captures } = makeStubClient({
      crm_companies: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_company", {
      company_id: "ghost",
    });
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("crm_deals_rep_safe"), false);
    assertEquals(tables.includes("crm_activities"), false);
    assertEquals(tables.includes("signals"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_company bundles company + deals + activities + signals in one call",
  async () => {
    const { client, captures } = makeStubClient({
      crm_companies: {
        data: {
          id: "co-1",
          name: "Acme Materials",
          city: "Tulsa",
          state: "OK",
          country: "US",
          industry: "Aggregates",
          updated_at: "2026-04-19T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: {
        data: [
          {
            id: "d-1",
            name: "Acme CAT 305",
            amount: 140000,
            stage: "proposal",
            expected_close_on: "2026-05-15",
            assigned_rep_id: "rep-me",
            updated_at: "2026-04-18T12:00:00Z",
          },
        ],
        error: null,
      },
      crm_activities: {
        data: [
          {
            id: "a-1",
            activity_type: "call",
            body: "Checked in with procurement",
            occurred_at: "2026-04-19T15:00:00Z",
            created_by: "rep-me",
            deal_id: null,
            contact_id: "c-1",
          },
        ],
        error: null,
      },
      signals: {
        data: [
          {
            id: "s-1",
            kind: "news_mention",
            severity: "medium",
            source: "news",
            title: "Acme expansion announced",
            description: "Press release",
            occurred_at: "2026-04-19T16:00:00Z",
          },
        ],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep", workspaceId: "ws-1" });
    const res = await executeAskIronTool(ctx, "summarize_company", {
      company_id: "co-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      company: { id: string };
      open_deals: Array<{ id: string }>;
      recent_activities: Array<{ id: string }>;
      open_signals: Array<{ id: string }>;
      counts: { deals: number; activities: number; signals: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.company.id, "co-1");
    assertEquals(payload.open_deals.length, 1);
    assertEquals(payload.recent_activities.length, 1);
    assertEquals(payload.open_signals.length, 1);
    assertEquals(payload.counts.deals, 1);
    assertEquals(payload.counts.activities, 1);
    assertEquals(payload.counts.signals, 1);

    // All four queries must carry the workspace filter.
    for (
      const table of [
        "crm_companies",
        "crm_deals_rep_safe",
        "crm_activities",
        "signals",
      ]
    ) {
      const q = captures.find((c) => c.table === table);
      if (!q) throw new Error(`missing capture for ${table}`);
      const ws = q.filters.find(
        (f) => f.op === "eq" && f.column === "workspace_id",
      );
      assertEquals(ws?.value, "ws-1", `${table} missing workspace_id filter`);
    }
  },
);

Deno.test(
  "executeAskIronTool summarize_company filters activities to the exact company_id with soft-delete guard",
  async () => {
    const { client, captures } = makeStubClient({
      crm_companies: {
        data: {
          id: "co-9",
          name: "Company",
          city: null,
          state: null,
          country: null,
          industry: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_company", { company_id: "co-9" });

    const activities = captures.find((c) => c.table === "crm_activities");
    if (!activities) throw new Error("no activity capture");
    const companyFilter = activities.filters.find(
      (f) => f.op === "eq" && f.column === "company_id",
    );
    assertEquals(companyFilter?.value, "co-9");
    const soft = activities.filters.find(
      (f) => f.op === "is" && f.column === "deleted_at",
    );
    assertEquals(soft?.value, null);
  },
);

Deno.test(
  "executeAskIronTool summarize_company filters signals to entity_type='company' + entity_id",
  async () => {
    const { client, captures } = makeStubClient({
      crm_companies: {
        data: {
          id: "co-9",
          name: "Company",
          city: null,
          state: null,
          country: null,
          industry: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_company", { company_id: "co-9" });

    const signals = captures.find((c) => c.table === "signals");
    if (!signals) throw new Error("no signal capture");
    const typeFilter = signals.filters.find(
      (f) => f.op === "eq" && f.column === "entity_type",
    );
    assertEquals(typeFilter?.value, "company");
    const idFilter = signals.filters.find(
      (f) => f.op === "eq" && f.column === "entity_id",
    );
    assertEquals(idFilter?.value, "co-9");
  },
);

Deno.test(
  "executeAskIronTool summarize_company guards the company read with deleted_at is null",
  async () => {
    const { client, captures } = makeStubClient({
      crm_companies: {
        data: {
          id: "co-9",
          name: "Company",
          city: null,
          state: null,
          country: null,
          industry: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_company", { company_id: "co-9" });

    const company = captures.find((c) => c.table === "crm_companies");
    if (!company) throw new Error("no company capture");
    const soft = company.filters.find(
      (f) => f.op === "is" && f.column === "deleted_at",
    );
    assertEquals(soft?.value, null);
  },
);

Deno.test(
  "executeAskIronTool summarize_company hard-caps the deal list regardless of lookback",
  async () => {
    const { client, captures } = makeStubClient({
      crm_companies: {
        data: {
          id: "co-big",
          name: "Big account",
          city: null,
          state: null,
          country: null,
          industry: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_company", {
      company_id: "co-big",
      lookback_days: 90,
    });

    const deals = captures.find((c) => c.table === "crm_deals_rep_safe");
    const activities = captures.find((c) => c.table === "crm_activities");
    const signals = captures.find((c) => c.table === "signals");
    assertEquals(deals?.limit, SUMMARIZE_COMPANY_DEAL_LIMIT);
    assertEquals(activities?.limit, SUMMARIZE_DEAL_ACTIVITY_LIMIT);
    assertEquals(signals?.limit, SUMMARIZE_DEAL_SIGNAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_company truncates long activity bodies and signal descriptions",
  async () => {
    const longText = "y".repeat(SUMMARIZE_DEAL_TEXT_CAP + 500);
    const { client } = makeStubClient({
      crm_companies: {
        data: {
          id: "co-1",
          name: "Company",
          city: null,
          state: null,
          country: null,
          industry: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: {
        data: [{
          id: "a-1",
          activity_type: "note",
          body: longText,
          occurred_at: "2026-04-19T15:00:00Z",
          created_by: null,
          deal_id: null,
          contact_id: null,
        }],
        error: null,
      },
      signals: {
        data: [{
          id: "s-1",
          kind: "news_mention",
          severity: "low",
          source: "news",
          title: "t",
          description: longText,
          occurred_at: "2026-04-19T16:00:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_company", {
      company_id: "co-1",
    });
    const payload = res.data as {
      recent_activities: Array<{ body: string | null }>;
      open_signals: Array<{ description: string | null }>;
    };
    assertEquals(
      payload.recent_activities[0].body!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
    assertEquals(
      payload.open_signals[0].description!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
    assertEquals(payload.recent_activities[0].body!.endsWith("…"), true);
  },
);

Deno.test(
  "executeAskIronTool summarize_company returns VALIDATION_ERROR for missing company_id",
  async () => {
    const { client } = makeStubClient({});
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_company", {});
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("VALIDATION_ERROR"), true);
  },
);

// ── normalizeListMyTouchesInput (Slice 13) ─────────────────────────────────

Deno.test("normalizeListMyTouchesInput defaults since_hours to 72 (work-week)", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const fixedNow = Date.parse("2026-04-20T12:00:00Z");
  const f = normalizeListMyTouchesInput({}, ctx, fixedNow);
  const expected = new Date(
    fixedNow - LIST_MY_TOUCHES_DEFAULT_HOURS * 3_600_000,
  ).toISOString();
  assertEquals(f.sinceIso, expected);
  assertEquals(f.limit, LIST_MY_TOUCHES_DEFAULT_LIMIT);
});

Deno.test("normalizeListMyTouchesInput clamps since_hours above 168", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const fixedNow = Date.parse("2026-04-20T12:00:00Z");
  const f = normalizeListMyTouchesInput({ since_hours: 500 }, ctx, fixedNow);
  const expected = new Date(fixedNow - 168 * 3_600_000).toISOString();
  assertEquals(f.sinceIso, expected);
});

Deno.test("normalizeListMyTouchesInput clamps since_hours below 1", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const fixedNow = Date.parse("2026-04-20T12:00:00Z");
  const f = normalizeListMyTouchesInput({ since_hours: 0 }, ctx, fixedNow);
  const expected = new Date(fixedNow - 1 * 3_600_000).toISOString();
  assertEquals(f.sinceIso, expected);
});

Deno.test("normalizeListMyTouchesInput clamps limit to max 50", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput({ limit: 500 }, ctx);
  assertEquals(f.limit, LIST_MY_TOUCHES_MAX_LIMIT);
});

Deno.test("normalizeListMyTouchesInput falls back to default limit when non-numeric", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput({ limit: "foo" }, ctx);
  assertEquals(f.limit, LIST_MY_TOUCHES_DEFAULT_LIMIT);
});

Deno.test("normalizeListMyTouchesInput pins rep callers to self even if model passes another rep_id", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
  const f = normalizeListMyTouchesInput({ rep_id: "rep-other" }, ctx);
  assertEquals(f.repId, "rep-me");
});

Deno.test("normalizeListMyTouchesInput lets managers target a specific rep_id", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager", userId: "mgr-1" });
  const f = normalizeListMyTouchesInput({ rep_id: "rep-42" }, ctx);
  assertEquals(f.repId, "rep-42");
});

Deno.test("normalizeListMyTouchesInput leaves repId null for elevated callers who omit rep_id", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "admin", userId: "admin-1" });
  const f = normalizeListMyTouchesInput({}, ctx);
  assertEquals(f.repId, null);
});

Deno.test("normalizeListMyTouchesInput accepts valid entity scope (deal + id)", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput(
    { entity_type: "deal", entity_id: "d-1" },
    ctx,
  );
  assertEquals(f.entityType, "deal");
  assertEquals(f.entityId, "d-1");
});

Deno.test("normalizeListMyTouchesInput drops partial entity scope (type without id)", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput({ entity_type: "deal" }, ctx);
  assertEquals(f.entityType, null);
  assertEquals(f.entityId, null);
});

Deno.test("normalizeListMyTouchesInput drops partial entity scope (id without type)", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput({ entity_id: "d-1" }, ctx);
  assertEquals(f.entityType, null);
  assertEquals(f.entityId, null);
});

Deno.test("normalizeListMyTouchesInput rejects unknown entity_type", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput(
    { entity_type: "equipment", entity_id: "e-1" },
    ctx,
  );
  assertEquals(f.entityType, null);
  assertEquals(f.entityId, null);
});

Deno.test("normalizeListMyTouchesInput filters non-string + empty activity_types", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const f = normalizeListMyTouchesInput(
    { activity_types: ["call", "", 42, "  ", "email", null] as unknown[] },
    ctx,
  );
  assertEquals(f.activityTypes, ["call", "email"]);
});

// ── executeAskIronTool list_my_touches ─────────────────────────────────────

Deno.test(
  "executeAskIronTool list_my_touches scopes to workspace + soft-delete + since + caller",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    const res = await executeAskIronTool(ctx, "list_my_touches", {});
    assertEquals(res.ok, true);
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(cap?.table, "crm_activities");
    // workspace_id filter
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "eq" && f.column === "workspace_id" && f.value === "ws-1",
      ),
      true,
    );
    // deleted_at is null
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "is" && f.column === "deleted_at" && f.value === null,
      ),
      true,
    );
    // since_hours -> gte on occurred_at
    assertEquals(
      cap?.filters.some((f) => f.op === "gte" && f.column === "occurred_at"),
      true,
    );
    // rep pinning -> created_by = caller userId
    assertEquals(
      cap?.filters.some(
        (f) =>
          f.op === "eq" && f.column === "created_by" && f.value === "rep-me",
      ),
      true,
    );
  },
);

Deno.test(
  "executeAskIronTool list_my_touches skips created_by filter when elevated caller omits rep_id",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "admin", userId: "admin-1" });
    await executeAskIronTool(ctx, "list_my_touches", {});
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "eq" && f.column === "created_by",
      ),
      false,
    );
  },
);

Deno.test(
  "executeAskIronTool list_my_touches applies activity_types IN filter when provided",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "list_my_touches", {
      activity_types: ["call", "follow_up"],
    });
    const cap = captures.find((c) => c.table === "crm_activities");
    const inFilter = cap?.filters.find(
      (f) => f.op === "in" && f.column === "activity_type",
    );
    assertEquals(inFilter?.value, ["call", "follow_up"]);
  },
);

Deno.test(
  "executeAskIronTool list_my_touches maps entity_type=deal to deal_id column",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "list_my_touches", {
      entity_type: "deal",
      entity_id: "d-42",
    });
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "eq" && f.column === "deal_id" && f.value === "d-42",
      ),
      true,
    );
  },
);

Deno.test(
  "executeAskIronTool list_my_touches maps entity_type=company to company_id column",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "list_my_touches", {
      entity_type: "company",
      entity_id: "co-7",
    });
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "eq" && f.column === "company_id" && f.value === "co-7",
      ),
      true,
    );
  },
);

Deno.test(
  "executeAskIronTool list_my_touches maps entity_type=contact to contact_id column",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "list_my_touches", {
      entity_type: "contact",
      entity_id: "c-9",
    });
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "eq" && f.column === "contact_id" && f.value === "c-9",
      ),
      true,
    );
  },
);

Deno.test(
  "executeAskIronTool list_my_touches truncates long body fields at the text cap",
  async () => {
    const long = "x".repeat(LIST_MY_TOUCHES_TEXT_CAP * 2);
    const { client } = makeStubClient({
      crm_activities: {
        data: [
          {
            id: "a-1",
            activity_type: "note",
            body: long,
            occurred_at: "2026-04-20T10:00:00Z",
            created_by: "rep-me",
            deal_id: null,
            company_id: null,
            contact_id: null,
          },
        ],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    const res = await executeAskIronTool(ctx, "list_my_touches", {});
    const payload = res.data as { touches: Array<{ body: string | null }>; count: number };
    assertEquals(payload.touches.length, 1);
    assertEquals(payload.touches[0].body!.length <= LIST_MY_TOUCHES_TEXT_CAP, true);
    assertEquals(payload.touches[0].body!.endsWith("…"), true);
    assertEquals(payload.count, 1);
  },
);

Deno.test(
  "executeAskIronTool list_my_touches honors hard limit cap of 50",
  async () => {
    const { client, captures } = makeStubClient({
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "list_my_touches", { limit: 999 });
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(cap?.limit, LIST_MY_TOUCHES_MAX_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool list_my_touches blocks elevated cross-workspace rep targeting",
  async () => {
    const { client } = makeStubClient({
      profiles: {
        data: { id: "rep-other", workspace_id: "ws-OTHER" },
        error: null,
      },
    });
    const ctx = makeCtx(client, {
      role: "manager",
      userId: "mgr-1",
      workspaceId: "ws-1",
    });
    const res = await executeAskIronTool(ctx, "list_my_touches", {
      rep_id: "rep-other",
    });
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("rep not in workspace"), true);
  },
);

Deno.test(
  "executeAskIronTool list_my_touches allows manager targeting a rep in the same workspace",
  async () => {
    const { client, captures } = makeStubClient({
      profiles: {
        data: { id: "rep-me", workspace_id: "ws-1" },
        error: null,
      },
      crm_activities: { data: [], error: null },
    });
    const ctx = makeCtx(client, {
      role: "manager",
      userId: "mgr-1",
      workspaceId: "ws-1",
    });
    const res = await executeAskIronTool(ctx, "list_my_touches", {
      rep_id: "rep-me",
    });
    assertEquals(res.ok, true);
    const cap = captures.find((c) => c.table === "crm_activities");
    assertEquals(
      cap?.filters.some(
        (f) => f.op === "eq" && f.column === "created_by" && f.value === "rep-me",
      ),
      true,
    );
  },
);
