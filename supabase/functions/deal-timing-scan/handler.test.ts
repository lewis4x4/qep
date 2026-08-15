import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleDealTimingScan,
  resolveDealTimingWorkspace,
  SERVICE_CRON_DEFAULT_WORKSPACE,
  type DealTimingScanDependencies,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type RpcCall = { fn: string; args: Record<string, unknown> };
type InsertCall = { table: string; row: Record<string, unknown> };

class MockAdminClient {
  rpcCalls: RpcCall[] = [];
  inserts: InsertCall[] = [];
  immediateAlerts = [
    {
      id: "alert-1",
      title: "Immediate alert",
      description: "Action required",
      assigned_rep_id: null,
      alert_type: "budget_cycle",
      urgency: "immediate",
      actioned_deal_id: null,
      customer_profile_id: "customer-1",
      recommended_action: "Call customer",
    },
  ];

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    const data = fn === "compute_deal_timing_alerts"
      ? 1
      : { total_alerts: 1, alerts: [] };
    return Promise.resolve({ data, error: null });
  }

  from(table: string) {
    const owner = this;
    const buildEqChain = (
      filters: Array<{ column: string; value: unknown }>,
    ) => {
      const chain = {
        eq(nextColumn: string, nextValue: unknown) {
          filters.push({ column: nextColumn, value: nextValue });
          return {
            ...chain,
            then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
              onfulfilled?:
                | ((
                  value: { data: unknown; error: null },
                ) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ): Promise<TResult1 | TResult2> {
              return Promise.resolve({
                data: owner.#rowsForTable(table, filters),
                error: null,
              }).then(onfulfilled, onrejected);
            },
          };
        },
        order(_column: string, _options?: Record<string, unknown>) {
          return {
            limit(_count: number) {
              return Promise.resolve({
                data: owner.#rowsForTable(table, filters),
                error: null,
              });
            },
          };
        },
      };
      return chain;
    };

    return {
      select(_columns: string) {
        return buildEqChain([]);
      },
      insert(row: Record<string, unknown>) {
        owner.inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    };
  }

  #rowsForTable(
    table: string,
    filters: Array<{ column: string; value: unknown }>,
  ): unknown[] {
    if (table === "deal_timing_alerts") {
      const workspaceFilter = filters.find((filter) =>
        filter.column === "workspace_id"
      )?.value;
      if (workspaceFilter !== PROFILE_WORKSPACE) return [];
      return this.immediateAlerts;
    }
    if (table === "profiles") {
      const workspaceFilter = filters.find((filter) =>
        filter.column === "active_workspace_id"
      )?.value;
      if (workspaceFilter === PROFILE_WORKSPACE) {
        return [{ id: "manager-1" }];
      }
    }
    return [];
  }
}

function jwtCaller(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer manager-token",
    userId: "user-manager-1",
    role: "manager",
    isServiceRole: false,
    workspaceId: PROFILE_WORKSPACE,
    ...overrides,
  };
}

function request(
  method: string,
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/deal-timing-scan", {
    method,
    headers: {
      "content-type": "application/json",
      ...headers as Record<string, string>,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext,
  isServiceRole = false,
): Partial<DealTimingScanDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    isServiceRoleCaller: (() => isServiceRole) as never,
    publishFlowEvent: (async () => undefined) as never,
  };
}

function rpcWorkspace(client: MockAdminClient, fn: string): unknown {
  return client.rpcCalls.find((call) => call.fn === fn)?.args.p_workspace_id;
}

Deno.test("resolveDealTimingWorkspace binds JWT callers to profile workspace and ignores forged target", () => {
  const result = resolveDealTimingWorkspace({
    caller: jwtCaller(),
    isServiceRole: false,
    requestedWorkspaceId: FORGED_WORKSPACE,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.workspaceId, PROFILE_WORKSPACE);
    assertEquals(result.isServiceRole, false);
  }
});

Deno.test("resolveDealTimingWorkspace returns 403 when JWT caller has no active workspace", () => {
  const result = resolveDealTimingWorkspace({
    caller: jwtCaller({ workspaceId: null }),
    isServiceRole: false,
    requestedWorkspaceId: null,
  });
  assertEquals(result, {
    ok: false,
    status: 403,
    message: "The authenticated user has no active workspace",
  });
});

Deno.test("resolveDealTimingWorkspace returns 403 for rep role", () => {
  const result = resolveDealTimingWorkspace({
    caller: jwtCaller({ role: "rep" }),
    isServiceRole: false,
    requestedWorkspaceId: null,
  });
  assertEquals(result, {
    ok: false,
    status: 403,
    message: "Deal timing requires manager or owner role",
  });
});

Deno.test("resolveDealTimingWorkspace uses documented default only for service-role cron", () => {
  const result = resolveDealTimingWorkspace({
    caller: {
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: null,
    },
    isServiceRole: true,
    requestedWorkspaceId: null,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.workspaceId, SERVICE_CRON_DEFAULT_WORKSPACE);
    assertEquals(result.isServiceRole, true);
  }
});

Deno.test("JWT forged/omit workspace uses profile workspace for RPCs and notification inserts", async () => {
  const client = new MockAdminClient();

  const getResponse = await handleDealTimingScan(
    request("GET", undefined, {
      Authorization: "Bearer manager-token",
    }),
    dependencies(client, jwtCaller()),
  );
  assertEquals(getResponse.status, 200);
  assertEquals(rpcWorkspace(client, "get_timing_dashboard"), PROFILE_WORKSPACE);
  assertEquals(rpcWorkspace(client, "get_timing_dashboard") === "default", false);
  assertEquals(rpcWorkspace(client, "get_timing_dashboard") === FORGED_WORKSPACE, false);

  const postClient = new MockAdminClient();
  const postResponse = await handleDealTimingScan(
    request("POST", {
      workspace: FORGED_WORKSPACE,
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer manager-token" }),
    dependencies(postClient, jwtCaller()),
  );

  assertEquals(postResponse.status, 200);
  const body = await postResponse.json();
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(rpcWorkspace(postClient, "compute_deal_timing_alerts"), PROFILE_WORKSPACE);
  assertEquals(
    postClient.inserts.every((insert) => insert.row.workspace_id === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(postClient.inserts.length > 0, true);
  assertEquals(
    postClient.inserts.some((insert) => insert.row.workspace_id === "default"),
    false,
  );
  assertEquals(
    postClient.inserts.some((insert) => insert.row.workspace_id === FORGED_WORKSPACE),
    false,
  );
});

Deno.test("JWT missing workspace returns 403 without RPC calls", async () => {
  const client = new MockAdminClient();
  const response = await handleDealTimingScan(
    request("GET", undefined, { Authorization: "Bearer manager-token" }),
    dependencies(client, jwtCaller({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
  assertEquals(client.inserts.length, 0);
});

Deno.test("JWT wrong role returns 403 without RPC calls", async () => {
  const client = new MockAdminClient();
  const response = await handleDealTimingScan(
    request("POST", {}, { Authorization: "Bearer rep-token" }),
    dependencies(client, jwtCaller({ role: "rep" })),
  );

  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
  assertEquals(client.inserts.length, 0);
});

Deno.test("service-role cron without workspace hint uses documented default", async () => {
  const client = new MockAdminClient();
  const response = await handleDealTimingScan(
    request("POST", {}),
    dependencies(
      client,
      {
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      },
      true,
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(rpcWorkspace(client, "compute_deal_timing_alerts"), SERVICE_CRON_DEFAULT_WORKSPACE);
});

Deno.test({
  name: "deal-timing-scan handler env cleanup",
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
