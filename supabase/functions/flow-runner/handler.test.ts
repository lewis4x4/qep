import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  handleFlowRunner,
  resolveFlowRunnerWorkspaceScope,
  runFlowRunnerTick,
  type FlowRunnerAuthResult,
  type FlowRunnerDependencies,
  type FlowRunnerWorkspaceScope,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORGED_WORKSPACE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_KEY = "service-role-flow-runner-test";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = {
  table: string;
  column: string;
  value: unknown;
  op: "eq" | "or";
  select?: string;
};

const PENDING_EVENTS = [
  {
    event_id: "event-a1",
    flow_event_type: "quote.expired",
    source_module: "quotes",
    workspace_id: WORKSPACE_A,
    entity_type: "quote",
    entity_id: "quote-a1",
    occurred_at: "2026-08-15T12:00:00.000Z",
    properties: {},
    correlation_id: null,
    parent_event_id: null,
    consumed_by_runs: [],
  },
  {
    event_id: "event-b1",
    flow_event_type: "quote.expired",
    source_module: "quotes",
    workspace_id: WORKSPACE_B,
    entity_type: "quote",
    entity_id: "quote-b1",
    occurred_at: "2026-08-15T12:01:00.000Z",
    properties: {},
    correlation_id: null,
    parent_event_id: null,
    consumed_by_runs: [],
  },
];

const WORKFLOW_DEF = {
  id: "def-1",
  slug: "quote-expiring-soon",
  name: "Quote expiring soon",
  owner_role: "sales",
  trigger_event_pattern: "quote.expired",
  condition_dsl: [],
  action_chain: [],
  retry_policy: {},
  dry_run: true,
  enabled: true,
  affects_modules: [],
};

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private selectColumns = "";
  private operation: "select" | "insert" | "update" = "select";
  private insertValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(columns: string): this {
    this.selectColumns = columns;
    this.operation = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter: Filter = {
      table: this.table,
      column,
      value,
      op: "eq",
      select: this.selectColumns,
    };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  or(expression: string): this {
    const filter: Filter = {
      table: this.table,
      column: "or",
      value: expression,
      op: "or",
      select: this.selectColumns,
    };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_value: number): this {
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  update(_values: Record<string, unknown>): this {
    this.operation = "update";
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "insert" && this.insertValues) {
      this.owner.inserts.push({ table: this.table, row: this.insertValues });
      if (this.table === "flow_workflow_runs") {
        return Promise.resolve({ data: { id: "run-1" }, error: null }).then(onfulfilled, onrejected);
      }
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }

    if (this.operation === "update") {
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }

    let data: unknown;
    if (this.table === "flow_pending_events") {
      const workspaceFilter = this.filters.find((f) => f.column === "workspace_id" && f.op === "eq");
      data = typeof workspaceFilter?.value === "string"
        ? PENDING_EVENTS.filter((event) => event.workspace_id === workspaceFilter.value)
        : PENDING_EVENTS;
    } else if (this.table === "flow_workflow_definitions") {
      data = [WORKFLOW_DEF];
    } else {
      data = [];
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: null, error: null });
  }
}

function pendingEventFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === "flow_pending_events" && filter.column === "workspace_id" && filter.op === "eq"
  );
}

function flowTableAccess(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === "flow_pending_events" ||
    filter.table === "flow_workflow_runs" ||
    filter.table === "flow_workflow_run_steps" ||
    filter.table === "analytics_action_log" ||
    filter.table === "flow_action_idempotency"
  );
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/flow-runner", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dependencies(
  client: MockAdminClient,
  auth: FlowRunnerAuthResult,
): Partial<FlowRunnerDependencies> {
  return {
    createAdminClient: (() => client) as never,
    authenticateFlowRunner: (async () => auth) as never,
    runFlowRunnerTick: (async (
      admin: SupabaseClient,
      workspaceScope: FlowRunnerWorkspaceScope,
    ) => runFlowRunnerTick(admin, workspaceScope)) as never,
  };
}

Deno.test("resolveFlowRunnerWorkspaceScope binds JWT callers to active workspace", () => {
  assertEquals(
    resolveFlowRunnerWorkspaceScope({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveFlowRunnerWorkspaceScope({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolveFlowRunnerWorkspaceScope defaults service-role to unscoped without hint", () => {
  assertEquals(
    resolveFlowRunnerWorkspaceScope({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("JWT owner only processes shop A pending events and writes workspace A", async () => {
  const client = new MockAdminClient();
  const auth: FlowRunnerAuthResult = {
    ok: true,
    isServiceRole: false,
    userId: "owner-a",
    role: "owner",
    workspaceId: WORKSPACE_A,
  };

  const response = await handleFlowRunner(request(), dependencies(client, auth));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, WORKSPACE_A);
  assertEquals(pendingEventFilters(client).length, 1);
  assertEquals(pendingEventFilters(client)[0].value, WORKSPACE_A);
  assertEquals(body.events_processed, 1);
  assertEquals(
    client.inserts.filter((insert) => insert.table === "flow_workflow_runs").every(
      (insert) => insert.row.workspace_id === WORKSPACE_A,
    ),
    true,
  );
  assertEquals(
    client.inserts.some((insert) => insert.row.workspace_id === WORKSPACE_B),
    false,
  );
});

Deno.test("JWT forged body.workspace still processes shop A only", async () => {
  const client = new MockAdminClient();
  const auth: FlowRunnerAuthResult = {
    ok: true,
    isServiceRole: false,
    userId: "owner-a",
    role: "owner",
    workspaceId: WORKSPACE_A,
  };

  const response = await handleFlowRunner(
    request({ workspace: FORGED_WORKSPACE, workspace_id: WORKSPACE_B }),
    dependencies(client, auth),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_id, WORKSPACE_A);
  assertEquals(pendingEventFilters(client)[0].value, WORKSPACE_A);
  assertEquals(body.events_processed, 1);
});

Deno.test("JWT missing active workspace returns 403 without flow table access", async () => {
  const client = new MockAdminClient();
  const response = await handleFlowRunner(
    request({ workspace: FORGED_WORKSPACE }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "owner-a",
      role: "owner",
      workspaceId: "",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(flowTableAccess(client).length, 0);
  assertEquals(client.inserts.length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("service-role without hint polls all pending events (cron contract)", async () => {
  const client = new MockAdminClient();
  const response = await handleFlowRunner(
    request({}, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "unscoped");
  assertEquals(body.workspace_id, null);
  assertEquals(pendingEventFilters(client).length, 0);
  assertEquals(body.events_processed, 2);
});

Deno.test("service-role with workspace hint only processes that shop", async () => {
  const client = new MockAdminClient();
  const response = await handleFlowRunner(
    request({ workspace_id: WORKSPACE_A }, {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-workspace-id": WORKSPACE_A,
    }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: WORKSPACE_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, WORKSPACE_A);
  assertEquals(pendingEventFilters(client).length, 1);
  assertEquals(pendingEventFilters(client)[0].value, WORKSPACE_A);
  assertEquals(body.events_processed, 1);
});

Deno.test({
  name: "flow-runner handler env cleanup",
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
