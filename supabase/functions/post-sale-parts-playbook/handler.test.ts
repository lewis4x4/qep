import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  eligibleDealsRpcWorkspace,
  generateOne,
  handlePostSalePartsPlaybook,
  resolvePlaybookWorkspace,
  type PlaybookAuthResult,
} from "./handler.ts";

const WORKSPACE_A = "workspace-profile-a";
const WORKSPACE_B = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SERVICE_KEY = "service-role-token";
const DEAL_ID = "11111111-1111-1111-1111-111111111111";
const EQUIPMENT_ID = "22222222-2222-2222-2222-222222222222";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("ANTHROPIC_API_KEY", "anthropic-test-key");

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

class MockAdminClient {
  rpcCalls: RpcCall[] = [];

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({
      data: [{ deal_id: DEAL_ID, equipment_id: EQUIPMENT_ID }],
      error: null,
    });
  }

  from(_table: string) {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    };
  }
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/post-sale-parts-playbook", {
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
  authResult: PlaybookAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  createServiceClient: () => SupabaseClient;
  authenticate: () => Promise<PlaybookAuthResult>;
} {
  return {
    createAdminClient: (() => client) as never,
    createServiceClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
  };
}

function rpcWorkspace(client: MockAdminClient): unknown {
  const call = client.rpcCalls.find((entry) => entry.fn === "eligible_deals_for_playbook");
  return call?.args.p_workspace;
}

Deno.test("resolvePlaybookWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolvePlaybookWorkspace({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolvePlaybookWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolvePlaybookWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("resolvePlaybookWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolvePlaybookWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("eligibleDealsRpcWorkspace maps scoped and unscoped modes", () => {
  assertEquals(
    eligibleDealsRpcWorkspace({ mode: "scoped", workspaceId: WORKSPACE_A }),
    WORKSPACE_A,
  );
  assertEquals(eligibleDealsRpcWorkspace({ mode: "unscoped" }), null);
});

Deno.test("JWT batch passes profile workspace to eligible_deals_for_playbook, never null or default", async () => {
  const client = new MockAdminClient();
  const response = await handlePostSalePartsPlaybook(
    request({
      batch: true,
      limit: 3,
      workspace: WORKSPACE_B,
      workspace_id: WORKSPACE_B,
    }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: WORKSPACE_A,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(rpcWorkspace(client), WORKSPACE_A);
  assertEquals(rpcWorkspace(client) === null, false);
  assertEquals(rpcWorkspace(client) === "default", false);
  assertEquals(rpcWorkspace(client) === WORKSPACE_B, false);
});

Deno.test("JWT forged workspace in body is ignored for workspace resolution", () => {
  const scope = resolvePlaybookWorkspace({
    isServiceRole: false,
    authWorkspaceId: WORKSPACE_A,
    requestedWorkspaceId: WORKSPACE_B,
  });
  assertEquals(scope.mode, "scoped");
  if (scope.mode === "scoped") {
    assertEquals(scope.workspaceId, WORKSPACE_A);
  }
});

Deno.test("JWT missing workspace returns 403 without RPC calls", async () => {
  const client = new MockAdminClient();
  const response = await handlePostSalePartsPlaybook(
    request({
      batch: true,
      workspace: WORKSPACE_B,
    }, { Authorization: "Bearer admin-token" }),
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

Deno.test("generateOne gate rejects foreign workspace", async () => {
  const mockSupabase = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        ilike: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (table === "post_sale_parts_playbooks") {
            return Promise.resolve({ data: null, error: null });
          }
          if (table === "qrm_deals") {
            return Promise.resolve({
              data: {
                id: DEAL_ID,
                name: "Foreign deal",
                workspace_id: WORKSPACE_B,
                company_id: "company-1",
                assigned_rep_id: "rep-1",
                closed_at: "2026-01-01T00:00:00.000Z",
                amount: 10000,
              },
              error: null,
            });
          }
          if (table === "qrm_equipment") {
            return Promise.resolve({
              data: {
                id: EQUIPMENT_ID,
                make: "Yanmar",
                model: "SV120",
                year: 2024,
                category: "loader",
                engine_hours: 100,
                condition: "used",
                workspace_id: WORKSPACE_B,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;

  await assertRejects(
    () => generateOne(
      mockSupabase,
      "anthropic-test-key",
      DEAL_ID,
      EQUIPMENT_ID,
      "batch-test",
      "user-admin-1",
      false,
      WORKSPACE_A,
      "admin",
    ),
    Error,
    "forbidden: deal belongs to another workspace",
  );
});

if (originalServiceRoleKey) {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
}
