import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  filterCandidatesToScope,
  handleRecommendMoves,
  resolveRecommendMovesScope,
  type RecommendMovesDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_recommend_moves_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown };

const SIGNALS = [
  {
    id: "signal-a",
    workspace_id: WORKSPACE_A,
    kind: "sla_breach",
    severity: "critical",
    source: "test",
    title: "SLA breach A",
    description: null,
    entity_type: "deal",
    entity_id: "deal-a",
    assigned_rep_id: "rep-a",
    occurred_at: "2026-08-14T12:00:00.000Z",
    suppressed_until: null,
    payload: {},
  },
  {
    id: "signal-b",
    workspace_id: WORKSPACE_B,
    kind: "sla_breach",
    severity: "critical",
    source: "test",
    title: "SLA breach B",
    description: null,
    entity_type: "deal",
    entity_id: "deal-b",
    assigned_rep_id: "rep-b",
    occurred_at: "2026-08-14T12:00:00.000Z",
    suppressed_until: null,
    payload: {},
  },
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "insert" = "select";
  private limitCount: number | null = null;
  private insertValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  is(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  in(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  gte(_column: string, _value: unknown): this {
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.owner.resolve(this.table, this.operation, {
      filters: this.filters,
      limit: this.limitCount,
      insertValues: this.insertValues,
    });
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  resolve(
    table: string,
    operation: "select" | "insert",
    params: {
      filters: Filter[];
      limit: number | null;
      insertValues: Record<string, unknown> | null;
    },
  ): unknown {
    if (operation === "insert" && params.insertValues) {
      this.inserts.push({ table, payload: params.insertValues });
      return null;
    }

    if (table === "signals") {
      const workspace = params.filters.find((filter) => filter.column === "workspace_id")?.value;
      const rows = workspace
        ? SIGNALS.filter((signal) => signal.workspace_id === workspace)
        : SIGNALS;
      return rows.slice(0, params.limit ?? rows.length);
    }

    if (table === "moves") {
      return [];
    }

    return [];
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-1",
    role: "owner",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
): Partial<RecommendMovesDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    isServiceRoleCaller: ((req: Request) =>
      req.headers.get("authorization") === `Bearer ${SERVICE_ROLE_KEY}`) as never,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/recommend-moves", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function signalWorkspaceFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === "signals" && filter.column === "workspace_id"
  );
}

Deno.test("resolveRecommendMovesScope binds JWT callers to active workspace", () => {
  assertEquals(
    resolveRecommendMovesScope({
      caller: callerContext(),
      isServiceRole: false,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_A } },
  );
  assertEquals(
    resolveRecommendMovesScope({
      caller: callerContext({ workspaceId: null }),
      isServiceRole: false,
      requestedWorkspaceId: null,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("resolveRecommendMovesScope keeps service-role unscoped without hints", () => {
  assertEquals(
    resolveRecommendMovesScope({
      caller: callerContext({ isServiceRole: true }),
      isServiceRole: true,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "all" } },
  );
  assertEquals(
    resolveRecommendMovesScope({
      caller: callerContext({ isServiceRole: true }),
      isServiceRole: true,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_B } },
  );
});

Deno.test("filterCandidatesToScope blocks cross-shop move inserts", () => {
  const candidates = [
    { workspaceId: WORKSPACE_A, ruleId: "a" },
    { workspaceId: WORKSPACE_B, ruleId: "b" },
  ];
  assertEquals(
    filterCandidatesToScope(candidates, { mode: "workspace", workspaceId: WORKSPACE_A }).length,
    1,
  );
  assertEquals(filterCandidatesToScope(candidates, { mode: "all" }).length, 2);
});

Deno.test("JWT forged workspace in body is ignored and scopes signals to caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request({ workspace: WORKSPACE_B }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    signalWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(body.signalsScanned, 1);
  assertEquals(client.inserts.length, 1);
  assertEquals(client.inserts[0]?.payload.workspace_id, WORKSPACE_A);
});

Deno.test("JWT omit workspace still scopes signals to caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request(),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(
    signalWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(body.signalsScanned, 1);
  assertEquals(client.inserts.every((insert) => insert.payload.workspace_id === WORKSPACE_A), true);
});

Deno.test("JWT missing active workspace returns 403 before signals query", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request(),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(signalWorkspaceFilters(client).length, 0);
  assertEquals(client.inserts.length, 0);
});

Deno.test("JWT wrong role returns 403 before signals query", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request(),
    dependencies(client, callerContext({ role: "rep" })),
  );

  assertEquals(response.status, 403);
  assertEquals(signalWorkspaceFilters(client).length, 0);
  assertEquals(client.inserts.length, 0);
});

Deno.test("service-role cron scan stays unscoped", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request({}, { authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "all" });
  assertEquals(signalWorkspaceFilters(client).length, 0);
  assertEquals(body.signalsScanned, 2);
  assertEquals(client.inserts.length, 2);
});

Deno.test("service-role with workspace hint scopes signals and inserts", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request({ workspace: WORKSPACE_B }, { authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_B });
  assertEquals(
    signalWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_B),
    true,
  );
  assertEquals(body.signalsScanned, 1);
  assertEquals(client.inserts.length, 1);
  assertEquals(client.inserts[0]?.payload.workspace_id, WORKSPACE_B);
});

Deno.test("service-role x-workspace-id header scopes the sweep", async () => {
  const client = new MockAdminClient();
  const response = await handleRecommendMoves(
    request({}, {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "x-workspace-id": WORKSPACE_B,
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_B });
  assertEquals(
    signalWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_B),
    true,
  );
});

Deno.test({
  name: "recommend-moves handler env cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    if (originalServiceRoleKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
    }
  },
});
