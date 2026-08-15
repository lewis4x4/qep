import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleHandoffTrustScorer,
  resolveHandoffTrustScorerScope,
  type HandoffTrustScorerDependencies,
  type UnscoredHandoff,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "service-role-handoff-trust-test";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = {
  table: string;
  column: string;
  value: unknown;
  op: "eq" | "is" | "gte" | "lt";
};

const UNSCORED_BY_WORKSPACE: Record<string, UnscoredHandoff[]> = {
  [WORKSPACE_A]: [{
    id: "handoff-a1",
    workspace_id: WORKSPACE_A,
    subject_type: "deal",
    subject_id: "deal-a1",
    from_user_id: "user-from-a",
    to_user_id: "user-to-a",
    handoff_at: "2026-04-10T10:00:00.000Z",
  }],
  [WORKSPACE_B]: [{
    id: "handoff-b1",
    workspace_id: WORKSPACE_B,
    subject_type: "deal",
    subject_id: "deal-b1",
    from_user_id: "user-from-b",
    to_user_id: "user-to-b",
    handoff_at: "2026-04-10T11:00:00.000Z",
  }],
};

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "update" = "select";
  private selectColumns = "";
  private updateValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(columns: string): this {
    this.selectColumns = columns;
    this.operation = "select";
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.updateValues = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter: Filter = { table: this.table, column, value, op: "eq" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  is(column: string, value: unknown): this {
    const filter: Filter = { table: this.table, column, value, op: "is" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  gte(column: string, value: unknown): this {
    const filter: Filter = { table: this.table, column, value, op: "gte" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  lt(column: string, value: unknown): this {
    const filter: Filter = { table: this.table, column, value, op: "lt" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  maybeSingle(): this {
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
      selectColumns: this.selectColumns,
      updateValues: this.updateValues,
    });
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  readonly filters: Filter[] = [];
  readonly updates: Array<{ table: string; filters: Filter[]; values: Record<string, unknown> }> = [];
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  fromCallCount = 0;

  from(table: string): QueryBuilder {
    this.fromCallCount += 1;
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  }

  resolve(
    table: string,
    operation: "select" | "update",
    params: {
      filters: Filter[];
      selectColumns: string;
      updateValues: Record<string, unknown> | null;
    },
  ): unknown {
    if (operation === "update" && params.updateValues) {
      this.updates.push({
        table,
        filters: [...params.filters],
        values: params.updateValues,
      });
      return null;
    }

    const workspaceFilter = params.filters.find((filter) =>
      filter.column === "workspace_id" && filter.op === "eq"
    )?.value;

    if (table === "handoff_events") {
      const columns = params.selectColumns.split(",").map((part) => part.trim());
      const selectsWorkspaceOnly = columns.includes("workspace_id") &&
        !columns.includes("id");

      if (selectsWorkspaceOnly) {
        const rows = Object.entries(UNSCORED_BY_WORKSPACE).flatMap(([workspaceId]) => [{
          workspace_id: workspaceId,
        }]);
        return workspaceFilter
          ? rows.filter((row) => row.workspace_id === workspaceFilter)
          : rows;
      }

      const rows = Object.values(UNSCORED_BY_WORKSPACE).flat();
      const filtered = workspaceFilter
        ? rows.filter((row) => row.workspace_id === workspaceFilter)
        : rows;
      return filtered;
    }

    if (table === "crm_activities") {
      return [];
    }

    if (table === "qrm_stage_transitions") {
      return [];
    }

    if (table === "crm_deals") {
      return { stage_id: "stage-1", closed_at: null };
    }

    if (table === "crm_deal_stages") {
      return { is_closed_won: false, is_closed_lost: false };
    }

    return [];
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "manager-a",
    role: "manager",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
): Partial<HandoffTrustScorerDependencies> {
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
  return new Request("https://example.test/functions/v1/handoff-trust-scorer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer user-token",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function tableFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) => filter.table === table);
}

function handoffWorkspaceFilters(client: MockAdminClient): Filter[] {
  return tableFilters(client, "handoff_events").filter((filter) =>
    filter.column === "workspace_id" && filter.op === "eq"
  );
}

function activityWorkspaceFilters(client: MockAdminClient): Filter[] {
  return tableFilters(client, "crm_activities").filter((filter) =>
    filter.column === "workspace_id" && filter.op === "eq"
  );
}

Deno.test("resolveHandoffTrustScorerScope binds JWT callers to their workspace", () => {
  const jwtScope = resolveHandoffTrustScorerScope({
    caller: callerContext(),
    isServiceRole: false,
    requestedWorkspaceId: WORKSPACE_B,
  });
  assertEquals(jwtScope, {
    ok: true,
    scope: { mode: "workspace", workspaceId: WORKSPACE_A },
  });

  const missingWorkspace = resolveHandoffTrustScorerScope({
    caller: callerContext({ workspaceId: null }),
    isServiceRole: false,
    requestedWorkspaceId: WORKSPACE_B,
  });
  assertEquals(missingWorkspace, {
    ok: false,
    status: 403,
    message: "The authenticated user has no active workspace",
  });

  const serviceAll = resolveHandoffTrustScorerScope({
    caller: callerContext({ isServiceRole: true }),
    isServiceRole: true,
    requestedWorkspaceId: null,
  });
  assertEquals(serviceAll, { ok: true, scope: { mode: "all" } });
});

Deno.test("JWT manager shop A only scores shop A handoffs and seam RPC", async () => {
  const client = new MockAdminClient();
  const response = await handleHandoffTrustScorer(
    request(),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    handoffWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(
    activityWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(
    client.updates.every((update) =>
      update.filters.some((filter) =>
        filter.column === "workspace_id" && filter.value === WORKSPACE_A
      )
    ),
    true,
  );
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0]?.args.p_workspace_id, WORKSPACE_A);
  assertEquals(body.scored, 1);
});

Deno.test("JWT forged body.workspace still scores shop A only", async () => {
  const client = new MockAdminClient();
  const response = await handleHandoffTrustScorer(
    request({ workspace: WORKSPACE_B, workspace_id: WORKSPACE_B }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    handoffWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(client.rpcCalls.every((call) => call.args.p_workspace_id === WORKSPACE_A), true);
});

Deno.test("JWT with no active workspace returns 403 and performs no table access", async () => {
  const client = new MockAdminClient();
  const response = await handleHandoffTrustScorer(
    request(),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(
    await response.json(),
    { error: "The authenticated user has no active workspace" },
  );
  assertEquals(client.fromCallCount, 0);
  assertEquals(client.filters.length, 0);
  assertEquals(client.updates.length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("service-role without hint stays unscoped for cron contract", async () => {
  const client = new MockAdminClient();
  const response = await handleHandoffTrustScorer(
    request({}, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "all" });
  assertEquals(handoffWorkspaceFilters(client).length, 0);
  assertEquals(activityWorkspaceFilters(client).length, 0);
  assertEquals(
    client.updates.every((update) =>
      !update.filters.some((filter) => filter.column === "workspace_id")
    ),
    true,
  );
  assertEquals(client.rpcCalls.length, 2);
  assertEquals(
    new Set(client.rpcCalls.map((call) => call.args.p_workspace_id)),
    new Set([WORKSPACE_A, WORKSPACE_B]),
  );
  assertEquals(body.scored, 2);
});

Deno.test("service-role may scope to an explicit workspace hint", async () => {
  const client = new MockAdminClient();
  const response = await handleHandoffTrustScorer(
    request(
      { workspace_id: WORKSPACE_B },
      { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    ),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_B });
  assertEquals(
    handoffWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_B),
    true,
  );
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0]?.args.p_workspace_id, WORKSPACE_B);
  assertEquals(body.scored, 1);
});

if (originalServiceRoleKey === undefined) {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
} else {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
}
