import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  applyWorkspaceFilter,
  authenticatePricingAutocorrect,
  handlePartsPricingAutocorrect,
  resolvePricingAutocorrectWorkspace,
  verifyRuleInWorkspace,
  type PricingAutocorrectAuthResult,
} from "./handler.ts";

const SHOP_A = "workspace-shop-a";
const SHOP_B = "workspace-shop-b";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const RULE_SHOP_A = "rule-shop-a";
const RULE_SHOP_B = "rule-shop-b";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SERVICE_CRON_RUNS_DISABLED", "true");

type Filter = { table: string; column: string; value: unknown };

class SuggestionsQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  filters: Filter[] = [];

  constructor(private readonly owner: MockAdminClient) {}

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ table: "parts_pricing_suggestions", column, value });
    this.owner.filters.push({ table: "parts_pricing_suggestions", column, value });
    return this;
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const workspaceFilter = this.filters.find((f) => f.column === "workspace_id")?.value;
    const rows = [
      { id: "suggestion-a", rule_id: RULE_SHOP_A },
      { id: "suggestion-b", rule_id: RULE_SHOP_B },
    ];
    const data = typeof workspaceFilter === "string"
      ? rows.filter((row) =>
        workspaceFilter === SHOP_A ? row.id === "suggestion-a" : row.id === "suggestion-b"
      )
      : rows;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class RulesQuery implements PromiseLike<{ data: unknown; error: null }> {
  private ruleId: string | null;

  constructor(ruleId: string | null) {
    this.ruleId = ruleId;
  }

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    if (column === "id") this.ruleId = String(value);
    return this;
  }

  maybeSingle() {
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.ruleId === RULE_SHOP_A
      ? { id: RULE_SHOP_A, workspace_id: SHOP_A }
      : this.ruleId === RULE_SHOP_B
      ? { id: RULE_SHOP_B, workspace_id: SHOP_B }
      : null;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockRpcClient {
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "pricing_suggestions_generate") {
      return Promise.resolve({
        data: { ok: true, suggestions_written: 1 },
        error: null,
      });
    }
    if (name === "pricing_suggestions_apply") {
      return Promise.resolve({
        data: { ok: true, applied_count: (args.p_suggestion_ids as string[]).length },
        error: null,
      });
    }
    if (name === "pricing_rules_summary") {
      return Promise.resolve({ data: { kpis: { active_rules: 1 } }, error: null });
    }
    throw new Error(`Unexpected RPC: ${name}`);
  }
}

class MockAdminClient extends MockRpcClient {
  filters: Filter[] = [];
  suggestionsQuery = new SuggestionsQuery(this);

  from(table: string) {
    if (table === "parts_pricing_suggestions") {
      this.suggestionsQuery = new SuggestionsQuery(this);
      return this.suggestionsQuery;
    }
    if (table === "parts_pricing_rules") {
      return new RulesQuery(null);
    }
    throw new Error(`Unexpected table: ${table}`);
  }
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/parts-pricing-autocorrect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers as Record<string, string>,
    },
    body: JSON.stringify(body ?? {}),
  });
}

function dependencies(
  adminClient: MockAdminClient,
  callerClient: MockRpcClient,
  authResult: PricingAutocorrectAuthResult,
) {
  return {
    createAdminClient: (() => adminClient) as never,
    createCallerClient: (() => callerClient) as never,
    authenticate: (async () => authResult) as never,
    logServiceCronRun: (async () => {}) as never,
  };
}

function jwtAuth(workspaceId = SHOP_A): PricingAutocorrectAuthResult {
  return {
    ok: true,
    isServiceRole: false,
    userId: "user-admin-1",
    role: "admin",
    workspaceId,
    authHeader: "Bearer admin-token",
  };
}

function suggestionsWorkspaceFilter(client: MockAdminClient): unknown {
  return client.filters.find((f) =>
    f.table === "parts_pricing_suggestions" && f.column === "workspace_id"
  )?.value;
}

Deno.test("resolvePricingAutocorrectWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolvePricingAutocorrectWorkspace({
      isServiceRole: false,
      authWorkspaceId: SHOP_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: SHOP_A },
  );
});

Deno.test("resolvePricingAutocorrectWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolvePricingAutocorrectWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("resolvePricingAutocorrectWorkspace honors workspace hint for service-role", () => {
  assertEquals(
    resolvePricingAutocorrectWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: CRON_WORKSPACE,
      headerWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
  assertEquals(
    resolvePricingAutocorrectWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("applyWorkspaceFilter adds workspace_id eq when scoped", () => {
  const captured: string[] = [];
  const query = {
    eq(column: string, value: string) {
      captured.push(`${column}=${value}`);
      return query;
    },
  };
  applyWorkspaceFilter(query, { mode: "scoped", workspaceId: SHOP_A });
  assertEquals(captured, ["workspace_id=workspace-shop-a"]);
});

Deno.test("JWT forged/omit workspace uses profile workspace A for RPCs and suggestion query", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();

  for (const body of [{ workspace: FORGED_WORKSPACE }, {}]) {
    adminClient.filters = [];
    adminClient.suggestionsQuery = new SuggestionsQuery(adminClient);
    callerClient.rpcCalls = [];

    const response = await handlePartsPricingAutocorrect(
      request({ ...body, apply_auto_rules: true }, { Authorization: "Bearer admin-token" }),
      dependencies(adminClient, callerClient, jwtAuth()),
    );

    assertEquals(response.status, 200);
    const payload = await response.json();
    assertEquals(payload.workspace_scope, "scoped");
    assertEquals(payload.workspace_id, SHOP_A);
    assertEquals(suggestionsWorkspaceFilter(adminClient), SHOP_A);
    assertEquals(callerClient.rpcCalls.map((call) => call.name), [
      "pricing_suggestions_generate",
      "pricing_suggestions_apply",
      "pricing_rules_summary",
    ]);
    assertEquals(adminClient.rpcCalls.length, 0);
  }
});

Deno.test("JWT missing workspace returns 403 without RPC", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();
  const response = await handlePartsPricingAutocorrect(
    request({ apply_auto_rules: true }, { Authorization: "Bearer admin-token" }),
    dependencies(adminClient, callerClient, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: "",
      authHeader: "Bearer admin-token",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(callerClient.rpcCalls.length, 0);
  assertEquals(adminClient.filters.length, 0);
});

Deno.test("JWT non-admin role returns 403 without RPC", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();
  const response = await handlePartsPricingAutocorrect(
    request({}, { Authorization: "Bearer rep-token" }),
    dependencies(adminClient, callerClient, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(callerClient.rpcCalls.length, 0);
  assertEquals(adminClient.filters.length, 0);
});

Deno.test("JWT rule_id from shop B is rejected before RPC", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();
  const response = await handlePartsPricingAutocorrect(
    request({ rule_id: RULE_SHOP_B, apply_auto_rules: true }, {
      Authorization: "Bearer admin-token",
    }),
    dependencies(adminClient, callerClient, jwtAuth(SHOP_A)),
  );

  assertEquals(response.status, 403);
  assertEquals(callerClient.rpcCalls.length, 0);
  assertEquals(adminClient.filters.length, 0);
});

Deno.test("verifyRuleInWorkspace returns 404 when rule is missing", async () => {
  const adminClient = new MockAdminClient();
  const result = await verifyRuleInWorkspace(adminClient as never, "missing-rule", SHOP_A);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 404);
});

Deno.test("verifyRuleInWorkspace returns 403 when rule belongs to another workspace", async () => {
  const adminClient = new MockAdminClient();
  const result = await verifyRuleInWorkspace(adminClient as never, RULE_SHOP_B, SHOP_A);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

Deno.test("service-role unscoped cron does not filter suggestions by workspace", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();
  const response = await handlePartsPricingAutocorrect(
    request({ apply_auto_rules: true }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(adminClient, callerClient, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.workspace_scope, "unscoped");
  assertEquals(payload.workspace_id, null);
  assertEquals(suggestionsWorkspaceFilter(adminClient), undefined);
  assertEquals(adminClient.rpcCalls.map((call) => call.name), [
    "pricing_suggestions_generate",
    "pricing_suggestions_apply",
    "pricing_rules_summary",
  ]);
});

Deno.test("service-role with body.workspace scopes suggestions query", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();
  const response = await handlePartsPricingAutocorrect(
    request({ workspace: CRON_WORKSPACE, apply_auto_rules: true }, {
      Authorization: `Bearer ${SERVICE_KEY}`,
    }),
    dependencies(adminClient, callerClient, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.workspace_scope, "scoped");
  assertEquals(payload.workspace_id, CRON_WORKSPACE);
  assertEquals(suggestionsWorkspaceFilter(adminClient), CRON_WORKSPACE);
});

Deno.test("service-role with x-workspace-id scopes suggestions query", async () => {
  const adminClient = new MockAdminClient();
  const callerClient = new MockRpcClient();
  const response = await handlePartsPricingAutocorrect(
    request({ apply_auto_rules: true }, {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-workspace-id": CRON_WORKSPACE,
    }),
    dependencies(adminClient, callerClient, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: CRON_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.workspace_scope, "scoped");
  assertEquals(payload.workspace_id, CRON_WORKSPACE);
  assertEquals(suggestionsWorkspaceFilter(adminClient), CRON_WORKSPACE);
});

Deno.test("authenticatePricingAutocorrect returns 401 when no auth credentials are present", async () => {
  const adminClient = new MockAdminClient();
  const result = await authenticatePricingAutocorrect(
    request({}),
    adminClient as never as SupabaseClient,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "parts-pricing-autocorrect handler env cleanup",
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
