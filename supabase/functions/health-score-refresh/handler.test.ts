import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  discoverServiceWorkspaces,
  handleHealthScoreRefresh,
  resolveHealthScoreWorkspaceSelection,
} from "./handler.ts";

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements
  PromiseLike<{
    data: Array<Record<string, unknown>>;
    error: null;
  }> {
  readonly filters: Filter[] = [];

  constructor(
    private readonly owner: HealthClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
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

  not(_column: string, _operator: string, _value: unknown): this {
    return this;
  }

  gt(_column: string, _value: unknown): this {
    return this;
  }

  in(column: string, value: unknown[]): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  #rows(): Array<Record<string, unknown>> {
    if (this.table === "profiles") {
      return [{ active_workspace_id: "workspace-a" }];
    }
    if (this.table === "crm_companies") {
      const workspace = this.filters.find((filter) =>
        filter.column === "workspace_id"
      )?.value;
      return workspace
        ? [{ id: `company-${workspace}` }]
        : [{ workspace_id: "workspace-b" }];
    }
    if (this.table === "crm_contacts") {
      const workspace = this.filters.find((filter) =>
        filter.column === "workspace_id"
      )?.value;
      return [{ dge_customer_profile_id: `profile-${workspace}` }];
    }
    if (this.table === "customer_profiles_extended") {
      const anchor = this.filters.find((filter) =>
        filter.column === "crm_company_id" || filter.column === "id"
      )?.value;
      const firstAnchor = Array.isArray(anchor) ? String(anchor[0] ?? "") : "";
      const workspace = firstAnchor.replace(/^company-/, "").replace(
        /^profile-/,
        "",
      ) || "workspace-unknown";
      return [{
        id: `profile-${workspace}`,
        crm_company_id: `company-${workspace}`,
        health_score: 75,
        customer_name: `Customer ${workspace}`,
        health_score_updated_at: null,
      }];
    }
    return [];
  }

  then<
    TResult1 = {
      data: Array<Record<string, unknown>>;
      error: null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
        data: Array<Record<string, unknown>>;
        error: null;
      }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.#rows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class HealthClient {
  filters: Filter[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "list_health_score_refresh_workspaces") {
      return Promise.resolve({
        data: ["workspace-a", "workspace-b"],
        error: null,
      });
    }
    if (name === "list_customer_health_profiles_for_workspace") {
      const workspace = String(args.p_workspace_id);
      return Promise.resolve({
        data: [{
          id: `profile-${workspace}`,
          crm_company_id: `company-${workspace}`,
          health_score: 75,
          customer_name: `Customer ${workspace}`,
          health_score_updated_at: null,
        }],
        error: null,
      });
    }
    return Promise.resolve({
      data: name === "generate_cross_department_alerts" ? 2 : null,
      error: null,
    });
  }
}

function caller(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-1",
    role: "manager",
    isServiceRole: false,
    workspaceId: "workspace-a",
    ...overrides,
  };
}

function overrides(client: HealthClient, context: CallerContext) {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => context) as never,
    refreshCustomerProfileSnapshot:
      (async () => ({ refreshed: true })) as never,
  };
}

Deno.test("manual health workspace selection is bound to current profile truth", () => {
  assertEquals(
    resolveHealthScoreWorkspaceSelection({
      caller: caller(),
      requestedWorkspaceId: null,
      isCron: false,
    }),
    { ok: true, mode: "single", workspaceId: "workspace-a" },
  );
  assertEquals(
    resolveHealthScoreWorkspaceSelection({
      caller: caller(),
      requestedWorkspaceId: "workspace-b",
      isCron: false,
    }),
    {
      ok: false,
      status: 403,
      message: "The requested workspace is not authorized for this caller",
    },
  );
});

Deno.test("manager GET reads only profiles anchored to the caller workspace", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh"),
    overrides(client, caller()),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.workspace_id, "workspace-a");
  assertEquals(body.total_scored, 1);
  assertEquals(
    client.rpcCalls.some((call) =>
      call.name === "list_customer_health_profiles_for_workspace" &&
      call.args.p_workspace_id === "workspace-a" &&
      call.args.p_order === "score_desc" && call.args.p_limit === 100
    ),
    true,
  );
});

Deno.test("manager cross-workspace GET is rejected before database reads", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request(
      "https://example.test/functions/v1/health-score-refresh?workspace_id=workspace-b",
    ),
    overrides(client, caller()),
  );
  assertEquals(response.status, 403);
  assertEquals(client.filters.length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("targeted POST scopes profile, activity, score, and alert work to one workspace", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: "workspace-a" }),
    }),
    overrides(client, caller()),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.workspace_id, "workspace-a");
  assertEquals(body.scores_refreshed, 1);
  for (
    const table of [
      "parts_orders",
      "customer_invoices",
      "crm_deals",
      "rental_invoices",
    ]
  ) {
    assertEquals(
      client.filters.some((filter) =>
        filter.table === table && filter.column === "workspace_id" &&
        filter.value === "workspace-a"
      ),
      true,
    );
  }
  const alert = client.rpcCalls.find((call) =>
    call.name === "generate_cross_department_alerts"
  );
  assertEquals(alert?.args.p_workspace_id, "workspace-a");
});

Deno.test("non-cron service calls require an explicit workspace", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      body: "{}",
    }),
    overrides(
      client,
      caller({
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
    ),
  );
  assertEquals(response.status, 400);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("service cron enumerates and refreshes each discovered workspace separately", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cron" }),
    }),
    overrides(
      client,
      caller({
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
    ),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.workspace_count, 2);
  assertEquals(body.failed_workspace_count, 0);
  const alertWorkspaces = client.rpcCalls
    .filter((call) => call.name === "generate_cross_department_alerts")
    .map((call) => call.args.p_workspace_id)
    .sort();
  assertEquals(alertWorkspaces, ["workspace-a", "workspace-b"]);
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    assertEquals(
      client.filters.some((filter) =>
        filter.table === "parts_orders" && filter.column === "workspace_id" &&
        filter.value === workspaceId
      ),
      true,
    );
  }
});

Deno.test("service workspace discovery preserves more than one thousand RPC results", async () => {
  const workspaceIds = Array.from(
    { length: 1005 },
    (_, index) => `workspace-${String(index).padStart(4, "0")}`,
  );
  const resolved = await discoverServiceWorkspaces({
    rpc() {
      return Promise.resolve({ data: workspaceIds, error: null });
    },
  } as never);
  assertEquals(resolved.length, 1005);
  assertEquals(resolved[1004], "workspace-1004");
});
