import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticatePredictiveAi,
  handlePartsPredictiveAi,
  resolvePredictiveAiWorkspace,
  type PredictiveAiAuthResult,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key");

type FleetFilter = { column: string; value: unknown };

class MockFleetQuery {
  filters: FleetFilter[] = [];
  limitValue: number | null = null;

  select(_cols: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  not(_column: string, _op: string, _value: unknown) {
    return this;
  }

  order(_column: string, _opts: { ascending: boolean }) {
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const workspaceFilter = this.filters.find((f) => f.column === "workspace_id");
    const fleetIdFilter = this.filters.find((f) => f.column === "id");

    const allFleets = [
      {
        id: "fleet-a-1",
        workspace_id: PROFILE_WORKSPACE,
        portal_customer_id: "cust-a",
        make: "Yanmar",
        model: "SV100",
        current_hours: 1200,
      },
      {
        id: "fleet-b-1",
        workspace_id: FORGED_WORKSPACE,
        portal_customer_id: "cust-b",
        make: "Bandit",
        model: "XP20",
        current_hours: 800,
      },
    ];

    let rows = allFleets;
    if (workspaceFilter) {
      rows = rows.filter((row) => row.workspace_id === workspaceFilter.value);
    }
    if (fleetIdFilter) {
      rows = rows.filter((row) => row.id === fleetIdFilter.value);
    }

    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  fleetQuery = new MockFleetQuery();

  from(table: string) {
    if (table === "customer_fleet") {
      this.fleetQuery = new MockFleetQuery();
      return this.fleetQuery;
    }
    if (table === "parts_llm_inference_runs") {
      return {
        insert: (_row: Record<string, unknown>) => ({
          then<TResult1 = { error: null }, TResult2 = never>(
            onfulfilled?:
              | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ): Promise<TResult1 | TResult2> {
            return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
          },
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }

  rpc(fn: string, _args: Record<string, unknown>) {
    if (fn === "customer_fleet_llm_context") {
      return Promise.resolve({
        data: {
          ok: true,
          portal_customer_id: "cust-a",
          customer_name: "Test Customer",
          machine: { make: "Yanmar", model: "SV100", current_hours: 1200 },
          recent_orders_6mo: [],
        },
        error: null,
      });
    }
    if (fn === "match_parts_hybrid") {
      return Promise.resolve({ data: [], error: null });
    }
    if (fn === "write_ai_inferred_play") {
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`Unexpected RPC: ${fn}`);
  }
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/parts-predictive-ai", {
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
  authResult: PredictiveAiAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<PredictiveAiAuthResult>;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
  };
}

function fleetWorkspaceFilter(client: MockAdminClient): unknown {
  return client.fleetQuery.filters.find((f) => f.column === "workspace_id")?.value;
}

Deno.test("resolvePredictiveAiWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolvePredictiveAiWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolvePredictiveAiWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolvePredictiveAiWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("resolvePredictiveAiWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolvePredictiveAiWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("resolvePredictiveAiWorkspace honors x-workspace-id for service-role", () => {
  assertEquals(
    resolvePredictiveAiWorkspace({
      isServiceRole: true,
      authWorkspaceId: CRON_WORKSPACE,
      requestedWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("missing auth returns 401 without fleet query", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({ workspace: FORGED_WORKSPACE }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.fleetQuery.filters.length, 0);
});

Deno.test("forbidden role returns 403 without fleet query", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({}, { Authorization: "Bearer rep-token" }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fleetQuery.filters.length, 0);
});

Deno.test("JWT without active workspace returns 403 without fleet query", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({ workspace: FORGED_WORKSPACE }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: "",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fleetQuery.filters.length, 0);
});

Deno.test("JWT fleet query scopes to profile workspace and ignores forged workspace", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({ workspace: FORGED_WORKSPACE }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(fleetWorkspaceFilter(client), PROFILE_WORKSPACE);
  assertEquals(fleetWorkspaceFilter(client) === FORGED_WORKSPACE, false);
});

Deno.test("JWT omit body.workspace still scopes fleet to profile workspace", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({}, { Authorization: "Bearer manager-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-manager-1",
      role: "manager",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(fleetWorkspaceFilter(client), PROFILE_WORKSPACE);
});

Deno.test("service-role unscoped cron does not filter customer_fleet by workspace", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
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
  assertEquals(fleetWorkspaceFilter(client), undefined);
});

Deno.test("service-role scoped cron honors body.workspace on fleet query", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({ workspace: CRON_WORKSPACE }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, CRON_WORKSPACE);
  assertEquals(fleetWorkspaceFilter(client), CRON_WORKSPACE);
});

Deno.test("service-role scoped cron honors x-workspace-id header on fleet query", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveAi(
    request({}, {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-workspace-id": CRON_WORKSPACE,
    }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: CRON_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, CRON_WORKSPACE);
  assertEquals(fleetWorkspaceFilter(client), CRON_WORKSPACE);
});

Deno.test("authenticatePredictiveAi returns 401 when no auth credentials are present", async () => {
  const client = new MockAdminClient();
  const result = await authenticatePredictiveAi(
    request({}),
    client as never,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "parts-predictive-ai handler env cleanup",
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
