import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  eligibleDealsRpcWorkspace,
  generateOne,
  handlePostSalePartsPlaybook,
  partsHybridRpcWorkspace,
  resolvePlaybookWorkspace,
  type PlaybookAuthResult,
} from "./handler.ts";

const WORKSPACE_A = "workspace-profile-a";
const WORKSPACE_B = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SERVICE_KEY = "service-role-token";
const DEAL_ID = "11111111-1111-1111-1111-111111111111";
const EQUIPMENT_ID = "22222222-2222-2222-2222-222222222222";
const EQUIPMENT_B_ID = "33333333-3333-3333-3333-333333333333";

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

Deno.test("partsHybridRpcWorkspace scopes JWT callers and leaves cron unscoped", () => {
  assertEquals(partsHybridRpcWorkspace(WORKSPACE_A, "admin"), WORKSPACE_A);
  assertEquals(partsHybridRpcWorkspace(null, null), null);
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

Deno.test("JWT generateOne with foreign shop equipment_id fails before write", async () => {
  let upsertCalled = false;
  const equipmentFilters: Array<{ column: string; value: unknown }> = [];

  const mockSupabase = {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push({ column, value });
          if (table === "qrm_equipment") {
            equipmentFilters.push({ column, value });
          }
          return chain;
        },
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
                name: "Home deal",
                workspace_id: WORKSPACE_A,
                company_id: "company-1",
                assigned_rep_id: "rep-1",
                closed_at: "2026-01-01T00:00:00.000Z",
                amount: 10000,
              },
              error: null,
            });
          }
          if (table === "qrm_equipment") {
            const workspaceFilter = filters.find((f) => f.column === "workspace_id");
            if (workspaceFilter?.value === WORKSPACE_A) {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({
              data: {
                id: EQUIPMENT_B_ID,
                make: "Bandit",
                model: "2590",
                year: 2023,
                category: "chipper",
                engine_hours: 500,
                condition: "used",
                workspace_id: WORKSPACE_B,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        upsert: () => {
          upsertCalled = true;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "pb-1" }, error: null }),
            }),
          };
        },
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as SupabaseClient;

  await assertRejects(
    () => generateOne(
      mockSupabase,
      "anthropic-test-key",
      DEAL_ID,
      EQUIPMENT_B_ID,
      "batch-test",
      "user-admin-1",
      false,
      WORKSPACE_A,
      "admin",
    ),
    Error,
    "equipment not found",
  );

  assertEquals(upsertCalled, false);
  assertEquals(
    equipmentFilters.some((f) => f.column === "workspace_id" && f.value === WORKSPACE_A),
    true,
  );
});

Deno.test("JWT match_parts_hybrid uses profile workspace, never null", async () => {
  const hybridRpcCalls: Array<Record<string, unknown>> = [];
  let upsertPayload: Record<string, unknown> | null = null;

  const claudePlaybook = {
    windows: [
      {
        window: "30d",
        narrative: "Call soon",
        service_description: "30-hr service",
        parts: [{ description: "oil filter", qty: 1, probability: 0.9, reason: "interval" }],
      },
      {
        window: "60d",
        narrative: "Mid season",
        service_description: "250-hr service",
        parts: [{ description: "fuel filter", qty: 1, probability: 0.8, reason: "interval" }],
      },
      {
        window: "90d",
        narrative: "Season end",
        service_description: "500-hr service",
        parts: [{ description: "air filter", qty: 1, probability: 0.7, reason: "interval" }],
      },
    ],
    assumptions: { hours_per_day: 6 },
  };

  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "openai-test-key");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.anthropic.com")) {
      return new Response(JSON.stringify({
        content: [{ text: JSON.stringify(claudePlaybook) }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }), { status: 200 });
    }
    if (url.includes("api.openai.com")) {
      return new Response(JSON.stringify({
        data: [{ embedding: Array(1536).fill(0.01) }],
      }), { status: 200 });
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
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
                  name: "Home deal",
                  workspace_id: WORKSPACE_A,
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
                  workspace_id: WORKSPACE_A,
                },
                error: null,
              });
            }
            if (table === "qrm_companies") {
              return Promise.resolve({
                data: { name: "Acme Forestry", industry: "forestry" },
                error: null,
              });
            }
            if (table === "machine_profiles") {
              return Promise.resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          upsert: (payload: Record<string, unknown>) => {
            upsertPayload = payload;
            return {
              select: () => ({
                single: () => Promise.resolve({
                  data: { id: "playbook-1", status: "draft", total_revenue: 0 },
                  error: null,
                }),
              }),
            };
          },
        };
        return chain;
      },
      rpc(fn: string, args: Record<string, unknown>) {
        if (fn === "match_parts_hybrid") {
          hybridRpcCalls.push(args);
        }
        return Promise.resolve({ data: [], error: null });
      },
    } as unknown as SupabaseClient;

    await generateOne(
      mockSupabase,
      "anthropic-test-key",
      DEAL_ID,
      EQUIPMENT_ID,
      "batch-test",
      "user-admin-1",
      true,
      WORKSPACE_A,
      "admin",
    );

    assertEquals(hybridRpcCalls.length > 0, true);
    for (const args of hybridRpcCalls) {
      assertEquals(args.p_workspace, WORKSPACE_A);
      assertEquals(args.p_workspace === null, false);
    }
    const written = upsertPayload as Record<string, unknown> | null;
    assertEquals(written !== null, true);
    assertEquals(written?.workspace_id, WORKSPACE_A);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

if (originalServiceRoleKey) {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
}
