import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import {
  executeTool,
  handleOwnerAskAnything,
  resolveOwnerAskAnythingWorkspace,
  type OwnerAskAnythingDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_owner_ask_anything_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" = "select";
  private limitValue: number | null = null;

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

  ilike(_column: string, _pattern: string): this {
    return this;
  }

  is(_column: string, _value: unknown): this {
    return this;
  }

  gte(_column: string, _value: unknown): this {
    return this;
  }

  lt(_column: string, _value: unknown): this {
    return this;
  }

  order(_column: string, _opts?: { ascending: boolean }): this {
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "select") {
      const workspaceFilter = this.filters.find((f) => f.column === "workspace_id");
      const rows = this.owner.tableRows[this.table] ?? [];
      const scoped = workspaceFilter
        ? rows.filter((row) => row.workspace_id === workspaceFilter.value)
        : rows;
      return Promise.resolve({ data: scoped, error: null }).then(onfulfilled, onrejected);
    }
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  tableRows: Record<string, Array<Record<string, unknown>>> = {
    qrm_companies: [
      { id: "co-a", name: "Alpha Corp", workspace_id: WORKSPACE_A },
      { id: "co-b", name: "Beta Corp", workspace_id: WORKSPACE_B },
    ],
    qrm_deals: [
      { id: "deal-a", name: "Deal A", amount: 50000, workspace_id: WORKSPACE_A },
      { id: "deal-b", name: "Deal B", amount: 90000, workspace_id: WORKSPACE_B },
    ],
    predicted_parts_plays: [
      { part_number: "P-A", status: "open", workspace_id: WORKSPACE_A },
      { part_number: "P-B", status: "open", workspace_id: WORKSPACE_B },
    ],
    v_branch_stack_ranking: [
      { branch_code: "BR-A", inventory_value: 1000, workspace_id: WORKSPACE_A },
      { branch_code: "BR-B", inventory_value: 2000, workspace_id: WORKSPACE_B },
    ],
  };

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "owner_dashboard_summary") {
      return Promise.resolve({ data: { revenue_mtd: 1000 }, error: null });
    }
    if (name === "owner_event_feed") {
      return Promise.resolve({ data: { count: 2, events: [] }, error: null });
    }
    if (name === "match_parts_hybrid") {
      return Promise.resolve({ data: [], error: null });
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

const ALL_TOOLS = [
  "get_dashboard_summary",
  "search_parts",
  "search_companies",
  "list_deals",
  "recent_predictive_plays",
  "branch_stack_ranking",
  "owner_event_feed",
];

function mockClaudeWithAllTools(): OwnerAskAnythingDependencies["callClaude"] {
  let turn = 0;
  return async () => {
    turn += 1;
    if (turn === 1) {
      return {
        content: ALL_TOOLS.map((name, index) => ({
          type: "tool_use" as const,
          id: `tool-${index}`,
          name,
          input: name === "search_parts"
            ? { query: "hydraulic filter" }
            : name === "search_companies"
            ? { name: "Corp" }
            : {},
        })),
        tokens_in: 50,
        tokens_out: 20,
      };
    }
    return {
      content: [{ type: "text" as const, text: "Your pipeline looks steady." }],
      tokens_in: 10,
      tokens_out: 5,
    };
  };
}

async function scopedExecuteTool(
  supabase: Parameters<typeof executeTool>[0],
  workspaceId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return executeTool(
    supabase,
    workspaceId,
    name,
    input,
    async () => [0, 0, 0],
  );
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
): Partial<OwnerAskAnythingDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    getAnthropicApiKey: () => "anthropic-test-key",
    callClaude: mockClaudeWithAllTools(),
    executeTool: scopedExecuteTool,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/owner-ask-anything", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ question: "How is the business?", ...body }),
  });
}

Deno.test("resolveOwnerAskAnythingWorkspace binds JWT callers to active workspace", () => {
  assertEquals(
    resolveOwnerAskAnythingWorkspace({
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: null,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveOwnerAskAnythingWorkspace({
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveOwnerAskAnythingWorkspace({
      callerWorkspaceId: null,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("JWT omit workspace uses caller workspace on every RPC and query", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerAskAnything(
    request(),
    dependencies(client),
  );
  assertEquals(response.status, 200);

  const rpcWithWorkspace = client.rpcCalls.filter((call) =>
    "p_workspace" in call.args
  );
  assertEquals(rpcWithWorkspace.length > 0, true);
  assertEquals(
    rpcWithWorkspace.every((call) => call.args.p_workspace === WORKSPACE_A),
    true,
  );
  assertEquals(
    rpcWithWorkspace.every((call) => call.args.p_workspace !== null),
    true,
  );

  const workspaceFilters = client.filters.filter((f) => f.column === "workspace_id");
  assertEquals(workspaceFilters.length >= 4, true);
  assertEquals(
    workspaceFilters.every((f) => f.value === WORKSPACE_A),
    true,
  );
  assertEquals(
    workspaceFilters.some((f) => f.value === WORKSPACE_B),
    false,
  );
});

Deno.test("JWT forged workspace in body is ignored and stays on caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerAskAnything(
    request({ workspace: WORKSPACE_B, workspace_id: WORKSPACE_B }),
    dependencies(client),
  );
  assertEquals(response.status, 200);
  assertEquals(
    client.rpcCalls.every((call) =>
      !("p_workspace" in call.args) || call.args.p_workspace === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    client.filters
      .filter((f) => f.column === "workspace_id")
      .every((f) => f.value === WORKSPACE_A),
    true,
  );
});

Deno.test("JWT missing active workspace returns 403 before data reads", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerAskAnything(
    request(),
    dependencies(client, callerContext({ workspaceId: null })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
  assertEquals(client.filters.length, 0);
});

Deno.test("invalid JWT authentication returns 401 without data access", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerAskAnything(
    request(),
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
  const response = await handleOwnerAskAnything(
    request(),
    dependencies(client, callerContext({ role: "rep" })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("service-role caller is rejected", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerAskAnything(
    request(),
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
  assertEquals(response.status, 403);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("executeTool scopes qrm_companies, qrm_deals, and predicted_parts_plays to workspace A", async () => {
  const client = new MockAdminClient();

  const companies = await executeTool(
    client as never,
    WORKSPACE_A,
    "search_companies",
    { name: "Corp" },
    async () => [0, 0, 0],
  ) as { matches: Array<Record<string, unknown>> };
  assertEquals(companies.matches.every((row) => row.workspace_id === WORKSPACE_A), true);
  assertEquals(companies.matches.some((row) => row.workspace_id === WORKSPACE_B), false);

  const deals = await executeTool(
    client as never,
    WORKSPACE_A,
    "list_deals",
    {},
    async () => [0, 0, 0],
  ) as { deals: Array<Record<string, unknown>> };
  assertEquals(deals.deals.length, 1);
  assertEquals(deals.deals[0]?.id, "deal-a");

  const plays = await executeTool(
    client as never,
    WORKSPACE_A,
    "recent_predictive_plays",
    {},
    async () => [0, 0, 0],
  ) as { plays: Array<Record<string, unknown>> };
  assertEquals(plays.plays.length, 1);
  assertEquals(plays.plays[0]?.workspace_id, WORKSPACE_A);

  const workspaceFilters = client.filters.filter((f) => f.column === "workspace_id");
  assertEquals(workspaceFilters.every((f) => f.value === WORKSPACE_A), true);
  assertEquals(workspaceFilters.some((f) => f.value === WORKSPACE_B), false);
});

Deno.test("p_workspace is never null for JWT-driven RPC calls", async () => {
  const client = new MockAdminClient();
  await handleOwnerAskAnything(request(), dependencies(client));
  const rpcWithWorkspace = client.rpcCalls.filter((call) => "p_workspace" in call.args);
  assertEquals(rpcWithWorkspace.length, 3);
  assertEquals(
    rpcWithWorkspace.every((call) => call.args.p_workspace === WORKSPACE_A),
    true,
  );
});

Deno.test("real resolver rejects a malformed bearer JWT without mutation", async () => {
  const client = new MockAdminClient();
  const response = await handleOwnerAskAnything(
    request(),
    {
      ...dependencies(client),
      resolveCallerContext,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test({
  name: "owner-ask-anything handler env cleanup",
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
