import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import {
  evaluateThreshold,
  handleAnalyticsAlertEvaluator,
  resolveAlertEvaluatorScope,
  type AnalyticsAlertEvaluatorDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_analytics_alert_evaluator_test_only";
const INTERNAL_SECRET = "internal-secret-analytics-alert-evaluator";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
Deno.env.set("INTERNAL_SERVICE_SECRET", INTERNAL_SECRET);

type Filter = { table: string; column: string; value: unknown };

const METRIC_DEFS = [
  {
    metric_key: "parts_fill_rate",
    label: "Parts Fill Rate",
    owner_role: "owner",
    threshold_config: { warn_below: 90, critical_below: 80 },
  },
];

const SNAPSHOTS = [
  {
    workspace_id: WORKSPACE_A,
    metric_key: "parts_fill_rate",
    metric_value: 75,
    calculated_at: "2026-08-15T00:00:00.000Z",
    metadata: {},
    refresh_state: "fresh",
  },
  {
    workspace_id: WORKSPACE_B,
    metric_key: "parts_fill_rate",
    metric_value: 70,
    calculated_at: "2026-08-15T00:00:00.000Z",
    metadata: {},
    refresh_state: "fresh",
  },
];

const OPEN_ALERTS = [
  {
    id: "alert-a",
    workspace_id: WORKSPACE_A,
    metric_key: "parts_fill_rate",
    status: "new",
  },
  {
    id: "alert-b",
    workspace_id: WORKSPACE_B,
    metric_key: "parts_fill_rate",
    status: "new",
  },
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "update" | "insert" = "select";
  private updateValues: Record<string, unknown> | null = null;
  private insertValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
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

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.updateValues = values;
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  #workspaceFilter(): string | undefined {
    const filter = this.filters.find((entry) => entry.column === "workspace_id");
    return typeof filter?.value === "string" ? filter.value : undefined;
  }

  #rows(): unknown {
    const workspace = this.#workspaceFilter();

    if (this.table === "analytics_metric_definitions") {
      return METRIC_DEFS;
    }

    if (this.table === "analytics_kpi_snapshots") {
      return workspace
        ? SNAPSHOTS.filter((row) => row.workspace_id === workspace)
        : SNAPSHOTS;
    }

    if (this.table === "analytics_alerts") {
      const rows = workspace
        ? OPEN_ALERTS.filter((row) => row.workspace_id === workspace)
        : OPEN_ALERTS;
      if (this.operation === "update") {
        this.owner.updates.push({
          table: this.table,
          filters: [...this.filters],
          payload: this.updateValues ?? {},
        });
        return null;
      }
      return rows;
    }

    if (this.table === "service_cron_runs" && this.operation === "insert") {
      this.owner.inserts.push({
        table: this.table,
        payload: this.insertValues ?? {},
      });
      return null;
    }

    return [];
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.#rows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  updates: Array<{
    table: string;
    filters: Filter[];
    payload: Record<string, unknown>;
  }> = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return Promise.resolve({ data: "alert-id", error: null });
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
  isServiceRole = caller.isServiceRole,
): Partial<AnalyticsAlertEvaluatorDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    isServiceRoleCaller: ((req: Request) => {
      const auth = req.headers.get("authorization") ?? "";
      const internal = req.headers.get("x-internal-service-secret") ?? "";
      return auth === `Bearer ${SERVICE_ROLE_KEY}` ||
        internal === INTERNAL_SECRET;
    }) as never,
  };
}

function tableFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) => filter.table === table);
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return tableFilters(client, table).filter((filter) =>
    filter.column === "workspace_id"
  );
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/analytics-alert-evaluator", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("resolveAlertEvaluatorScope binds JWT callers to active workspace", () => {
  assertEquals(
    resolveAlertEvaluatorScope({
      caller: callerContext(),
      isServiceRole: false,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_A } },
  );
  assertEquals(
    resolveAlertEvaluatorScope({
      caller: callerContext(),
      isServiceRole: false,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_A } },
  );
});

Deno.test("resolveAlertEvaluatorScope rejects JWT callers without active workspace", () => {
  assertEquals(
    resolveAlertEvaluatorScope({
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

Deno.test("resolveAlertEvaluatorScope keeps service cron unscoped without workspace hint", () => {
  assertEquals(
    resolveAlertEvaluatorScope({
      caller: callerContext({
        isServiceRole: true,
        workspaceId: null,
        role: null,
        userId: null,
      }),
      isServiceRole: true,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "all" } },
  );
});

Deno.test("resolveAlertEvaluatorScope scopes service callers with explicit workspace hint", () => {
  assertEquals(
    resolveAlertEvaluatorScope({
      caller: callerContext({
        isServiceRole: true,
        workspaceId: null,
        role: null,
        userId: null,
      }),
      isServiceRole: true,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_B } },
  );
  assertEquals(
    resolveAlertEvaluatorScope({
      caller: callerContext({
        isServiceRole: true,
        workspaceId: WORKSPACE_B,
        role: null,
        userId: null,
      }),
      isServiceRole: true,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_B } },
  );
});

Deno.test("resolveAlertEvaluatorScope rejects conflicting service workspace hints", () => {
  assertEquals(
    resolveAlertEvaluatorScope({
      caller: callerContext({
        isServiceRole: true,
        workspaceId: WORKSPACE_A,
        role: null,
        userId: null,
      }),
      isServiceRole: true,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    },
  );
});

Deno.test("evaluateThreshold returns warn and critical severities", () => {
  assertEquals(
    evaluateThreshold(85, { warn_below: 90, critical_below: 80 }).severity,
    "warn",
  );
  assertEquals(
    evaluateThreshold(75, { warn_below: 90, critical_below: 80 }).severity,
    "critical",
  );
  assertEquals(
    evaluateThreshold(95, { warn_below: 90, critical_below: 80 }).severity,
    null,
  );
  assertEquals(evaluateThreshold(null, { warn_below: 90 }).severity, null);
});

Deno.test("JWT owner without forged workspace scopes snapshots alerts and enqueue to workspace A", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    workspaceFilters(client, "analytics_alerts").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0]?.args.p_workspace_id, WORKSPACE_A);
});

Deno.test("JWT owner forged workspace in body is ignored", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({ workspace: WORKSPACE_B }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    client.rpcCalls.every((call) => call.args.p_workspace_id === WORKSPACE_A),
    true,
  );
});

Deno.test("JWT missing active workspace returns 403 before table access", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(tableFilters(client, "analytics_kpi_snapshots").length, 0);
  assertEquals(tableFilters(client, "analytics_alerts").length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("JWT non-owner returns 403 before table access", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}),
    dependencies(client, callerContext({ role: "manager" })),
  );

  assertEquals(response.status, 403);
  assertEquals(tableFilters(client, "analytics_kpi_snapshots").length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("invalid JWT authentication returns 401 before table access", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}),
    dependencies(
      client,
      callerContext({
        authHeader: null,
        userId: null,
        role: null,
        workspaceId: null,
      }),
    ),
  );

  assertEquals(response.status, 401);
  assertEquals(tableFilters(client, "analytics_kpi_snapshots").length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("internal-secret cron path stays unscoped across shops", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}, { "x-internal-service-secret": INTERNAL_SECRET }),
    dependencies(
      client,
      callerContext({
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
      true,
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "all" });
  assertEquals(workspaceFilters(client, "analytics_kpi_snapshots").length, 0);
  assertEquals(workspaceFilters(client, "analytics_alerts").length, 0);
  assertEquals(client.rpcCalls.length, 2);
  assertEquals(
    client.rpcCalls.map((call) => call.args.p_workspace_id).sort(),
    [WORKSPACE_A, WORKSPACE_B].sort(),
  );
});

Deno.test("service-role explicit workspace hint scopes snapshots alerts and enqueue", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request(
      { workspace_id: WORKSPACE_B },
      { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    ),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
      true,
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_B });
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").every((filter) =>
      filter.value === WORKSPACE_B
    ),
    true,
  );
  assertEquals(
    workspaceFilters(client, "analytics_alerts").every((filter) =>
      filter.value === WORKSPACE_B
    ),
    true,
  );
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0]?.args.p_workspace_id, WORKSPACE_B);
});

Deno.test("service-role x-workspace-id header scopes evaluation", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}, {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "x-workspace-id": WORKSPACE_B,
    }),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: WORKSPACE_B,
      }),
      true,
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_B });
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").every((filter) =>
      filter.value === WORKSPACE_B
    ),
    true,
  );
});

Deno.test("real resolver rejects malformed bearer JWT without mutation", async () => {
  const client = new MockAdminClient();
  const response = await handleAnalyticsAlertEvaluator(
    request({}, { authorization: "Bearer not-a-real-jwt" }),
    {
      ...dependencies(client),
      resolveCallerContext,
    },
  );

  assertEquals(response.status, 401);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test({
  name: "analytics-alert-evaluator handler env cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    if (originalServiceRoleKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
    }
    if (originalInternalSecret === undefined) {
      Deno.env.delete("INTERNAL_SERVICE_SECRET");
    } else {
      Deno.env.set("INTERNAL_SERVICE_SECRET", originalInternalSecret);
    }
  },
});
