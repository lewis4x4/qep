import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  gatherPrepData,
  handlePrepSheet,
  resolvePrepSheetWorkspace,
  type PrepData,
  type PrepSheetDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_prep_sheet_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown; op?: string };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "eq" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  ilike(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "ilike" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  or(_expression: string): this {
    return this;
  }

  is(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "is" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    const filter = { table: this.table, column, value: `${operator}:${value}`, op: "not" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  in(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "in" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  single(): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
    const nameFilter = this.filters.find((filter) =>
      filter.column === "name" && filter.op === "ilike"
    )?.value;

    let data: unknown = null;

    if (this.table === "crm_companies") {
      if (workspace === WORKSPACE_A && nameFilter === "%Acme Corp%") {
        data = [{
          id: "company-a-1",
          name: "Acme Corp",
          industry: "Construction",
          website: null,
          phone: "555-0001",
          city: "Austin",
          state: "TX",
          metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
        }];
      } else if (workspace === WORKSPACE_B && nameFilter === "%Only In Shop B%") {
        data = [{
          id: "company-b-1",
          name: "Only In Shop B",
          industry: "Mining",
          website: null,
          phone: "555-9999",
          city: "Denver",
          state: "CO",
          metadata: {},
          created_at: "2026-01-01T00:00:00.000Z",
        }];
      } else {
        data = [];
      }
    } else if (
      this.table === "crm_contacts" ||
      this.table === "crm_deals" ||
      this.table === "crm_activities" ||
      this.table === "voice_captures" ||
      this.table === "crm_equipment"
    ) {
      data = [];
    } else if (this.table === "competitive_mentions") {
      data = [];
    } else if (this.table === "market_valuations") {
      data = [];
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  fromCalls = 0;

  from(table: string): QueryBuilder {
    this.fromCalls += 1;
    return new QueryBuilder(this, table);
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-1",
    role: "rep",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
): Partial<PrepSheetDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    generatePrepSheet: (async (_data: PrepData) => "# Prep Sheet\nScoped safely.") as never,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/prep-sheet", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === table && filter.column === "workspace_id" && filter.op === "eq"
  );
}

Deno.test("resolvePrepSheetWorkspace binds JWT callers to active workspace", () => {
  assertEquals(
    resolvePrepSheetWorkspace({
      isServiceRole: false,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: null,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolvePrepSheetWorkspace({
      isServiceRole: false,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolvePrepSheetWorkspace({
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

Deno.test("JWT omit uses caller workspace for company/contact/deal/activity/voice queries", async () => {
  const client = new MockAdminClient();
  const response = await handlePrepSheet(
    request({ entity_type: "company", name: "Acme Corp" }),
    dependencies(client),
  );

  assertEquals(response.status, 200);
  for (const table of [
    "crm_companies",
    "crm_contacts",
    "crm_deals",
    "crm_activities",
    "voice_captures",
    "crm_equipment",
  ]) {
    assertEquals(
      workspaceFilters(client, table).some((filter) => filter.value === WORKSPACE_A),
      true,
      `expected ${table} workspace filter for shop A`,
    );
    assertEquals(
      workspaceFilters(client, table).some((filter) => filter.value === WORKSPACE_B),
      false,
      `did not expect ${table} workspace filter for shop B`,
    );
  }
});

Deno.test("JWT forged workspace in body is ignored and stays on caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handlePrepSheet(
    request({
      entity_type: "company",
      name: "Acme Corp",
      workspace: WORKSPACE_B,
      workspace_id: WORKSPACE_B,
    }),
    dependencies(client),
  );

  assertEquals(response.status, 200);
  assertEquals(
    workspaceFilters(client, "crm_companies").every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(
    workspaceFilters(client, "crm_contacts").every((filter) => filter.value === WORKSPACE_A),
    true,
  );
});

Deno.test("JWT company name that only exists in shop B returns 404 without leak", async () => {
  const client = new MockAdminClient();
  const response = await handlePrepSheet(
    request({ entity_type: "company", name: "Only In Shop B" }),
    dependencies(client, callerContext({ workspaceId: WORKSPACE_A })),
  );

  assertEquals(response.status, 404);
  assertEquals(
    workspaceFilters(client, "crm_companies").some((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(
    workspaceFilters(client, "crm_contacts").length,
    0,
    "contact query should not run after company miss",
  );
  assertEquals(
    workspaceFilters(client, "crm_deals").length,
    0,
    "deal query should not run after company miss",
  );
  assertEquals(
    workspaceFilters(client, "crm_activities").length,
    0,
    "activity query should not run after company miss",
  );
  assertEquals(
    workspaceFilters(client, "voice_captures").length,
    0,
    "voice query should not run after company miss",
  );
});

Deno.test("JWT missing active workspace returns 403 before company lookup", async () => {
  const client = new MockAdminClient();
  const response = await handlePrepSheet(
    request({ entity_type: "company", name: "Acme Corp" }),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("invalid JWT authentication returns 401 without company lookup", async () => {
  const client = new MockAdminClient();
  const response = await handlePrepSheet(
    request({ entity_type: "company", name: "Acme Corp" }),
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
  assertEquals(client.fromCalls, 0);
});

Deno.test("forbidden role returns 403 without company lookup", async () => {
  const client = new MockAdminClient();
  const response = await handlePrepSheet(
    request({ entity_type: "company", name: "Acme Corp" }),
    dependencies(client, callerContext({ role: "technician" as never })),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("gatherPrepData scopes company child queries to workspace", async () => {
  const client = new MockAdminClient();
  const data = await gatherPrepData(client, WORKSPACE_A, "company", "Acme Corp");

  assertEquals(data?.entity_name, "Acme Corp");
  for (const table of [
    "crm_companies",
    "crm_contacts",
    "crm_deals",
    "crm_activities",
    "voice_captures",
    "crm_equipment",
  ]) {
    assertEquals(
      workspaceFilters(client, table).some((filter) => filter.value === WORKSPACE_A),
      true,
      `expected ${table} workspace filter`,
    );
  }
});

Deno.test({
  name: "prep-sheet handler env cleanup",
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
