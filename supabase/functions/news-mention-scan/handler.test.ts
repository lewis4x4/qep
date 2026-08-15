import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  handleNewsMentionScan,
  resolveNewsMentionWorkspace,
  runScan,
  type NewsMentionAuthResult,
  type NewsMentionScanDependencies,
  type NewsMentionWorkspaceScope,
  type TavilyResult,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORGED_WORKSPACE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_KEY = "service-role-news-mention-test";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("TAVILY_API_KEY", "tavily-test-key");

type Filter = {
  table: string;
  column: string;
  value: unknown;
  op: "eq" | "is" | "gte";
  select?: string;
};

const COMPANIES_BY_WORKSPACE: Record<string, Array<{ id: string; name: string }>> = {
  [WORKSPACE_A]: [{ id: "company-a1", name: "Acme Construction" }],
  [WORKSPACE_B]: [{ id: "company-b1", name: "Beta Equipment" }],
};

const MOCK_NEWS_RESULT: TavilyResult[] = [{
  title: "Acme wins bid",
  url: "https://news.example/acme",
  excerpt: "Acme Construction secured a major project.",
}];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private selectColumns = "";
  private operation: "select" | "upsert" = "select";
  private upsertValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(columns: string): this {
    this.selectColumns = columns;
    this.operation = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter: Filter = {
      table: this.table,
      column,
      value,
      op: "eq",
      select: this.selectColumns,
    };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  is(column: string, value: unknown): this {
    const filter: Filter = {
      table: this.table,
      column,
      value,
      op: "is",
      select: this.selectColumns,
    };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  gte(column: string, value: unknown): this {
    const filter: Filter = {
      table: this.table,
      column,
      value,
      op: "gte",
      select: this.selectColumns,
    };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_value: number): this {
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

    let data: unknown;
    if (this.table === "crm_companies") {
      const columns = this.selectColumns.split(",").map((part) => part.trim());
      const selectsWorkspaceIdOnly = columns.includes("workspace_id") &&
        !columns.includes("id") &&
        !columns.includes("name");
      const workspaceFilter = this.filters.find((f) => f.column === "workspace_id" && f.op === "eq");

      if (selectsWorkspaceIdOnly) {
        data = Object.keys(COMPANIES_BY_WORKSPACE).map((workspaceId) => ({
          workspace_id: workspaceId,
        }));
      } else if (typeof workspaceFilter?.value === "string") {
        data = COMPANIES_BY_WORKSPACE[workspaceFilter.value] ?? [];
      } else {
        data = Object.values(COMPANIES_BY_WORKSPACE).flat();
      }
    } else if (this.table === "iron_web_search_cache") {
      data = null;
    } else {
      data = [];
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  ingestCalls: Array<{ workspaceId: string; entityId: string }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }
}

function workspaceListingQueries(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) => {
    const columns = (filter.select ?? "").split(",").map((part) => part.trim());
    return filter.table === "crm_companies" &&
      columns.includes("workspace_id") &&
      !columns.includes("id") &&
      !columns.includes("name");
  });
}

function companyWorkspaceFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) => {
    const columns = (filter.select ?? "").split(",").map((part) => part.trim());
    return filter.table === "crm_companies" &&
      filter.column === "workspace_id" &&
      filter.op === "eq" &&
      columns.includes("id");
  });
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/news-mention-scan", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function cachedSearchMock(): Promise<TavilyResult[]> {
  return MOCK_NEWS_RESULT;
}

function dependencies(
  client: MockAdminClient,
  auth: NewsMentionAuthResult,
): Partial<NewsMentionScanDependencies> {
  return {
    createAdminClient: (() => client) as never,
    authenticateNewsMentionScan: (async () => auth) as never,
    getTavilyApiKey: () => "tavily-test-key",
    runScan: (async (
      _admin: SupabaseClient,
      _key: string,
      workspaceScope: NewsMentionWorkspaceScope,
      deps?: {
        cachedSearch: typeof cachedSearchMock;
        ingestSignalDetailed: (
          _ctx: unknown,
          input: { workspaceId: string; entityId?: string },
        ) => Promise<{ deduped: boolean }>;
      },
    ) => {
      const admin = client as unknown as SupabaseClient;
      const cachedSearch = deps?.cachedSearch ?? cachedSearchMock;
      const ingestSignalDetailed = deps?.ingestSignalDetailed ??
        (async (_ctx: unknown, input: { workspaceId: string; entityId?: string }) => {
          client.ingestCalls.push({
            workspaceId: input.workspaceId,
            entityId: input.entityId ?? "",
          });
          return { deduped: false };
        });
      return runScan(admin, "tavily-test-key", workspaceScope, {
        cachedSearch,
        ingestSignalDetailed: ingestSignalDetailed as never,
      });
    }) as never,
  };
}

Deno.test("resolveNewsMentionWorkspace binds JWT callers to active workspace", () => {
  assertEquals(
    resolveNewsMentionWorkspace({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveNewsMentionWorkspace({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolveNewsMentionWorkspace defaults service-role to unscoped without hint", () => {
  assertEquals(
    resolveNewsMentionWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("JWT forged or omitted workspace only scans profile workspace A", async () => {
  const client = new MockAdminClient();
  const auth: NewsMentionAuthResult = {
    ok: true,
    isServiceRole: false,
    userId: "user-admin-1",
    role: "admin",
    workspaceId: WORKSPACE_A,
  };

  const forgedResponse = await handleNewsMentionScan(
    request({ workspace: FORGED_WORKSPACE, workspace_id: FORGED_WORKSPACE }),
    dependencies(client, auth),
  );
  assertEquals(forgedResponse.status, 200);
  const forgedBody = await forgedResponse.json();
  assertEquals(forgedBody.workspace_scope, "scoped");
  assertEquals(forgedBody.workspace_id, WORKSPACE_A);
  assertEquals(workspaceListingQueries(client).length, 0);
  assertEquals(companyWorkspaceFilters(client).length, 1);
  assertEquals(companyWorkspaceFilters(client)[0].value, WORKSPACE_A);
  assertEquals(client.ingestCalls.every((call) => call.workspaceId === WORKSPACE_A), true);
  assertEquals(client.ingestCalls.some((call) => call.workspaceId === WORKSPACE_B), false);

  const omitClient = new MockAdminClient();
  const omitResponse = await handleNewsMentionScan(
    request(),
    dependencies(omitClient, auth),
  );
  assertEquals(omitResponse.status, 200);
  const omitBody = await omitResponse.json();
  assertEquals(omitBody.workspace_id, WORKSPACE_A);
  assertEquals(workspaceListingQueries(omitClient).length, 0);
  assertEquals(companyWorkspaceFilters(omitClient)[0].value, WORKSPACE_A);
});

Deno.test("JWT missing workspace returns 403 without crm_companies query", async () => {
  const client = new MockAdminClient();
  const response = await handleNewsMentionScan(
    request({ workspace: FORGED_WORKSPACE }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: "",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.filters.length, 0);
  assertEquals(client.ingestCalls.length, 0);
});

Deno.test("JWT wrong role returns 403", async () => {
  const client = new MockAdminClient();
  const response = await handleNewsMentionScan(
    request(),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.filters.length, 0);
  assertEquals(client.ingestCalls.length, 0);
});

Deno.test("service-role unscoped lists multiple workspaces without single-workspace filter", async () => {
  const client = new MockAdminClient();
  const response = await handleNewsMentionScan(
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
  assertEquals(workspaceListingQueries(client).length, 1);
  assertEquals(companyWorkspaceFilters(client).length, 2);
  assertEquals(
    companyWorkspaceFilters(client).some((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(
    companyWorkspaceFilters(client).some((filter) => filter.value === WORKSPACE_B),
    true,
  );
  assertEquals(client.ingestCalls.some((call) => call.workspaceId === WORKSPACE_A), true);
  assertEquals(client.ingestCalls.some((call) => call.workspaceId === WORKSPACE_B), true);
});

Deno.test("service-role with workspace hint only scans that workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleNewsMentionScan(
    request({ workspace_id: WORKSPACE_A }, {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-workspace-id": WORKSPACE_A,
    }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: WORKSPACE_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, WORKSPACE_A);
  assertEquals(workspaceListingQueries(client).length, 0);
  assertEquals(companyWorkspaceFilters(client).length, 1);
  assertEquals(companyWorkspaceFilters(client)[0].value, WORKSPACE_A);
  assertEquals(client.ingestCalls.every((call) => call.workspaceId === WORKSPACE_A), true);
  assertEquals(client.ingestCalls.some((call) => call.workspaceId === WORKSPACE_B), false);
});

Deno.test({
  name: "news-mention-scan handler env cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    if (originalServiceRoleKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
    }
    Deno.env.delete("TAVILY_API_KEY");
  },
});
