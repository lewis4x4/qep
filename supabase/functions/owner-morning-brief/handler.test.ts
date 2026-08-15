import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import {
  handleOwnerMorningBrief,
  resolveOwnerMorningBriefWorkspace,
  type OwnerMorningBriefDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_owner_morning_brief_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "upsert" = "select";
  private upsertValues: Record<string, unknown> | null = null;

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

  maybeSingle(): this {
    return this;
  }

  upsert(values: Record<string, unknown>, _options?: Record<string, unknown>): this {
    this.operation = "upsert";
    this.upsertValues = values;
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "upsert" && this.upsertValues) {
      this.owner.upserts.push({ table: this.table, payload: this.upsertValues });
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "owner_dashboard_summary") {
      return Promise.resolve({ data: { revenue_mtd: 1000 }, error: null });
    }
    if (name === "compute_ownership_health_score") {
      return Promise.resolve({ data: { score: 82 }, error: null });
    }
    if (name === "owner_event_feed") {
      return Promise.resolve({ data: { count: 3, events: [] }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
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
): Partial<OwnerMorningBriefDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    getAnthropicApiKey: () => "anthropic-test-key",
    callClaude: (async () => ({
      text: "Overnight revenue held steady. Prioritize two stalled deals.",
      tokens_in: 100,
      tokens_out: 40,
    })) as never,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/owner-morning-brief", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("resolveOwnerMorningBriefWorkspace binds JWT callers to active workspace", () => {
  assertEquals(
    resolveOwnerMorningBriefWorkspace({
      isServiceRole: false,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: null,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveOwnerMorningBriefWorkspace({
      isServiceRole: false,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveOwnerMorningBriefWorkspace({
      isServiceRole: false,
      callerWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("resolveOwnerMorningBriefWorkspace requires explicit service workspace", () => {
  assertEquals(
    resolveOwnerMorningBriefWorkspace({
      isServiceRole: true,
      callerWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    {
      ok: false,
      status: 400,
      message: "Service callers must provide an explicit workspace target",
    },
  );
  assertEquals(
    resolveOwnerMorningBriefWorkspace({
      isServiceRole: true,
      callerWorkspaceId: WORKSPACE_B,
      requestedWorkspaceId: null,
    }),
    { ok: true, workspaceId: WORKSPACE_B },
  );
  assertEquals(
    resolveOwnerMorningBriefWorkspace({
      isServiceRole: true,
      callerWorkspaceId: null,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_B },
  );
});

Deno.test("JWT omit uses caller workspace and never falls through to default", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true }),
    dependencies(client),
  );
  assertEquals(response.status, 200);
  assertEquals(client.rpcCalls.length, 3);
  assertEquals(
    client.rpcCalls.every((call) => call.args.p_workspace === WORKSPACE_A),
    true,
  );
  assertEquals(client.upserts[0]?.payload.workspace_id, WORKSPACE_A);
});

Deno.test("JWT forged workspace in body is ignored and stays on caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true, workspace: WORKSPACE_B }),
    dependencies(client),
  );
  assertEquals(response.status, 200);
  assertEquals(
    client.rpcCalls.every((call) => call.args.p_workspace === WORKSPACE_A),
    true,
  );
  assertEquals(client.upserts[0]?.payload.workspace_id, WORKSPACE_A);
});

Deno.test("JWT missing active workspace returns 403 before data reads", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true }),
    dependencies(
      client,
      callerContext({ workspaceId: null }),
    ),
  );
  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("invalid JWT authentication returns 401 without mutation", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true }),
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
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("rep role is forbidden", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true }),
    dependencies(client, callerContext({ role: "rep" })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("service-role explicit workspace in body still works", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true, workspace: WORKSPACE_B }),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
    ),
  );
  assertEquals(response.status, 200);
  assertEquals(
    client.rpcCalls.every((call) => call.args.p_workspace === WORKSPACE_B),
    true,
  );
});

Deno.test("service-role x-workspace-id header still works", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true }),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: WORKSPACE_B,
      }),
    ),
  );
  assertEquals(response.status, 200);
  assertEquals(
    client.rpcCalls.every((call) => call.args.p_workspace === WORKSPACE_B),
    true,
  );
});

Deno.test("real resolver rejects a malformed bearer JWT without mutation", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerMorningBrief(
    request({ refresh: true }),
    {
      ...dependencies(client),
      resolveCallerContext,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test({
  name: "owner-morning-brief handler env cleanup",
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
