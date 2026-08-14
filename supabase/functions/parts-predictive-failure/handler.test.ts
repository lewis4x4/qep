import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticatePredictiveFailure,
  chainAutoReplenish,
  handlePartsPredictiveFailure,
  type PredictiveFailureAuthResult,
  resolvePredictiveFailureWorkspace,
  rpcWorkspaceParam,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

class MockAdminClient {
  rpcCalls: RpcCall[] = [];
  cronLogged = false;

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    return {
      then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        const data = fn === "predict_parts_needs"
          ? { plays_written: 1, machines_scanned: 2 }
          : { kpis: { open_plays: 3 }, plays: [] };
        return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
      },
    };
  }

  from(table: string) {
    if (table === "service_cron_runs") {
      return {
        insert: (_row: Record<string, unknown>) => {
          this.cronLogged = true;
          return {
            then<TResult1 = { error: null }, TResult2 = never>(
              onfulfilled?:
                | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ): Promise<TResult1 | TResult2> {
              return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
            },
          };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/parts-predictive-failure", {
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
  authResult: PredictiveFailureAuthResult,
  fetchImpl?: typeof fetch,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<PredictiveFailureAuthResult>;
  fetchImpl: typeof fetch;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    fetchImpl: fetchImpl ?? (async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
    })) as typeof fetch,
  };
}

function rpcWorkspace(client: MockAdminClient, fn: string): unknown {
  const call = client.rpcCalls.find((entry) => entry.fn === fn);
  return call?.args.p_workspace;
}

Deno.test("resolvePredictiveFailureWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolvePredictiveFailureWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolvePredictiveFailureWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolvePredictiveFailureWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("resolvePredictiveFailureWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolvePredictiveFailureWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("rpcWorkspaceParam maps scoped and unscoped modes", () => {
  assertEquals(
    rpcWorkspaceParam({ mode: "scoped", workspaceId: PROFILE_WORKSPACE }),
    PROFILE_WORKSPACE,
  );
  assertEquals(rpcWorkspaceParam({ mode: "unscoped" }), null);
});

Deno.test("missing auth returns 401 without RPC calls", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveFailure(
    request({ workspace: FORGED_WORKSPACE }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("forbidden role returns 403 without RPC calls", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveFailure(
    request({}, { Authorization: "Bearer rep-token" }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("JWT without workspace returns 403 without RPC calls", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveFailure(
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
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("JWT predict RPC scopes to profile workspace and ignores forged workspace", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsPredictiveFailure(
    request({
      workspace: FORGED_WORKSPACE,
      workspace_id: FORGED_WORKSPACE,
      lookahead_days: 45,
    }, { Authorization: "Bearer admin-token" }),
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
  assertEquals(rpcWorkspace(client, "predict_parts_needs"), PROFILE_WORKSPACE);
  assertEquals(rpcWorkspace(client, "predictive_plays_summary"), PROFILE_WORKSPACE);
  assertEquals(rpcWorkspace(client, "predict_parts_needs") === FORGED_WORKSPACE, false);
  assertEquals(rpcWorkspace(client, "predict_parts_needs") === null, false);
});

Deno.test("JWT chain_auto_replenish passes caller workspace to parts-auto-replenish", async () => {
  const client = new MockAdminClient();
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const response = await handlePartsPredictiveFailure(
    request({
      chain_auto_replenish: true,
      workspace: FORGED_WORKSPACE,
    }, { Authorization: "Bearer manager-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-manager-1",
      role: "manager",
      workspaceId: PROFILE_WORKSPACE,
    }, fetchImpl),
  );

  assertEquals(response.status, 200);
  assertEquals(capture.body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(capture.headers["x-workspace-id"], PROFILE_WORKSPACE);
  assertEquals(capture.body.workspace_id === FORGED_WORKSPACE, false);
  assertEquals(capture.headers["x-workspace-id"] === FORGED_WORKSPACE, false);
});

Deno.test("service-role unscoped cron passes null workspace to RPCs", async () => {
  const client = new MockAdminClient();
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const response = await handlePartsPredictiveFailure(
    request({ chain_auto_replenish: true }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }, fetchImpl),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "unscoped");
  assertEquals(body.workspace_id, null);
  assertEquals(rpcWorkspace(client, "predict_parts_needs"), null);
  assertEquals(rpcWorkspace(client, "predictive_plays_summary"), null);
  assertEquals(client.cronLogged, true);
  assertEquals(capture.body.workspace_id, undefined);
  assertEquals(capture.headers["x-workspace-id"], undefined);
});

Deno.test("service-role scoped cron honors body.workspace and chains scoped replenish", async () => {
  const client = new MockAdminClient();
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const response = await handlePartsPredictiveFailure(
    request({
      workspace: CRON_WORKSPACE,
      chain_auto_replenish: true,
    }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }, fetchImpl),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, CRON_WORKSPACE);
  assertEquals(rpcWorkspace(client, "predict_parts_needs"), CRON_WORKSPACE);
  assertEquals(capture.body.workspace_id, CRON_WORKSPACE);
  assertEquals(capture.headers["x-workspace-id"], CRON_WORKSPACE);
});

Deno.test("chainAutoReplenish scoped helper binds workspace on outbound call", async () => {
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  await chainAutoReplenish(
    "https://example.test",
    SERVICE_KEY,
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
    fetchImpl,
  );

  assertEquals(capture.body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(capture.headers["x-workspace-id"], PROFILE_WORKSPACE);
});

Deno.test("chainAutoReplenish unscoped helper does not send workspace hints", async () => {
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  await chainAutoReplenish(
    "https://example.test",
    SERVICE_KEY,
    { mode: "unscoped" },
    fetchImpl,
  );

  assertEquals(capture.body.workspace_id, undefined);
  assertEquals(capture.headers["x-workspace-id"], undefined);
});

Deno.test("authenticatePredictiveFailure returns 401 when no auth credentials are present", async () => {
  const client = new MockAdminClient();
  const result = await authenticatePredictiveFailure(
    request({}),
    client as never,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "parts-predictive-failure handler env cleanup",
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
