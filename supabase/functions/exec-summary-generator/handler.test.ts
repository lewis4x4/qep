import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type AuthResult,
  handleExecSummaryGenerator,
  isAuthorizedCaller,
  resolveExecSummaryWorkspace,
} from "./handler.ts";

const INTERNAL_SECRET = "exec-summary-internal-test-only";
const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";

const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
Deno.env.set("INTERNAL_SERVICE_SECRET", INTERNAL_SECRET);

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];

  constructor(
    private readonly owner: MockAdminClient,
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

  in(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
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
    let data: unknown;
    if (this.table === "profiles") {
      data = this.owner.profile;
    } else if (this.table === "analytics_metric_definitions") {
      data = [{
        metric_key: "revenue_total",
        label: "Revenue",
        threshold_config: { warn_below: 1000 },
      }];
    } else if (this.table === "analytics_kpi_snapshots") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      data = workspace === PROFILE_WORKSPACE
        ? [{ metric_key: "revenue_total", metric_value: 5000, refresh_state: "fresh" }]
        : workspace === CRON_WORKSPACE
        ? [{ metric_key: "revenue_total", metric_value: 9000, refresh_state: "fresh" }]
        : [];
    } else if (this.table === "analytics_alerts") {
      data = [];
    } else {
      data = [];
    }
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  profile: { role: string; active_workspace_id: string } | null = {
    role: "owner",
    active_workspace_id: PROFILE_WORKSPACE,
  };

  auth = {
    getUser: async (_token: string) => ({
      data: { user: { id: "user-owner-1" } },
      error: null,
    }),
  };

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }
}

function request(
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/exec-summary-generator", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) => filter.table === table && filter.column === "workspace_id");
}

function dependencies(
  client: MockAdminClient,
  authResult: AuthResult,
): {
  createAdminClient: () => SupabaseClient;
  isAuthorizedCaller: () => Promise<AuthResult>;
} {
  return {
    createAdminClient: (() => client) as never,
    isAuthorizedCaller: (async () => authResult) as never,
  };
}

Deno.test("resolveExecSummaryWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveExecSummaryWorkspace({
      isInternalCaller: false,
      authWorkspace: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    PROFILE_WORKSPACE,
  );
});

Deno.test("resolveExecSummaryWorkspace allows cron callers to target a workspace", () => {
  assertEquals(
    resolveExecSummaryWorkspace({
      isInternalCaller: true,
      authWorkspace: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    CRON_WORKSPACE,
  );
});

Deno.test("resolveExecSummaryWorkspace defaults cron callers to default workspace", () => {
  assertEquals(
    resolveExecSummaryWorkspace({
      isInternalCaller: true,
      authWorkspace: null,
      requestedWorkspaceId: null,
    }),
    "default",
  );
});

Deno.test("missing auth returns 401", async () => {
  const client = new MockAdminClient();
  const response = await handleExecSummaryGenerator(
    request({ role: "ceo" }),
    dependencies(client, { ok: false }),
  );

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, "unauthorized");
});

Deno.test("JWT caller with forged workspace_id is scoped to profile workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleExecSummaryGenerator(
    request(
      { role: "ceo", workspace_id: FORGED_WORKSPACE },
      { Authorization: "Bearer owner-token" },
    ),
    dependencies(client, {
      ok: true,
      isInternal: false,
      userId: "user-owner-1",
      workspace: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
  assertEquals(
    workspaceFilters(client, "analytics_alerts").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
});

Deno.test("cron secret caller can pass workspace_id", async () => {
  const client = new MockAdminClient();
  const response = await handleExecSummaryGenerator(
    request(
      { role: "ceo", workspace_id: CRON_WORKSPACE },
      { "x-internal-service-secret": INTERNAL_SECRET },
    ),
    dependencies(client, { ok: true, isInternal: true }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_id, CRON_WORKSPACE);
  assertEquals(
    workspaceFilters(client, "analytics_kpi_snapshots").some((filter) => filter.value === CRON_WORKSPACE),
    true,
  );
});

Deno.test("invalid role is rejected during authorization", async () => {
  const client = new MockAdminClient();
  client.profile = { role: "rep", active_workspace_id: PROFILE_WORKSPACE };

  const auth = await isAuthorizedCaller(
    request({ role: "ceo" }, { Authorization: "Bearer rep-token" }),
    client as never,
    INTERNAL_SECRET,
  );

  assertEquals(auth.ok, false);
});

Deno.test("invalid request role returns 400", async () => {
  const client = new MockAdminClient();
  const response = await handleExecSummaryGenerator(
    request({ role: "invalid-role" }, { Authorization: "Bearer owner-token" }),
    dependencies(client, {
      ok: true,
      isInternal: false,
      userId: "user-owner-1",
      workspace: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, "invalid_role");
});

if (originalInternalSecret === undefined) {
  Deno.env.delete("INTERNAL_SERVICE_SECRET");
} else {
  Deno.env.set("INTERNAL_SERVICE_SECRET", originalInternalSecret);
}
