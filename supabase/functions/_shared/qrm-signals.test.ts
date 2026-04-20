import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ingestSignal,
  listSignals,
  listSignalsByIds,
  parseSignalListFilters,
  validateSignalPayload,
} from "./qrm-signals.ts";
import type { RouterCtx } from "./crm-router-service.ts";

// Supabase query-builder stub — same shape as qrm-moves.test.ts. `maybeSingle`
// resolves to the captured result so the dedupe-lookup path in ingestSignal
// can be exercised.
interface StubResult {
  data: unknown;
  // Using Error so that assertRejects() recognizes re-thrown Supabase-style
  // errors. Real PostgREST errors carry .message; Error satisfies that.
  error: Error | null;
}

interface StubCapture {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
  insert?: Record<string, unknown>;
  orderColumn?: string;
  limit?: number;
}

function makeStubClient(
  results: Record<string, StubResult | StubResult[]>,
): {
  client: SupabaseClient;
  captures: StubCapture[];
} {
  const captures: StubCapture[] = [];
  // Allow a table to return a sequence of results across successive `from()`
  // calls — ingestSignal may hit the same table twice (lookup then insert).
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
      order: (column: string) => {
        capture.orderColumn = column;
        return builder;
      },
      limit: (n: number) => {
        capture.limit = n;
        return Promise.resolve(result);
      },
      single: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      insert: (payload: Record<string, unknown>) => {
        capture.insert = payload;
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
  callerDb: SupabaseClient,
  opts: {
    admin?: SupabaseClient;
    role?: "rep" | "manager" | "admin" | "owner";
    isServiceRole?: boolean;
    userId?: string | null;
    workspaceId?: string;
  } = {},
): RouterCtx {
  return {
    admin: opts.admin ?? callerDb,
    callerDb,
    caller: {
      authHeader: "Bearer token",
      userId: opts.userId ?? "user-1",
      role: opts.role ?? "rep",
      isServiceRole: opts.isServiceRole ?? false,
      workspaceId: opts.workspaceId ?? "ws-1",
    },
    workspaceId: opts.workspaceId ?? "ws-1",
    requestId: "req-signals",
    route: "/qrm/signals",
    method: "GET",
    ipInet: null,
    userAgent: null,
  };
}

// ---------------------------------------------------------------------------
// validateSignalPayload
// ---------------------------------------------------------------------------

Deno.test("validateSignalPayload rejects missing kind", () => {
  const bad = { source: "gmail", title: "hi" } as unknown as Parameters<
    typeof validateSignalPayload
  >[0];
  try {
    validateSignalPayload(bad);
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:kind");
  }
});

Deno.test("validateSignalPayload rejects unknown kind", () => {
  try {
    validateSignalPayload({
      kind: "bogus" as "inbound_email",
      source: "gmail",
      title: "hi",
    });
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:kind");
  }
});

Deno.test("validateSignalPayload rejects empty source", () => {
  try {
    validateSignalPayload({ kind: "inbound_email", source: "", title: "hi" });
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:source");
  }
});

Deno.test("validateSignalPayload rejects empty title", () => {
  try {
    validateSignalPayload({ kind: "inbound_email", source: "gmail", title: "" });
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:title");
  }
});

Deno.test("validateSignalPayload rejects unknown severity", () => {
  try {
    validateSignalPayload({
      kind: "inbound_email",
      source: "gmail",
      title: "hi",
      severity: "extreme" as "high",
    });
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:severity");
  }
});

Deno.test("validateSignalPayload rejects invalid occurredAt", () => {
  try {
    validateSignalPayload({
      kind: "inbound_email",
      source: "gmail",
      title: "hi",
      occurredAt: "not-a-date",
    });
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals((err as Error).message, "VALIDATION_ERROR:occurredAt");
  }
});

Deno.test("validateSignalPayload accepts a minimal valid payload", () => {
  // No throw means pass.
  validateSignalPayload({
    kind: "inbound_email",
    source: "gmail",
    title: "Acme replied",
  });
});

// ---------------------------------------------------------------------------
// parseSignalListFilters
// ---------------------------------------------------------------------------

Deno.test("parseSignalListFilters returns empty defaults when no params", () => {
  const filters = parseSignalListFilters(new URLSearchParams());
  assertEquals(filters.kinds, []);
  assertEquals(filters.severityAtLeast, null);
  assertEquals(filters.entityType, null);
  assertEquals(filters.entityId, null);
  assertEquals(filters.assignedRepId, null);
  assertEquals(filters.since, null);
  assertEquals(filters.limit, 50);
});

Deno.test("parseSignalListFilters parses comma-separated kinds", () => {
  const filters = parseSignalListFilters(
    new URLSearchParams("kind=inbound_email,telematics_fault,news_mention"),
  );
  assertEquals(filters.kinds.sort(), [
    "inbound_email",
    "news_mention",
    "telematics_fault",
  ]);
});

Deno.test("parseSignalListFilters drops unknown kinds silently", () => {
  const filters = parseSignalListFilters(
    new URLSearchParams("kind=inbound_email,made_up"),
  );
  assertEquals(filters.kinds, ["inbound_email"]);
});

Deno.test("parseSignalListFilters caps limit at 200 and floors at 1", () => {
  assertEquals(
    parseSignalListFilters(new URLSearchParams("limit=9999")).limit,
    200,
  );
  assertEquals(
    parseSignalListFilters(new URLSearchParams("limit=0")).limit,
    1,
  );
});

Deno.test("parseSignalListFilters accepts severity_at_least", () => {
  const filters = parseSignalListFilters(
    new URLSearchParams("severity_at_least=high"),
  );
  assertEquals(filters.severityAtLeast, "high");
});

Deno.test("parseSignalListFilters rejects unknown severity_at_least", () => {
  const filters = parseSignalListFilters(
    new URLSearchParams("severity_at_least=extreme"),
  );
  assertEquals(filters.severityAtLeast, null);
});

Deno.test("parseSignalListFilters nulls an invalid since timestamp", () => {
  const filters = parseSignalListFilters(
    new URLSearchParams("since=not-a-date"),
  );
  assertEquals(filters.since, null);
});

Deno.test("parseSignalListFilters keeps a valid ISO since", () => {
  const filters = parseSignalListFilters(
    new URLSearchParams("since=2026-04-20T00:00:00Z"),
  );
  assertEquals(filters.since, "2026-04-20T00:00:00Z");
});

// ---------------------------------------------------------------------------
// listSignals
// ---------------------------------------------------------------------------

Deno.test("listSignals filters by workspace and orders by occurred_at desc", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });

  await listSignals(ctx, parseSignalListFilters(new URLSearchParams()));

  const q = captures.find((c) => c.table === "signals");
  if (!q) throw new Error("signals query not captured");
  const ws = q.filters.find((f) => f.column === "workspace_id");
  assertEquals(ws?.value, "ws-1");
  assertEquals(q.orderColumn, "occurred_at");
  assertEquals(q.limit, 50);
});

Deno.test("listSignals expands severity_at_least to severity IN list", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "manager" });

  await listSignals(
    ctx,
    parseSignalListFilters(new URLSearchParams("severity_at_least=high")),
  );

  const q = captures.find((c) => c.table === "signals");
  if (!q) throw new Error("signals query not captured");
  const sev = q.filters.find((f) => f.op === "in" && f.column === "severity");
  const allowed = (sev?.value as string[]).sort();
  assertEquals(allowed, ["critical", "high"]);
});

Deno.test("listSignals applies kinds/entity/since filters when provided", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "admin" });

  await listSignals(
    ctx,
    parseSignalListFilters(
      new URLSearchParams(
        "kind=inbound_email,news_mention&entity_type=deal&entity_id=d-1&since=2026-04-19T00:00:00Z",
      ),
    ),
  );

  const q = captures.find((c) => c.table === "signals");
  if (!q) throw new Error("signals query not captured");
  const kinds = q.filters.find((f) => f.op === "in" && f.column === "kind");
  assertEquals(
    (kinds?.value as string[]).sort(),
    ["inbound_email", "news_mention"],
  );
  const et = q.filters.find((f) => f.op === "eq" && f.column === "entity_type");
  assertEquals(et?.value, "deal");
  const eid = q.filters.find((f) => f.op === "eq" && f.column === "entity_id");
  assertEquals(eid?.value, "d-1");
  const since = q.filters.find((f) => f.op === "gte" && f.column === "occurred_at");
  assertEquals(since?.value, "2026-04-19T00:00:00Z");
});

// ---------------------------------------------------------------------------
// ingestSignal
// ---------------------------------------------------------------------------

Deno.test("ingestSignal returns existing row when dedupe_key matches", async () => {
  const existing = { id: "s-existing", dedupe_key: "evt-1" };
  const { client, captures } = makeStubClient({
    signals: { data: existing, error: null },
  });
  const ctx = makeCtx(client, { role: "admin" });

  const result = await ingestSignal(ctx, {
    kind: "inbound_email",
    source: "gmail",
    title: "Acme replied",
    dedupeKey: "evt-1",
  });

  assertEquals((result as { id: string }).id, "s-existing");
  // Only the dedupe lookup should have fired; no insert should have been
  // captured.
  assertEquals(
    captures.filter((c) => c.insert !== undefined).length,
    0,
  );
});

Deno.test("ingestSignal inserts when no dedupe_key match exists", async () => {
  const { client, captures } = makeStubClient({
    // Sequence: 1st lookup returns null, 2nd call is the insert/select.
    signals: [
      { data: null, error: null },
      { data: { id: "s-new", kind: "inbound_email" }, error: null },
    ],
  });
  const ctx = makeCtx(client, { role: "admin" });

  const result = await ingestSignal(ctx, {
    kind: "inbound_email",
    source: "gmail",
    title: "Acme replied",
    dedupeKey: "evt-2",
    description: "Matt asked about the 305",
  });

  assertEquals((result as { id: string }).id, "s-new");

  const insertCap = captures.find((c) => c.insert !== undefined);
  if (!insertCap) throw new Error("insert not captured");
  const payload = insertCap.insert!;
  assertEquals(payload.workspace_id, "ws-1");
  assertEquals(payload.kind, "inbound_email");
  // Default severity is medium when not supplied.
  assertEquals(payload.severity, "medium");
  assertEquals(payload.source, "gmail");
  assertEquals(payload.title, "Acme replied");
  assertEquals(payload.description, "Matt asked about the 305");
  assertEquals(payload.dedupe_key, "evt-2");
  // occurred_at should be stamped to now() ISO, not undefined.
  assertEquals(typeof payload.occurred_at, "string");
});

Deno.test("ingestSignal inserts without dedupe lookup when no dedupeKey provided", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: { id: "s-blind", kind: "news_mention" }, error: null },
  });
  const ctx = makeCtx(client, { role: "admin" });

  await ingestSignal(ctx, {
    kind: "news_mention",
    source: "tavily",
    title: "Acme cranes expands into Tulsa",
    severity: "medium",
  });

  // Only the insert call should appear — no preliminary eq("dedupe_key", ...).
  const dedupeLookup = captures.find((c) =>
    c.filters.some((f) => f.column === "dedupe_key")
  );
  assertEquals(dedupeLookup, undefined);

  const insertCap = captures.find((c) => c.insert !== undefined);
  if (!insertCap) throw new Error("insert not captured");
  assertEquals(insertCap.insert!.kind, "news_mention");
});

Deno.test("ingestSignal honors workspaceId override for service-role bulk writes", async () => {
  const { client, captures } = makeStubClient({
    signals: [
      { data: null, error: null },
      { data: { id: "s-override" }, error: null },
    ],
  });
  // Caller ctx workspace is ws-1, but the news-scan loops workspaces and passes
  // a different one per ingest call.
  const ctx = makeCtx(client, {
    role: "admin",
    isServiceRole: true,
    workspaceId: "ws-1",
  });

  await ingestSignal(ctx, {
    kind: "news_mention",
    source: "tavily",
    title: "Competitor moved",
    dedupeKey: "tavily:acme:2026-04-20",
    workspaceId: "ws-other",
  });

  const insertCap = captures.find((c) => c.insert !== undefined);
  if (!insertCap) throw new Error("insert not captured");
  assertEquals(insertCap.insert!.workspace_id, "ws-other");

  // The dedupe lookup should also use the override, not the ctx workspace.
  const lookup = captures.find(
    (c) => c.table === "signals" && c.filters.some((f) => f.column === "dedupe_key"),
  );
  const ws = lookup?.filters.find((f) => f.column === "workspace_id");
  assertEquals(ws?.value, "ws-other");
});

Deno.test("ingestSignal falls back to existing row on unique-constraint race", async () => {
  const raced = { id: "s-raced", dedupe_key: "evt-race" };
  // Real PostgrestErrors carry SQLSTATE `.code`; "23505" is unique_violation.
  // Our handler matches on the code (not the message text) so this test
  // drives the canonical path.
  const uniqueViolation = new Error("duplicate key value violates unique constraint");
  (uniqueViolation as { code?: string }).code = "23505";

  const { client, captures } = makeStubClient({
    signals: [
      // First lookup: not found (pre-insert race window).
      { data: null, error: null },
      // Insert fails with a 23505 unique-key error.
      { data: null, error: uniqueViolation },
      // Post-error fallback lookup: the racing sibling is now there.
      { data: raced, error: null },
    ],
  });
  const ctx = makeCtx(client, { role: "admin" });

  const result = await ingestSignal(ctx, {
    kind: "inbound_email",
    source: "gmail",
    title: "Duplicate webhook",
    dedupeKey: "evt-race",
  });

  assertEquals((result as { id: string }).id, "s-raced");
  // Should have done at least three from("signals") calls: lookup, insert, fallback.
  assertEquals(captures.length >= 3, true);
});

Deno.test("ingestSignal rethrows 23505 when no dedupeKey was supplied", async () => {
  // Defensive: even with a 23505 code, the fallback lookup requires a
  // dedupeKey. Without one we can't identify the racing sibling, so we must
  // bubble the error up rather than silently degrading to an arbitrary row.
  const uniqueViolation = new Error("duplicate key value violates unique constraint");
  (uniqueViolation as { code?: string }).code = "23505";

  const { client } = makeStubClient({
    signals: { data: null, error: uniqueViolation },
  });
  const ctx = makeCtx(client, { role: "admin" });

  await assertRejects(
    () =>
      ingestSignal(ctx, {
        kind: "inbound_email",
        source: "gmail",
        title: "No dedupe key",
      }),
    Error,
    "duplicate key",
  );
});

Deno.test("ingestSignal throws on non-dedupe insert errors", async () => {
  const { client } = makeStubClient({
    signals: [
      { data: null, error: null }, // lookup miss
      { data: null, error: new Error("permission denied for relation signals") },
    ],
  });
  const ctx = makeCtx(client, { role: "admin" });

  await assertRejects(
    () =>
      ingestSignal(ctx, {
        kind: "inbound_email",
        source: "gmail",
        title: "hi",
        dedupeKey: "evt-err",
      }),
    Error,
    "permission denied",
  );
});

Deno.test("ingestSignal validates the payload before touching the DB", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: null, error: null },
  });
  const ctx = makeCtx(client, { role: "admin" });

  await assertRejects(
    () =>
      ingestSignal(ctx, {
        kind: "inbound_email",
        source: "",
        title: "hi",
      }),
    Error,
    "VALIDATION_ERROR:source",
  );

  // No DB calls should have fired.
  assertEquals(captures.length, 0);
});

// ---------------------------------------------------------------------------
// listSignalsByIds (Slice 5 — "Triggered by" panel)
// ---------------------------------------------------------------------------

Deno.test("listSignalsByIds returns empty without touching DB when ids is empty", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });

  const rows = await listSignalsByIds(ctx, []);
  assertEquals(rows, []);
  assertEquals(captures.length, 0);
});

Deno.test("listSignalsByIds scopes to workspace and uses IN on id", async () => {
  const { client, captures } = makeStubClient({
    signals: {
      data: [{ id: "sig-a" }, { id: "sig-b" }],
      error: null,
    },
  });
  const ctx = makeCtx(client, { role: "rep" });

  const rows = await listSignalsByIds(ctx, ["sig-a", "sig-b"]);
  assertEquals(rows.length, 2);

  const q = captures.find((c) => c.table === "signals");
  if (!q) throw new Error("signals query not captured");
  const ws = q.filters.find((f) => f.column === "workspace_id");
  assertEquals(ws?.value, "ws-1");
  const inFilter = q.filters.find((f) => f.op === "in" && f.column === "id");
  assertEquals((inFilter?.value as string[]).sort(), ["sig-a", "sig-b"]);
});

Deno.test("listSignalsByIds caps the id list at 20", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });

  const ids = Array.from({ length: 50 }, (_, i) => `sig-${i}`);
  await listSignalsByIds(ctx, ids);

  const q = captures.find((c) => c.table === "signals");
  const inFilter = q?.filters.find((f) => f.op === "in" && f.column === "id");
  assertEquals((inFilter?.value as string[]).length, 20);
});

Deno.test("listSignalsByIds drops empty/non-string ids before capping", async () => {
  const { client, captures } = makeStubClient({
    signals: { data: [], error: null },
  });
  const ctx = makeCtx(client, { role: "rep" });

  // The cast keeps the test honest: router passes already-string ids, but
  // a malformed caller shouldn't blow up the query.
  await listSignalsByIds(ctx, ["", "sig-real", "", "sig-also-real"]);

  const q = captures.find((c) => c.table === "signals");
  const inFilter = q?.filters.find((f) => f.op === "in" && f.column === "id");
  assertEquals((inFilter?.value as string[]).sort(), ["sig-also-real", "sig-real"]);
});
