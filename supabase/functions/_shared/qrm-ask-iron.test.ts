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
  normalizeSummarizeContactInput,
  normalizeSummarizeDayInput,
  normalizeSummarizeDealInput,
  normalizeSummarizeEquipmentInput,
  normalizeSummarizeRentalInput,
  normalizeSummarizeSignalInput,
  SUMMARIZE_COMPANY_DEAL_LIMIT,
  SUMMARIZE_CONTACT_DEAL_LIMIT,
  SUMMARIZE_DAY_COMPLETED_LIMIT,
  SUMMARIZE_DAY_DEFAULT_HOURS,
  SUMMARIZE_DAY_MOVE_LIMIT,
  SUMMARIZE_DAY_SIGNAL_LIMIT,
  SUMMARIZE_DAY_TOUCH_LIMIT,
  SUMMARIZE_DEAL_ACTIVITY_LIMIT,
  SUMMARIZE_DEAL_DEFAULT_DAYS,
  SUMMARIZE_DEAL_MAX_DAYS,
  SUMMARIZE_DEAL_SIGNAL_LIMIT,
  SUMMARIZE_DEAL_TEXT_CAP,
  SUMMARIZE_EQUIPMENT_OPEN_RENTAL_STATUSES,
  SUMMARIZE_EQUIPMENT_RENTAL_LIMIT,
  SUMMARIZE_EQUIPMENT_SIGNAL_LIMIT,
  SUMMARIZE_EQUIPMENT_TOUCH_LIMIT,
  SUMMARIZE_RENTAL_SIGNAL_LIMIT,
  SUMMARIZE_SIGNAL_RELATED_MOVE_LIMIT,
  SUMMARIZE_SIGNAL_RELATED_SIGNAL_LIMIT,
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
      neq: (column: string, value: unknown) => {
        capture.filters.push({ op: "neq", column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        capture.filters.push({ op: "in", column, value });
        return builder;
      },
      contains: (column: string, value: unknown) => {
        capture.filters.push({ op: "contains", column, value });
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

Deno.test("ASK_IRON_TOOLS exposes the fourteen tools", () => {
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
    "summarize_contact",
    "summarize_day",
    "summarize_deal",
    "summarize_equipment",
    "summarize_rental",
    "summarize_signal",
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

// ── normalizeSummarizeDayInput (Slice 14) ──────────────────────────────────

Deno.test("normalizeSummarizeDayInput defaults lookback_hours to 24", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const fixedNow = Date.parse("2026-04-20T12:00:00Z");
  const n = normalizeSummarizeDayInput({}, ctx, fixedNow);
  assertEquals(n.lookbackHours, SUMMARIZE_DAY_DEFAULT_HOURS);
  const expected = new Date(
    fixedNow - SUMMARIZE_DAY_DEFAULT_HOURS * 3_600_000,
  ).toISOString();
  assertEquals(n.sinceIso, expected);
});

Deno.test("normalizeSummarizeDayInput clamps lookback above 168 hours", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const n = normalizeSummarizeDayInput({ lookback_hours: 999 }, ctx);
  assertEquals(n.lookbackHours, 168);
});

Deno.test("normalizeSummarizeDayInput clamps lookback below 1", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const n = normalizeSummarizeDayInput({ lookback_hours: 0 }, ctx);
  assertEquals(n.lookbackHours, 1);
});

Deno.test("normalizeSummarizeDayInput falls back to default when lookback is non-numeric", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep" });
  const n = normalizeSummarizeDayInput({ lookback_hours: "foo" }, ctx);
  assertEquals(n.lookbackHours, SUMMARIZE_DAY_DEFAULT_HOURS);
});

Deno.test("normalizeSummarizeDayInput pins rep callers to self regardless of rep_id input", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
  const n = normalizeSummarizeDayInput({ rep_id: "rep-other" }, ctx);
  assertEquals(n.repId, "rep-me");
});

Deno.test("normalizeSummarizeDayInput lets managers target a specific rep_id", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "manager", userId: "mgr-1" });
  const n = normalizeSummarizeDayInput({ rep_id: "rep-42" }, ctx);
  assertEquals(n.repId, "rep-42");
});

Deno.test("normalizeSummarizeDayInput leaves repId null for elevated callers who omit rep_id", () => {
  const { client } = makeStubClient({});
  const ctx = makeCtx(client, { role: "admin", userId: "admin-1" });
  const n = normalizeSummarizeDayInput({}, ctx);
  assertEquals(n.repId, null);
});

// ── executeAskIronTool summarize_day ───────────────────────────────────────

Deno.test(
  "executeAskIronTool summarize_day bundles active + completed + touches + signals for a rep caller",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        {
          data: [
            {
              id: "m-a",
              kind: "call_now",
              status: "suggested",
              title: "Call Acme",
              rationale: "Quote opened twice",
              priority: 85,
              entity_type: "deal",
              entity_id: "d-1",
              assigned_rep_id: "rep-me",
              due_at: null,
              created_at: "2026-04-20T09:00:00Z",
            },
          ],
          error: null,
        },
        {
          data: [
            {
              id: "m-c",
              kind: "send_quote",
              title: "Sent Acme quote",
              priority: 60,
              entity_type: "deal",
              entity_id: "d-1",
              assigned_rep_id: "rep-me",
              completed_at: "2026-04-20T11:00:00Z",
            },
          ],
          error: null,
        },
      ],
      crm_activities: {
        data: [
          {
            id: "a-1",
            activity_type: "call",
            body: "Short call.",
            occurred_at: "2026-04-20T11:30:00Z",
            created_by: "rep-me",
            deal_id: "d-1",
            company_id: null,
            contact_id: null,
          },
        ],
        error: null,
      },
      signals: {
        data: [
          {
            id: "s-1",
            kind: "quote_viewed",
            severity: "high",
            source: "email",
            title: "Quote viewed again",
            description: "Buyer opened PDF.",
            entity_type: "deal",
            entity_id: "d-1",
            occurred_at: "2026-04-20T10:30:00Z",
          },
        ],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    const res = await executeAskIronTool(ctx, "summarize_day", {});
    assertEquals(res.ok, true);

    const payload = res.data as {
      lookback_hours: number;
      rep_id: string | null;
      active_moves: Array<unknown>;
      completed_today: Array<unknown>;
      recent_touches: Array<unknown>;
      open_signals: Array<unknown>;
      counts: Record<string, number>;
    };
    assertEquals(payload.lookback_hours, SUMMARIZE_DAY_DEFAULT_HOURS);
    assertEquals(payload.rep_id, "rep-me");
    assertEquals(payload.active_moves.length, 1);
    assertEquals(payload.completed_today.length, 1);
    assertEquals(payload.recent_touches.length, 1);
    assertEquals(payload.open_signals.length, 1);
    assertEquals(payload.counts.active_moves, 1);
    assertEquals(payload.counts.open_signals, 1);

    // Four distinct queries hit: moves (twice), crm_activities, signals.
    const tables = captures.map((c) => c.table);
    assertEquals(tables.filter((t) => t === "moves").length, 2);
    assertEquals(tables.includes("crm_activities"), true);
    assertEquals(tables.includes("signals"), true);
  },
);

Deno.test(
  "executeAskIronTool summarize_day scopes every query to the workspace",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "summarize_day", {});
    for (const cap of captures) {
      assertEquals(
        cap.filters.some(
          (f) =>
            f.op === "eq" && f.column === "workspace_id" && f.value === "ws-1",
        ),
        true,
        `table ${cap.table} missing workspace_id filter`,
      );
    }
  },
);

Deno.test(
  "executeAskIronTool summarize_day filters active moves by assigned_rep_id for rep callers",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "summarize_day", {});
    const moveCaptures = captures.filter((c) => c.table === "moves");
    assertEquals(moveCaptures.length, 2);
    // Both queries should carry assigned_rep_id = rep-me
    for (const cap of moveCaptures) {
      assertEquals(
        cap.filters.some(
          (f) =>
            f.op === "eq" && f.column === "assigned_rep_id" &&
            f.value === "rep-me",
        ),
        true,
      );
    }
  },
);

Deno.test(
  "executeAskIronTool summarize_day scopes completed moves to status=completed + gte(completed_at)",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "summarize_day", {});
    // Second moves capture is the completed-arm.
    const moveCaps = captures.filter((c) => c.table === "moves");
    const completedCap = moveCaps[1];
    assertEquals(
      completedCap.filters.some(
        (f) => f.op === "eq" && f.column === "status" && f.value === "completed",
      ),
      true,
    );
    assertEquals(
      completedCap.filters.some(
        (f) => f.op === "gte" && f.column === "completed_at",
      ),
      true,
    );
  },
);

Deno.test(
  "executeAskIronTool summarize_day filters signals to medium+ severities",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "summarize_day", {});
    const sigCap = captures.find((c) => c.table === "signals");
    const sevFilter = sigCap?.filters.find(
      (f) => f.op === "in" && f.column === "severity",
    );
    assertEquals(sevFilter?.value, ["medium", "high", "critical"]);
  },
);

Deno.test(
  "executeAskIronTool summarize_day does NOT filter signals by rep (workspace-wide)",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "summarize_day", {});
    const sigCap = captures.find((c) => c.table === "signals");
    // No created_by / assigned_rep_id filter on signals — workspace-wide
    assertEquals(
      sigCap?.filters.some(
        (f) =>
          (f.column === "assigned_rep_id" || f.column === "created_by"),
      ),
      false,
    );
  },
);

Deno.test(
  "executeAskIronTool summarize_day skips rep filters entirely when elevated caller omits rep_id",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "admin", userId: "admin-1" });
    await executeAskIronTool(ctx, "summarize_day", {});
    const moveCaps = captures.filter((c) => c.table === "moves");
    for (const cap of moveCaps) {
      assertEquals(
        cap.filters.some(
          (f) => f.op === "eq" && f.column === "assigned_rep_id",
        ),
        false,
      );
    }
    const touchCap = captures.find((c) => c.table === "crm_activities");
    assertEquals(
      touchCap?.filters.some(
        (f) => f.op === "eq" && f.column === "created_by",
      ),
      false,
    );
  },
);

Deno.test(
  "executeAskIronTool summarize_day hard-caps each list arm to 10 rows",
  async () => {
    const { client, captures } = makeStubClient({
      moves: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    await executeAskIronTool(ctx, "summarize_day", { lookback_hours: 168 });
    const moveCaps = captures.filter((c) => c.table === "moves");
    assertEquals(moveCaps[0].limit, SUMMARIZE_DAY_MOVE_LIMIT);
    assertEquals(moveCaps[1].limit, SUMMARIZE_DAY_COMPLETED_LIMIT);
    const touchCap = captures.find((c) => c.table === "crm_activities");
    assertEquals(touchCap?.limit, SUMMARIZE_DAY_TOUCH_LIMIT);
    const sigCap = captures.find((c) => c.table === "signals");
    assertEquals(sigCap?.limit, SUMMARIZE_DAY_SIGNAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_day blocks elevated cross-workspace rep targeting",
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
    const res = await executeAskIronTool(ctx, "summarize_day", {
      rep_id: "rep-other",
    });
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("rep not in workspace"), true);
  },
);

Deno.test(
  "executeAskIronTool summarize_day truncates long rationale + body + description fields",
  async () => {
    const long = "z".repeat(500);
    const { client } = makeStubClient({
      moves: [
        {
          data: [
            {
              id: "m-1",
              kind: "call_now",
              status: "suggested",
              title: "t",
              rationale: long,
              priority: 70,
              entity_type: null,
              entity_id: null,
              assigned_rep_id: "rep-me",
              due_at: null,
              created_at: "2026-04-20T10:00:00Z",
            },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
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
      signals: {
        data: [
          {
            id: "s-1",
            kind: "other",
            severity: "high",
            source: "news",
            title: "t",
            description: long,
            entity_type: null,
            entity_id: null,
            occurred_at: "2026-04-20T10:00:00Z",
          },
        ],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep", userId: "rep-me" });
    const res = await executeAskIronTool(ctx, "summarize_day", {});
    const payload = res.data as {
      active_moves: Array<{ rationale: string | null }>;
      recent_touches: Array<{ body: string | null }>;
      open_signals: Array<{ description: string | null }>;
    };
    assertEquals(payload.active_moves[0].rationale!.endsWith("…"), true);
    assertEquals(payload.recent_touches[0].body!.endsWith("…"), true);
    assertEquals(payload.open_signals[0].description!.endsWith("…"), true);
  },
);

// ── normalizeSummarizeContactInput (Slice 16) ──────────────────────────────

Deno.test("normalizeSummarizeContactInput defaults lookback_days to the shared window", () => {
  const now = Date.parse("2026-04-20T12:00:00Z");
  const n = normalizeSummarizeContactInput({ contact_id: "c-1" }, now);
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
  assertEquals(n.sinceIso, new Date(now - 30 * 24 * 3_600_000).toISOString());
});

Deno.test("normalizeSummarizeContactInput clamps lookback above max", () => {
  const n = normalizeSummarizeContactInput(
    { contact_id: "c-1", lookback_days: 365 },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_MAX_DAYS);
});

Deno.test("normalizeSummarizeContactInput clamps lookback below 1", () => {
  const n = normalizeSummarizeContactInput(
    { contact_id: "c-1", lookback_days: 0 },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, 1);
});

Deno.test("normalizeSummarizeContactInput falls back to default when lookback is non-numeric", () => {
  const n = normalizeSummarizeContactInput(
    { contact_id: "c-1", lookback_days: "one week" },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeContactInput trims whitespace from contact_id", () => {
  const n = normalizeSummarizeContactInput(
    { contact_id: "  c-1  " },
    Date.parse("2026-04-20T12:00:00Z"),
  );
  assertEquals(n.contactId, "c-1");
});

Deno.test("normalizeSummarizeContactInput throws VALIDATION_ERROR when contact_id is missing", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeContactInput({});
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
  assertEquals(caught?.message.includes("contact_id"), true);
});

Deno.test("normalizeSummarizeContactInput throws when contact_id is whitespace-only", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeContactInput({ contact_id: "   " });
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
});

// ── executor: summarize_contact (Slice 16) ─────────────────────────────────

Deno.test(
  "executeAskIronTool summarize_contact returns found:false for missing/invisible contact",
  async () => {
    const { client } = makeStubClient({
      crm_contacts: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_contact", {
      contact_id: "ghost",
    });
    assertEquals(res.ok, true);
    const payload = res.data as { found: boolean; lookback_days: number };
    assertEquals(payload.found, false);
    assertEquals(payload.lookback_days, SUMMARIZE_DEAL_DEFAULT_DAYS);
  },
);

Deno.test(
  "executeAskIronTool summarize_contact short-circuits: no deal/activity/signal query when contact missing",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_contact", { contact_id: "ghost" });
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("crm_deals_rep_safe"), false);
    assertEquals(tables.includes("crm_activities"), false);
    assertEquals(tables.includes("signals"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_contact bundles contact + related deals + activities + signals in one call",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-1",
          first_name: "Jordan",
          last_name: "Reeves",
          email: "jordan@acme.test",
          phone: "555-0100",
          title: "Operations Manager",
          company_id: "co-1",
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
            body: "Left voicemail",
            occurred_at: "2026-04-19T15:00:00Z",
            created_by: "rep-me",
            deal_id: null,
            company_id: "co-1",
          },
        ],
        error: null,
      },
      signals: {
        data: [
          {
            id: "s-1",
            kind: "inbound_email",
            severity: "medium",
            source: "email",
            title: "Replied with timeline",
            description: "Will review quote by Friday",
            occurred_at: "2026-04-19T16:00:00Z",
          },
        ],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep", workspaceId: "ws-1" });
    const res = await executeAskIronTool(ctx, "summarize_contact", {
      contact_id: "c-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      contact: { id: string };
      related_deals: Array<{ id: string }>;
      recent_activities: Array<{ id: string }>;
      open_signals: Array<{ id: string }>;
      counts: { deals: number; activities: number; signals: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.contact.id, "c-1");
    assertEquals(payload.related_deals.length, 1);
    assertEquals(payload.recent_activities.length, 1);
    assertEquals(payload.open_signals.length, 1);
    assertEquals(payload.counts.deals, 1);
    assertEquals(payload.counts.activities, 1);
    assertEquals(payload.counts.signals, 1);

    // All four queries must carry the workspace filter.
    for (
      const table of [
        "crm_contacts",
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
  "executeAskIronTool summarize_contact skips the deal query when contact has no company",
  async () => {
    // A contact detached from any company (legacy import, lead form,
    // etc.) should still produce a useful brief — we just can't surface
    // related deals without a company to join through.
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-orphan",
          first_name: "Orphan",
          last_name: "Lead",
          email: null,
          phone: null,
          title: null,
          company_id: null,
          updated_at: "2026-04-19T12:00:00Z",
        },
        error: null,
      },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_contact", {
      contact_id: "c-orphan",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      related_deals: unknown[];
      counts: { deals: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.related_deals.length, 0);
    assertEquals(payload.counts.deals, 0);
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("crm_deals_rep_safe"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_contact filters activities to the exact contact_id with soft-delete guard",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-9",
          first_name: "A",
          last_name: "B",
          email: null,
          phone: null,
          title: null,
          company_id: "co-9",
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_contact", { contact_id: "c-9" });

    const activities = captures.find((c) => c.table === "crm_activities");
    if (!activities) throw new Error("no activity capture");
    const contactFilter = activities.filters.find(
      (f) => f.op === "eq" && f.column === "contact_id",
    );
    assertEquals(contactFilter?.value, "c-9");
    const soft = activities.filters.find(
      (f) => f.op === "is" && f.column === "deleted_at",
    );
    assertEquals(soft?.value, null);
  },
);

Deno.test(
  "executeAskIronTool summarize_contact filters signals to entity_type='contact' + entity_id",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-9",
          first_name: "A",
          last_name: "B",
          email: null,
          phone: null,
          title: null,
          company_id: "co-9",
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_contact", { contact_id: "c-9" });

    const signals = captures.find((c) => c.table === "signals");
    if (!signals) throw new Error("no signal capture");
    const typeFilter = signals.filters.find(
      (f) => f.op === "eq" && f.column === "entity_type",
    );
    assertEquals(typeFilter?.value, "contact");
    const idFilter = signals.filters.find(
      (f) => f.op === "eq" && f.column === "entity_id",
    );
    assertEquals(idFilter?.value, "c-9");
  },
);

Deno.test(
  "executeAskIronTool summarize_contact filters related deals by the contact's company_id",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-1",
          first_name: "A",
          last_name: "B",
          email: null,
          phone: null,
          title: null,
          company_id: "co-42",
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_contact", { contact_id: "c-1" });

    const deals = captures.find((c) => c.table === "crm_deals_rep_safe");
    if (!deals) throw new Error("no deal capture");
    const companyFilter = deals.filters.find(
      (f) => f.op === "eq" && f.column === "company_id",
    );
    assertEquals(companyFilter?.value, "co-42");
  },
);

Deno.test(
  "executeAskIronTool summarize_contact guards the contact read with deleted_at is null",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-9",
          first_name: "A",
          last_name: "B",
          email: null,
          phone: null,
          title: null,
          company_id: null,
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_contact", { contact_id: "c-9" });

    const contact = captures.find((c) => c.table === "crm_contacts");
    if (!contact) throw new Error("no contact capture");
    const soft = contact.filters.find(
      (f) => f.op === "is" && f.column === "deleted_at",
    );
    assertEquals(soft?.value, null);
  },
);

Deno.test(
  "executeAskIronTool summarize_contact hard-caps each list arm regardless of lookback",
  async () => {
    const { client, captures } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-1",
          first_name: "A",
          last_name: "B",
          email: null,
          phone: null,
          title: null,
          company_id: "co-1",
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      crm_deals_rep_safe: { data: [], error: null },
      crm_activities: { data: [], error: null },
      signals: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_contact", {
      contact_id: "c-1",
      lookback_days: 90,
    });

    const deals = captures.find((c) => c.table === "crm_deals_rep_safe");
    const activities = captures.find((c) => c.table === "crm_activities");
    const signals = captures.find((c) => c.table === "signals");
    assertEquals(deals?.limit, SUMMARIZE_CONTACT_DEAL_LIMIT);
    assertEquals(activities?.limit, SUMMARIZE_DEAL_ACTIVITY_LIMIT);
    assertEquals(signals?.limit, SUMMARIZE_DEAL_SIGNAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_contact truncates long activity bodies and signal descriptions",
  async () => {
    const longText = "y".repeat(SUMMARIZE_DEAL_TEXT_CAP + 500);
    const { client } = makeStubClient({
      crm_contacts: {
        data: {
          id: "c-1",
          first_name: "A",
          last_name: "B",
          email: null,
          phone: null,
          title: null,
          company_id: "co-1",
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
          company_id: "co-1",
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
    const res = await executeAskIronTool(ctx, "summarize_contact", {
      contact_id: "c-1",
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
  "executeAskIronTool summarize_contact returns VALIDATION_ERROR for missing contact_id",
  async () => {
    const { client } = makeStubClient({});
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_contact", {});
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("VALIDATION_ERROR"), true);
  },
);

// ── normalizeSummarizeSignalInput (Slice 20) ───────────────────────────────

Deno.test("normalizeSummarizeSignalInput defaults lookback_days to the shared window", () => {
  const now = new Date("2026-04-20T12:00:00Z").getTime();
  const n = normalizeSummarizeSignalInput({ signal_id: "s-1" }, now);
  assertEquals(n.signalId, "s-1");
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeSignalInput clamps lookback above max", () => {
  const n = normalizeSummarizeSignalInput(
    { signal_id: "s-1", lookback_days: 1000 },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_MAX_DAYS);
});

Deno.test("normalizeSummarizeSignalInput clamps lookback below 1", () => {
  const n = normalizeSummarizeSignalInput(
    { signal_id: "s-1", lookback_days: 0 },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, 1);
});

Deno.test("normalizeSummarizeSignalInput falls back to default when lookback is non-numeric", () => {
  const n = normalizeSummarizeSignalInput(
    { signal_id: "s-1", lookback_days: "nope" },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeSignalInput trims whitespace from signal_id", () => {
  const n = normalizeSummarizeSignalInput(
    { signal_id: "  s-1  " },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.signalId, "s-1");
});

Deno.test("normalizeSummarizeSignalInput throws VALIDATION_ERROR when signal_id is missing", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeSignalInput({});
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
  assertEquals(caught?.message.includes("signal_id"), true);
});

Deno.test("normalizeSummarizeSignalInput throws when signal_id is whitespace-only", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeSignalInput({ signal_id: "   " });
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
});

// ── executor: summarize_signal (Slice 20) ──────────────────────────────────

Deno.test(
  "executeAskIronTool summarize_signal returns found:false for unknown signal",
  async () => {
    const { client } = makeStubClient({
      signals: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "ghost",
    });
    assertEquals(res.ok, true);
    const payload = res.data as { found: boolean; lookback_days: number };
    assertEquals(payload.found, false);
    assertEquals(payload.lookback_days, SUMMARIZE_DEAL_DEFAULT_DAYS);
  },
);

Deno.test(
  "executeAskIronTool summarize_signal bundles signal + parent deal + related signals + moves",
  async () => {
    const { client, captures } = makeStubClient({
      signals: [
        // 1) target signal row (maybeSingle)
        {
          data: {
            id: "s-1",
            kind: "quote_viewed",
            severity: "high",
            source: "hubspot",
            title: "Acme viewed the quote again",
            description: "Viewed at 10:04am ET",
            entity_type: "deal",
            entity_id: "d-42",
            assigned_rep_id: null,
            occurred_at: "2026-04-20T10:04:00Z",
            suppressed_until: null,
          },
          error: null,
        },
        // 3) related signals list
        {
          data: [{
            id: "s-2",
            kind: "inbound_email",
            severity: "medium",
            source: "gmail",
            title: "Buyer replied",
            description: "Short reply",
            occurred_at: "2026-04-19T14:00:00Z",
          }],
          error: null,
        },
      ],
      crm_deals_rep_safe: {
        data: {
          id: "d-42",
          name: "Acme Materials — 12k excavator",
          amount: 140000,
          stage: "proposal",
          company_id: "co-7",
          assigned_rep_id: "user-1",
          updated_at: "2026-04-20T08:00:00Z",
        },
        error: null,
      },
      moves: {
        data: [{
          id: "m-1",
          kind: "call_now",
          status: "suggested",
          title: "Call Acme buyer back",
          priority: 74,
          entity_type: "deal",
          entity_id: "d-42",
          assigned_rep_id: "user-1",
          created_at: "2026-04-20T10:05:00Z",
          updated_at: "2026-04-20T10:05:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "s-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      signal: { id: string; entity_type: string | null; entity_id: string | null };
      parent_entity: { id: string; name: string } | null;
      related_signals: Array<{ id: string }>;
      related_moves: Array<{ id: string }>;
      counts: { related_signals: number; related_moves: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.signal.id, "s-1");
    assertEquals(payload.signal.entity_type, "deal");
    assertEquals(payload.parent_entity?.id, "d-42");
    assertEquals(payload.parent_entity?.name, "Acme Materials — 12k excavator");
    assertEquals(payload.related_signals[0].id, "s-2");
    assertEquals(payload.related_moves[0].id, "m-1");
    assertEquals(payload.counts.related_signals, 1);
    assertEquals(payload.counts.related_moves, 1);

    // Parent goes through the rep-safe view so the rep's visibility rules
    // carry through; the signal arm is workspace-scoped but does NOT rep-
    // filter (signals surface via Pulse regardless of rep assignment).
    const dealCapture = captures.find((c) => c.table === "crm_deals_rep_safe");
    assertEquals(dealCapture !== undefined, true);
    const filters = dealCapture!.filters;
    const ws = filters.find((f) => f.op === "eq" && f.column === "workspace_id");
    assertEquals(ws?.value, "ws-1");
    const id = filters.find((f) => f.op === "eq" && f.column === "id");
    assertEquals(id?.value, "d-42");

    // Moves arm uses .contains on signal_ids with the target signal id.
    const moveCapture = captures.find((c) => c.table === "moves");
    assertEquals(moveCapture !== undefined, true);
    const moveFilters = moveCapture!.filters;
    const containsFilter = moveFilters.find((f) => f.op === "contains");
    assertEquals(containsFilter?.column, "signal_ids");
    assertEquals(containsFilter?.value, ["s-1"]);
    assertEquals(moveCapture!.limit, SUMMARIZE_SIGNAL_RELATED_MOVE_LIMIT);

    // Related-signals arm excludes the target signal id via .neq.
    // Two signals queries were captured (target row + related list); the
    // second one is the list.
    const signalCaptures = captures.filter((c) => c.table === "signals");
    assertEquals(signalCaptures.length, 2);
    const relatedFilters = signalCaptures[1].filters;
    const neqFilter = relatedFilters.find((f) => f.op === "neq");
    assertEquals(neqFilter?.column, "id");
    assertEquals(neqFilter?.value, "s-1");
    assertEquals(
      signalCaptures[1].limit,
      SUMMARIZE_SIGNAL_RELATED_SIGNAL_LIMIT,
    );
  },
);

Deno.test(
  "executeAskIronTool summarize_signal loads a company parent when the signal is tied to a company",
  async () => {
    const { client, captures } = makeStubClient({
      signals: [
        {
          data: {
            id: "s-9",
            kind: "news_mention",
            severity: "low",
            source: "news",
            title: "Acme in the news",
            description: null,
            entity_type: "company",
            entity_id: "co-7",
            assigned_rep_id: null,
            occurred_at: "2026-04-20T12:00:00Z",
            suppressed_until: null,
          },
          error: null,
        },
        { data: [], error: null },
      ],
      crm_companies: {
        data: {
          id: "co-7",
          name: "Acme Materials",
          city: "Boise",
          state: "ID",
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      moves: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "s-9",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      parent_entity: { id: string; name: string } | null;
    };
    assertEquals(payload.parent_entity?.id, "co-7");
    assertEquals(payload.parent_entity?.name, "Acme Materials");
    const companyCapture = captures.find((c) => c.table === "crm_companies");
    assertEquals(companyCapture !== undefined, true);
  },
);

Deno.test(
  "executeAskIronTool summarize_signal loads a contact parent when the signal is tied to a contact",
  async () => {
    const { client, captures } = makeStubClient({
      signals: [
        {
          data: {
            id: "s-11",
            kind: "inbound_email",
            severity: "medium",
            source: "gmail",
            title: "Jane replied",
            description: null,
            entity_type: "contact",
            entity_id: "c-1",
            assigned_rep_id: null,
            occurred_at: "2026-04-20T12:00:00Z",
            suppressed_until: null,
          },
          error: null,
        },
        { data: [], error: null },
      ],
      crm_contacts: {
        data: {
          id: "c-1",
          first_name: "Jane",
          last_name: "Doe",
          email: "jane@acme.com",
          phone: null,
          title: "Fleet manager",
          company_id: "co-7",
          updated_at: "2026-04-20T12:00:00Z",
        },
        error: null,
      },
      moves: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "s-11",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      parent_entity: { id: string; first_name: string } | null;
    };
    assertEquals(payload.parent_entity?.id, "c-1");
    assertEquals(payload.parent_entity?.first_name, "Jane");
    const contactCapture = captures.find((c) => c.table === "crm_contacts");
    assertEquals(contactCapture !== undefined, true);
  },
);

Deno.test(
  "executeAskIronTool summarize_signal returns null parent for equipment signals",
  async () => {
    const { client, captures } = makeStubClient({
      signals: [
        {
          data: {
            id: "s-21",
            kind: "telematics_fault",
            severity: "high",
            source: "telematics",
            title: "Fault 4017 on CAT 320 #42",
            description: null,
            entity_type: "equipment",
            entity_id: "eq-42",
            assigned_rep_id: null,
            occurred_at: "2026-04-20T12:00:00Z",
            suppressed_until: null,
          },
          error: null,
        },
        { data: [], error: null },
      ],
      moves: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "s-21",
    });
    const payload = res.data as { parent_entity: unknown };
    assertEquals(payload.parent_entity, null);
    // No deal/company/contact table should have been touched when the
    // signal is equipment-scoped (there's no synthesizer-backed parent).
    const parentTables = captures
      .map((c) => c.table)
      .filter((t) =>
        t === "crm_deals_rep_safe" || t === "crm_companies" ||
        t === "crm_contacts"
      );
    assertEquals(parentTables.length, 0);
  },
);

Deno.test(
  "executeAskIronTool summarize_signal returns null parent + skips related-signals when signal has no entity scope",
  async () => {
    const { client, captures } = makeStubClient({
      // No related-signals second call needed — executor short-circuits
      // when entity_type / entity_id are null on the target signal.
      signals: {
        data: {
          id: "s-99",
          kind: "news_mention",
          severity: "low",
          source: "news",
          title: "Industry note",
          description: null,
          entity_type: null,
          entity_id: null,
          assigned_rep_id: null,
          occurred_at: "2026-04-20T12:00:00Z",
          suppressed_until: null,
        },
        error: null,
      },
      moves: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "s-99",
    });
    const payload = res.data as {
      parent_entity: unknown;
      related_signals: unknown[];
    };
    assertEquals(payload.parent_entity, null);
    assertEquals(payload.related_signals.length, 0);
    // Only ONE signals query should have fired (the target row). The
    // related-signals list is guarded by entity scope, so no second call.
    const signalCaptures = captures.filter((c) => c.table === "signals");
    assertEquals(signalCaptures.length, 1);
  },
);

Deno.test(
  "executeAskIronTool summarize_signal truncates long descriptions in payload",
  async () => {
    const longText = "x".repeat(400);
    const { client } = makeStubClient({
      signals: [
        {
          data: {
            id: "s-1",
            kind: "news_mention",
            severity: "low",
            source: "news",
            title: "t",
            description: longText,
            entity_type: "deal",
            entity_id: "d-1",
            assigned_rep_id: null,
            occurred_at: "2026-04-20T12:00:00Z",
            suppressed_until: null,
          },
          error: null,
        },
        {
          data: [{
            id: "s-2",
            kind: "inbound_email",
            severity: "low",
            source: "gmail",
            title: "t",
            description: longText,
            occurred_at: "2026-04-19T12:00:00Z",
          }],
          error: null,
        },
      ],
      crm_deals_rep_safe: { data: { id: "d-1", name: "n" }, error: null },
      moves: { data: [], error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {
      signal_id: "s-1",
    });
    const payload = res.data as {
      signal: { description: string | null };
      related_signals: Array<{ description: string | null }>;
    };
    assertEquals(
      payload.signal.description!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
    assertEquals(payload.signal.description!.endsWith("…"), true);
    assertEquals(
      payload.related_signals[0].description!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
  },
);

Deno.test(
  "executeAskIronTool summarize_signal returns VALIDATION_ERROR for missing signal_id",
  async () => {
    const { client } = makeStubClient({});
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_signal", {});
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("VALIDATION_ERROR"), true);
  },
);

// ── normalizeSummarizeEquipmentInput (Slice 23) ────────────────────────────

Deno.test("normalizeSummarizeEquipmentInput defaults lookback_days to the shared window", () => {
  const now = new Date("2026-04-20T12:00:00Z").getTime();
  const n = normalizeSummarizeEquipmentInput({ equipment_id: "e-1" }, now);
  assertEquals(n.equipmentId, "e-1");
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeEquipmentInput clamps lookback above max", () => {
  const n = normalizeSummarizeEquipmentInput(
    { equipment_id: "e-1", lookback_days: 1000 },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_MAX_DAYS);
});

Deno.test("normalizeSummarizeEquipmentInput clamps lookback below 1", () => {
  const n = normalizeSummarizeEquipmentInput(
    { equipment_id: "e-1", lookback_days: 0 },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, 1);
});

Deno.test("normalizeSummarizeEquipmentInput falls back to default when lookback is non-numeric", () => {
  const n = normalizeSummarizeEquipmentInput(
    { equipment_id: "e-1", lookback_days: "nope" },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeEquipmentInput trims whitespace from equipment_id", () => {
  const n = normalizeSummarizeEquipmentInput(
    { equipment_id: "  e-1  " },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.equipmentId, "e-1");
});

Deno.test("normalizeSummarizeEquipmentInput throws VALIDATION_ERROR when equipment_id is missing", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeEquipmentInput({});
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
  assertEquals(caught?.message.includes("equipment_id"), true);
});

Deno.test("normalizeSummarizeEquipmentInput throws when equipment_id is whitespace-only", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeEquipmentInput({ equipment_id: "   " });
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
});

// ── executor: summarize_equipment (Slice 23) ───────────────────────────────

Deno.test(
  "executeAskIronTool summarize_equipment returns found:false for unknown equipment",
  async () => {
    const { client } = makeStubClient({
      crm_equipment: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_equipment", {
      equipment_id: "ghost",
    });
    assertEquals(res.ok, true);
    const payload = res.data as { found: boolean; lookback_days: number };
    assertEquals(payload.found, false);
    assertEquals(payload.lookback_days, SUMMARIZE_DEAL_DEFAULT_DAYS);
  },
);

Deno.test(
  "executeAskIronTool summarize_equipment short-circuits rental/touch/signal reads when equipment missing",
  async () => {
    const { client, captures } = makeStubClient({
      crm_equipment: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_equipment", {
      equipment_id: "ghost",
    });
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("crm_equipment"), true);
    assertEquals(tables.includes("rental_contracts"), false);
    assertEquals(tables.includes("touches"), false);
    assertEquals(tables.includes("signals"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_equipment bundles equipment + rentals + touches + signals",
  async () => {
    const { client, captures } = makeStubClient({
      crm_equipment: {
        data: {
          id: "e-1",
          name: "CAT 320 Excavator",
          asset_tag: "EX-042",
          serial_number: "CAT320-99887",
          company_id: "co-7",
          primary_contact_id: "c-3",
          updated_at: "2026-04-20T08:00:00Z",
        },
        error: null,
      },
      rental_contracts: {
        data: [{
          id: "rc-1",
          status: "active",
          request_type: "standard",
          requested_start_date: "2026-04-10",
          requested_end_date: "2026-05-10",
          approved_start_date: "2026-04-10",
          approved_end_date: "2026-05-10",
          portal_customer_id: "pc-1",
          branch_id: "b-1",
          delivery_mode: "dealer",
          updated_at: "2026-04-20T09:00:00Z",
        }],
        error: null,
      },
      touches: {
        data: [{
          id: "t-1",
          channel: "visit",
          direction: "outbound",
          summary: "Walked the machine",
          body: "Hydraulic lines look tight.",
          occurred_at: "2026-04-19T15:00:00Z",
          actor_user_id: "user-1",
          activity_id: null,
        }],
        error: null,
      },
      signals: {
        data: [{
          id: "s-1",
          kind: "telematics_fault",
          severity: "high",
          source: "telematics",
          title: "Fault code E-042",
          description: "Hydraulic pressure low",
          occurred_at: "2026-04-20T06:00:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_equipment", {
      equipment_id: "e-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      equipment: { id: string; name: string };
      open_rentals: Array<{ id: string }>;
      recent_touches: Array<{ id: string }>;
      open_signals: Array<{ id: string }>;
      counts: { open_rentals: number; touches: number; signals: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.equipment.id, "e-1");
    assertEquals(payload.open_rentals[0].id, "rc-1");
    assertEquals(payload.recent_touches[0].id, "t-1");
    assertEquals(payload.open_signals[0].id, "s-1");
    assertEquals(payload.counts.open_rentals, 1);
    assertEquals(payload.counts.touches, 1);
    assertEquals(payload.counts.signals, 1);

    // Rental arm: equipment_id filter + non-terminal status filter + limit.
    const rentalCapture = captures.find((c) => c.table === "rental_contracts");
    assertEquals(rentalCapture !== undefined, true);
    const eqFilter = rentalCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "equipment_id",
    );
    assertEquals(eqFilter?.value, "e-1");
    const statusFilter = rentalCapture!.filters.find((f) => f.op === "in");
    assertEquals(statusFilter?.column, "status");
    assertEquals(
      statusFilter?.value,
      SUMMARIZE_EQUIPMENT_OPEN_RENTAL_STATUSES,
    );
    assertEquals(rentalCapture!.limit, SUMMARIZE_EQUIPMENT_RENTAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_equipment scopes touches to the equipment_id with soft-delete-free reads",
  async () => {
    const { client, captures } = makeStubClient({
      crm_equipment: {
        data: {
          id: "e-9",
          name: "Skid Steer",
          asset_tag: "SS-01",
          serial_number: null,
          company_id: null,
          primary_contact_id: null,
          updated_at: "2026-04-20T08:00:00Z",
        },
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_equipment", {
      equipment_id: "e-9",
    });
    const touchCapture = captures.find((c) => c.table === "touches");
    assertEquals(touchCapture !== undefined, true);
    const eqFilter = touchCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "equipment_id",
    );
    assertEquals(eqFilter?.value, "e-9");
    assertEquals(touchCapture!.limit, SUMMARIZE_EQUIPMENT_TOUCH_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_equipment scopes signals to entity_type='equipment' + entity_id",
  async () => {
    const { client, captures } = makeStubClient({
      crm_equipment: {
        data: {
          id: "e-9",
          name: "Skid Steer",
          asset_tag: "SS-01",
          serial_number: null,
          company_id: null,
          primary_contact_id: null,
          updated_at: "2026-04-20T08:00:00Z",
        },
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_equipment", {
      equipment_id: "e-9",
    });
    const signalCapture = captures.find((c) => c.table === "signals");
    assertEquals(signalCapture !== undefined, true);
    const typeFilter = signalCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "entity_type",
    );
    assertEquals(typeFilter?.value, "equipment");
    const idFilter = signalCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "entity_id",
    );
    assertEquals(idFilter?.value, "e-9");
    assertEquals(signalCapture!.limit, SUMMARIZE_EQUIPMENT_SIGNAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_equipment truncates long touch bodies and signal descriptions",
  async () => {
    const longBody = "x".repeat(SUMMARIZE_DEAL_TEXT_CAP + 200);
    const longDesc = "y".repeat(SUMMARIZE_DEAL_TEXT_CAP + 200);
    const { client } = makeStubClient({
      crm_equipment: {
        data: {
          id: "e-1",
          name: "CAT 320",
          asset_tag: "EX-042",
          serial_number: null,
          company_id: null,
          primary_contact_id: null,
          updated_at: "2026-04-20T08:00:00Z",
        },
        error: null,
      },
      touches: {
        data: [{
          id: "t-1",
          channel: "note",
          direction: "outbound",
          summary: "Long note",
          body: longBody,
          occurred_at: "2026-04-19T15:00:00Z",
          actor_user_id: "user-1",
          activity_id: null,
        }],
        error: null,
      },
      signals: {
        data: [{
          id: "s-1",
          kind: "telematics_fault",
          severity: "medium",
          source: "telematics",
          title: "Long",
          description: longDesc,
          occurred_at: "2026-04-20T06:00:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_equipment", {
      equipment_id: "e-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      recent_touches: Array<{ body: string | null }>;
      open_signals: Array<{ description: string | null }>;
    };
    assertEquals(
      payload.recent_touches[0].body!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
    assertEquals(payload.recent_touches[0].body!.endsWith("…"), true);
    assertEquals(
      payload.open_signals[0].description!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
    assertEquals(payload.open_signals[0].description!.endsWith("…"), true);
  },
);

Deno.test(
  "executeAskIronTool summarize_equipment returns VALIDATION_ERROR for missing equipment_id",
  async () => {
    const { client } = makeStubClient({});
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_equipment", {});
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("VALIDATION_ERROR"), true);
  },
);

// ── normalizeSummarizeRentalInput (Slice 26) ───────────────────────────────

Deno.test("normalizeSummarizeRentalInput defaults lookback_days to the shared window", () => {
  const now = new Date("2026-04-20T12:00:00Z").getTime();
  const n = normalizeSummarizeRentalInput({ rental_id: "r-1" }, now);
  assertEquals(n.rentalId, "r-1");
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeRentalInput clamps lookback above max", () => {
  const n = normalizeSummarizeRentalInput(
    { rental_id: "r-1", lookback_days: 1000 },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_MAX_DAYS);
});

Deno.test("normalizeSummarizeRentalInput clamps lookback below 1", () => {
  const n = normalizeSummarizeRentalInput(
    { rental_id: "r-1", lookback_days: 0 },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, 1);
});

Deno.test("normalizeSummarizeRentalInput falls back to default when lookback is non-numeric", () => {
  const n = normalizeSummarizeRentalInput(
    { rental_id: "r-1", lookback_days: "nope" },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.lookbackDays, SUMMARIZE_DEAL_DEFAULT_DAYS);
});

Deno.test("normalizeSummarizeRentalInput trims whitespace from rental_id", () => {
  const n = normalizeSummarizeRentalInput(
    { rental_id: "  r-1  " },
    new Date("2026-04-20T12:00:00Z").getTime(),
  );
  assertEquals(n.rentalId, "r-1");
});

Deno.test("normalizeSummarizeRentalInput throws VALIDATION_ERROR when rental_id is missing", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeRentalInput({});
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
  assertEquals(caught?.message.includes("rental_id"), true);
});

Deno.test("normalizeSummarizeRentalInput throws when rental_id is whitespace-only", () => {
  let caught: Error | null = null;
  try {
    normalizeSummarizeRentalInput({ rental_id: "   " });
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("VALIDATION_ERROR"), true);
});

// ── executor: summarize_rental (Slice 26) ──────────────────────────────────

Deno.test(
  "executeAskIronTool summarize_rental returns found:false for unknown rental",
  async () => {
    const { client } = makeStubClient({
      rental_contracts: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_rental", {
      rental_id: "ghost",
    });
    assertEquals(res.ok, true);
    const payload = res.data as { found: boolean; lookback_days: number };
    assertEquals(payload.found, false);
    assertEquals(payload.lookback_days, SUMMARIZE_DEAL_DEFAULT_DAYS);
  },
);

Deno.test(
  "executeAskIronTool summarize_rental short-circuits extensions/equipment/signals when rental missing",
  async () => {
    const { client, captures } = makeStubClient({
      rental_contracts: { data: null, error: null },
    });
    const ctx = makeCtx(client, { role: "rep" });
    await executeAskIronTool(ctx, "summarize_rental", {
      rental_id: "ghost",
    });
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("rental_contracts"), true);
    assertEquals(tables.includes("rental_contract_extensions"), false);
    assertEquals(tables.includes("crm_equipment"), false);
    assertEquals(tables.includes("signals"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_rental bundles rental + extensions + equipment + signals",
  async () => {
    const { client, captures } = makeStubClient({
      rental_contracts: {
        data: {
          id: "rc-1",
          status: "active",
          request_type: "booking",
          portal_customer_id: "pc-1",
          equipment_id: "e-1",
          branch_id: "b-1",
          requested_category: null,
          requested_make: null,
          requested_model: null,
          delivery_mode: "delivery",
          delivery_location: "123 Yard Rd",
          requested_start_date: "2026-04-10",
          requested_end_date: "2026-05-10",
          approved_start_date: "2026-04-10",
          approved_end_date: "2026-05-10",
          estimate_daily_rate: null,
          estimate_weekly_rate: null,
          estimate_monthly_rate: null,
          agreed_daily_rate: 450,
          agreed_weekly_rate: null,
          agreed_monthly_rate: null,
          deposit_required: true,
          deposit_amount: 2000,
          deposit_status: "paid",
          customer_notes: null,
          dealer_notes: null,
          dealer_response: null,
          updated_at: "2026-04-20T09:00:00Z",
        },
        error: null,
      },
      rental_contract_extensions: {
        data: [{
          id: "ext-1",
          status: "submitted",
          requested_end_date: "2026-05-24",
          approved_end_date: null,
          customer_reason: "Job running long",
          dealer_response: null,
          additional_charge: null,
          payment_status: null,
          created_at: "2026-04-18T08:00:00Z",
          updated_at: "2026-04-18T08:00:00Z",
        }],
        error: null,
      },
      crm_equipment: {
        data: {
          id: "e-1",
          name: "CAT 320",
          asset_tag: "EX-042",
          serial_number: "CAT320-99887",
          company_id: "co-7",
          primary_contact_id: "c-3",
        },
        error: null,
      },
      signals: {
        data: [{
          id: "s-1",
          kind: "sla_breach",
          severity: "high",
          source: "rentals",
          title: "Extension overdue for review",
          description: "Submitted 2 days ago",
          occurred_at: "2026-04-20T06:00:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_rental", {
      rental_id: "rc-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      found: boolean;
      rental: { id: string };
      extensions: Array<{ id: string }>;
      equipment: { id: string; name: string | null } | null;
      open_signals: Array<{ id: string }>;
      counts: { extensions: number; signals: number };
    };
    assertEquals(payload.found, true);
    assertEquals(payload.rental.id, "rc-1");
    assertEquals(payload.extensions[0].id, "ext-1");
    assertEquals(payload.equipment?.id, "e-1");
    assertEquals(payload.open_signals[0].id, "s-1");
    assertEquals(payload.counts.extensions, 1);
    assertEquals(payload.counts.signals, 1);

    // Extensions arm scopes by rental_contract_id.
    const extCapture = captures.find(
      (c) => c.table === "rental_contract_extensions",
    );
    assertEquals(extCapture !== undefined, true);
    const rcFilter = extCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "rental_contract_id",
    );
    assertEquals(rcFilter?.value, "rc-1");

    // Signals arm scopes by entity_type='rental' + entity_id.
    const signalCapture = captures.find((c) => c.table === "signals");
    assertEquals(signalCapture !== undefined, true);
    const typeFilter = signalCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "entity_type",
    );
    assertEquals(typeFilter?.value, "rental");
    const idFilter = signalCapture!.filters.find(
      (f) => f.op === "eq" && f.column === "entity_id",
    );
    assertEquals(idFilter?.value, "rc-1");
    assertEquals(signalCapture!.limit, SUMMARIZE_RENTAL_SIGNAL_LIMIT);
  },
);

Deno.test(
  "executeAskIronTool summarize_rental returns null equipment for category bookings",
  async () => {
    // A rental with no equipment_id (still in triage) should skip the
    // equipment read entirely and return equipment: null.
    const { client, captures } = makeStubClient({
      rental_contracts: {
        data: {
          id: "rc-9",
          status: "submitted",
          request_type: "booking",
          portal_customer_id: "pc-1",
          equipment_id: null,
          branch_id: null,
          requested_category: "excavator",
          requested_make: "CAT",
          requested_model: "320",
          delivery_mode: "pickup",
          delivery_location: null,
          requested_start_date: "2026-05-01",
          requested_end_date: "2026-05-15",
          approved_start_date: null,
          approved_end_date: null,
          estimate_daily_rate: null,
          estimate_weekly_rate: null,
          estimate_monthly_rate: null,
          agreed_daily_rate: null,
          agreed_weekly_rate: null,
          agreed_monthly_rate: null,
          deposit_required: false,
          deposit_amount: null,
          deposit_status: null,
          customer_notes: "Need for spring dig",
          dealer_notes: null,
          dealer_response: null,
          updated_at: "2026-04-20T09:00:00Z",
        },
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_rental", {
      rental_id: "rc-9",
    });
    assertEquals(res.ok, true);
    const payload = res.data as { found: boolean; equipment: unknown };
    assertEquals(payload.found, true);
    assertEquals(payload.equipment, null);
    // Equipment read must NOT happen when equipment_id is null.
    const tables = captures.map((c) => c.table);
    assertEquals(tables.includes("crm_equipment"), false);
  },
);

Deno.test(
  "executeAskIronTool summarize_rental truncates long signal descriptions",
  async () => {
    const longDesc = "z".repeat(SUMMARIZE_DEAL_TEXT_CAP + 200);
    const { client } = makeStubClient({
      rental_contracts: {
        data: {
          id: "rc-1",
          status: "active",
          request_type: "booking",
          portal_customer_id: "pc-1",
          equipment_id: null,
          branch_id: null,
          requested_category: null,
          requested_make: null,
          requested_model: null,
          delivery_mode: "pickup",
          delivery_location: null,
          requested_start_date: "2026-04-10",
          requested_end_date: "2026-05-10",
          approved_start_date: null,
          approved_end_date: null,
          estimate_daily_rate: null,
          estimate_weekly_rate: null,
          estimate_monthly_rate: null,
          agreed_daily_rate: null,
          agreed_weekly_rate: null,
          agreed_monthly_rate: null,
          deposit_required: false,
          deposit_amount: null,
          deposit_status: null,
          customer_notes: null,
          dealer_notes: null,
          dealer_response: null,
          updated_at: "2026-04-20T09:00:00Z",
        },
        error: null,
      },
      signals: {
        data: [{
          id: "s-1",
          kind: "sla_warning",
          severity: "medium",
          source: "rentals",
          title: "Long",
          description: longDesc,
          occurred_at: "2026-04-20T06:00:00Z",
        }],
        error: null,
      },
    });
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_rental", {
      rental_id: "rc-1",
    });
    assertEquals(res.ok, true);
    const payload = res.data as {
      open_signals: Array<{ description: string | null }>;
    };
    assertEquals(
      payload.open_signals[0].description!.length <= SUMMARIZE_DEAL_TEXT_CAP,
      true,
    );
    assertEquals(payload.open_signals[0].description!.endsWith("…"), true);
  },
);

Deno.test(
  "executeAskIronTool summarize_rental returns VALIDATION_ERROR for missing rental_id",
  async () => {
    const { client } = makeStubClient({});
    const ctx = makeCtx(client, { role: "rep" });
    const res = await executeAskIronTool(ctx, "summarize_rental", {});
    assertEquals(res.ok, false);
    assertEquals(res.error?.includes("VALIDATION_ERROR"), true);
  },
);

