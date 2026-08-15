import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticateOwnerPredictiveInterventions,
  buildSnapshotQueries,
  handleOwnerPredictiveInterventions,
  parseInterventions,
  resolveOwnerPredictiveWorkspace,
  type OwnerPredictiveAuthResult,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const SHOP_B_WORKSPACE = "workspace-shop-b";
const SERVICE_WORKSPACE = "workspace-service-target";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("ANTHROPIC_API_KEY", "anthropic-test-key");

type TableQuery = {
  table: string;
  filters: Record<string, string>;
  operation: "select" | "upsert";
};

class MockAdminClient {
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  tableQueries: TableQuery[] = [];
  cacheRow: {
    payload: Record<string, unknown>;
    generated_at: string;
    model: string | null;
  } | null = null;

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({
      data: fn === "owner_dashboard_summary"
        ? { revenue_mtd: 1000 }
        : { score: 85 },
      error: null,
    });
  }

  from(table: string) {
    const self = this;
    const filters: Record<string, string> = {};
    let operation: TableQuery["operation"] = "select";

    const chain = {
      select: (_cols: string) => chain,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return chain;
      },
      is: (_column: string, _value: unknown) => chain,
      lt: (_column: string, _value: string) => chain,
      order: (_column: string, _opts: { ascending: boolean }) => chain,
      limit: (_n: number) => chain,
      maybeSingle: () => {
        self.tableQueries.push({ table, filters: { ...filters }, operation });
        if (table === "owner_predictive_interventions_cache" && self.cacheRow) {
          return Promise.resolve({ data: self.cacheRow, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert: (row: Record<string, unknown>, _opts: { onConflict: string }) => {
        operation = "upsert";
        self.tableQueries.push({ table, filters: { ...filters }, operation });
        if (table === "owner_predictive_interventions_cache") {
          self.cacheRow = {
            payload: row.payload as Record<string, unknown>,
            generated_at: row.generated_at as string,
            model: row.model as string | null,
          };
        }
        return Promise.resolve({ error: null });
      },
      then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        self.tableQueries.push({ table, filters: { ...filters }, operation });
        const data = table === "v_branch_stack_ranking"
          ? [{ workspace_id: filters.workspace_id, branch_code: "BR1" }]
          : table === "predicted_parts_plays"
            ? [{ part_number: "P1", projected_revenue: 500 }]
            : table === "qrm_deals"
              ? [{ id: "deal-1", name: "Stalled", amount: 25000 }]
              : [];
        return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
      },
    };
    return chain;
  }
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/owner-predictive-interventions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers as Record<string, string>,
    },
    body: JSON.stringify(body ?? {}),
  });
}

function dependencies(
  client: MockAdminClient,
  authResult: OwnerPredictiveAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<OwnerPredictiveAuthResult>;
  callClaudeImpl: () => Promise<{ text: string; tokens_in: number; tokens_out: number }>;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    callClaudeImpl: (async () => ({
      text: JSON.stringify({
        interventions: [{
          title: "Pipeline stall",
          projection: "4 deals cross $100K in 6 weeks",
          rationale: "4 deals haven't moved in 12+ days",
          impact_usd: 100000,
          horizon_days: 42,
          severity: "high",
          action: { label: "Review queue", route: "/qrm/deals" },
        }],
      }),
      tokens_in: 100,
      tokens_out: 50,
    })) as never,
  };
}

function tableFilters(client: MockAdminClient, table: string): Record<string, string> | undefined {
  const query = client.tableQueries.find((q) => q.table === table);
  return query?.filters;
}

function rpcWorkspace(client: MockAdminClient, fn: string): unknown {
  const call = client.rpcCalls.find((entry) => entry.fn === fn);
  return call?.args.p_workspace;
}

Deno.test("resolveOwnerPredictiveWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveOwnerPredictiveWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: SHOP_B_WORKSPACE,
    }),
    { workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolveOwnerPredictiveWorkspace honors service-role body.workspace", () => {
  assertEquals(
    resolveOwnerPredictiveWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: SERVICE_WORKSPACE,
      headerWorkspaceId: null,
    }),
    { workspaceId: SERVICE_WORKSPACE },
  );
});

Deno.test("resolveOwnerPredictiveWorkspace honors service-role x-workspace-id header", () => {
  assertEquals(
    resolveOwnerPredictiveWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: SERVICE_WORKSPACE,
    }),
    { workspaceId: SERVICE_WORKSPACE },
  );
});

Deno.test("resolveOwnerPredictiveWorkspace returns empty workspace when service-role has no hint", () => {
  assertEquals(
    resolveOwnerPredictiveWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { workspaceId: "" },
  );
});

Deno.test("buildSnapshotQueries binds all shop tables to workspace", () => {
  const queries = buildSnapshotQueries(PROFILE_WORKSPACE);
  assertEquals(queries.summaryRpc.p_workspace, PROFILE_WORKSPACE);
  assertEquals(queries.scoreRpc.p_workspace, PROFILE_WORKSPACE);
  assertEquals(queries.branchFilter.workspace_id, PROFILE_WORKSPACE);
  assertEquals(queries.playsFilter.workspace_id, PROFILE_WORKSPACE);
  assertEquals(queries.stalledDealsFilter.workspace_id, PROFILE_WORKSPACE);
});

Deno.test("parseInterventions normalizes routes and severity", () => {
  const parsed = parseInterventions(JSON.stringify({
    interventions: [{
      title: "Test",
      projection: "x",
      rationale: "y",
      severity: "bogus",
      action: { label: "Go", route: "/not-allowed" },
    }],
  }));
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].severity, "medium");
  assertEquals(parsed[0].action.route, "/owner");
});

Deno.test("missing auth returns 401 without data access", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerPredictiveInterventions(
    request({ workspace: SHOP_B_WORKSPACE }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.rpcCalls.length, 0);
  assertEquals(client.tableQueries.length, 0);
});

Deno.test("forbidden role returns 403 without data access", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerPredictiveInterventions(
    request({}, { Authorization: "Bearer rep-token" }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("JWT without workspace returns 403 without data access", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerPredictiveInterventions(
    request({ workspace: SHOP_B_WORKSPACE }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: "",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("JWT scopes RPCs and shop tables to profile workspace; forged workspace ignored", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerPredictiveInterventions(
    request({ refresh: true, workspace: SHOP_B_WORKSPACE }, { Authorization: "Bearer owner-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      role: "owner",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);

  assertEquals(rpcWorkspace(client, "owner_dashboard_summary"), PROFILE_WORKSPACE);
  assertEquals(rpcWorkspace(client, "compute_ownership_health_score"), PROFILE_WORKSPACE);
  assertEquals(rpcWorkspace(client, "owner_dashboard_summary") === SHOP_B_WORKSPACE, false);

  assertEquals(tableFilters(client, "v_branch_stack_ranking")?.workspace_id, PROFILE_WORKSPACE);
  assertEquals(tableFilters(client, "predicted_parts_plays")?.workspace_id, PROFILE_WORKSPACE);
  assertEquals(tableFilters(client, "qrm_deals")?.workspace_id, PROFILE_WORKSPACE);
  assertEquals(tableFilters(client, "v_branch_stack_ranking")?.workspace_id === SHOP_B_WORKSPACE, false);
  assertEquals(tableFilters(client, "predicted_parts_plays")?.workspace_id === SHOP_B_WORKSPACE, false);
  assertEquals(tableFilters(client, "qrm_deals")?.workspace_id === SHOP_B_WORKSPACE, false);

  const cacheUpsert = client.tableQueries.find(
    (q) => q.table === "owner_predictive_interventions_cache" && q.operation === "upsert",
  );
  assertEquals(cacheUpsert !== undefined, true);
});

Deno.test("service-role with explicit workspace scopes reads to that shop", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerPredictiveInterventions(
    request({ refresh: true, workspace: SERVICE_WORKSPACE }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_id, SERVICE_WORKSPACE);
  assertEquals(rpcWorkspace(client, "owner_dashboard_summary"), SERVICE_WORKSPACE);
  assertEquals(tableFilters(client, "qrm_deals")?.workspace_id, SERVICE_WORKSPACE);
});

Deno.test("service-role without workspace hint returns 403", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerPredictiveInterventions(
    request({ refresh: true }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("authenticateOwnerPredictiveInterventions returns 401 when no credentials", async () => {
  const client = new MockAdminClient();
  const result = await authenticateOwnerPredictiveInterventions(request({}), client as never);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "owner-predictive-interventions handler env cleanup",
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
