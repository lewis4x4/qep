import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleDataQualityAudit,
  resolveDataQualityAuditScope,
  type DataQualityAuditDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_data_quality_audit_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown };

const WORKSPACE_SCOPED_TABLES = new Set([
  "qrm_equipment",
  "crm_companies",
  "crm_deals",
  "portal_customers",
  "quotes",
  "crm_activities",
]);

class QueryBuilder implements PromiseLike<{ data: unknown; error: null; count: number }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "upsert" = "select";
  private upsertValues: Record<string, unknown> | null = null;
  private headCount = false;
  private selectColumns = "*";

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(columns: string, options?: { count?: string; head?: boolean }): this {
    this.operation = "select";
    this.selectColumns = columns;
    this.headCount = options?.count === "exact" && options?.head === true;
    return this;
  }

  is(column: string, value: unknown): this {
    return this.pushFilter(column, value);
  }

  not(column: string, _operator: string, value: unknown): this {
    return this.pushFilter(column, value);
  }

  or(_expression: string): this {
    return this;
  }

  neq(column: string, value: unknown): this {
    return this.pushFilter(column, value);
  }

  eq(column: string, value: unknown): this {
    return this.pushFilter(column, value);
  }

  lt(column: string, value: unknown): this {
    return this.pushFilter(column, value);
  }

  upsert(values: Record<string, unknown>, _options?: Record<string, unknown>): this {
    this.operation = "upsert";
    this.upsertValues = values;
    return this;
  }

  private pushFilter(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  then<TResult1 = { data: unknown; error: null; count: number }, TResult2 = never>(
    onfulfilled?:
      | ((
        value: { data: unknown; error: null; count: number },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "upsert" && this.upsertValues) {
      this.owner.upserts.push({ table: this.table, payload: this.upsertValues });
      return Promise.resolve({ data: null, error: null, count: 0 }).then(
        onfulfilled,
        onrejected,
      );
    }

    if (this.table === "qrm_equipment" && !this.headCount) {
      return Promise.resolve({
        data: [{ serial_number: "SN-1" }, { serial_number: "SN-1" }],
        error: null,
        count: 2,
      }).then(onfulfilled, onrejected);
    }

    return Promise.resolve({ data: null, error: null, count: 3 }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  fromCalls: string[] = [];

  from(table: string): QueryBuilder {
    this.fromCalls.push(table);
    return new QueryBuilder(this, table);
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-1",
    role: "manager",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
  isServiceRole = caller.isServiceRole,
): Partial<DataQualityAuditDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    isServiceRoleCaller: ((req: Request) => {
      const auth = req.headers.get("Authorization")?.trim();
      return auth === `Bearer ${SERVICE_ROLE_KEY}` ||
        req.headers.get("x-internal-service-secret") === "cron-secret";
    }) as never,
  };
}

function request(
  method: "GET" | "POST",
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
  authHeader = "Bearer user-token",
): Request {
  return new Request("https://example.test/functions/v1/data-quality-audit", {
    method,
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
      ...headers,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function workspaceFiltersForTable(filters: Filter[], table: string): Filter[] {
  return filters.filter((filter) => filter.table === table);
}

function assertWorkspaceScoped(
  filters: Filter[],
  workspaceId: string,
  table: string,
): void {
  const tableFilters = workspaceFiltersForTable(filters, table);
  assertEquals(
    tableFilters.some((filter) =>
      filter.column === "workspace_id" && filter.value === workspaceId
    ),
    true,
    `expected workspace filter on ${table}`,
  );
}

function assertNoWorkspaceScoped(filters: Filter[], table: string): void {
  const tableFilters = workspaceFiltersForTable(filters, table);
  assertEquals(
    tableFilters.some((filter) => filter.column === "workspace_id"),
    false,
    `did not expect workspace filter on ${table}`,
  );
}

Deno.test("resolveDataQualityAuditScope binds JWT callers to active workspace", () => {
  assertEquals(
    resolveDataQualityAuditScope({
      isServiceRole: false,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_A } },
  );
  assertEquals(
    resolveDataQualityAuditScope({
      isServiceRole: false,
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

Deno.test("resolveDataQualityAuditScope keeps service-role unscoped without hint", () => {
  assertEquals(
    resolveDataQualityAuditScope({
      isServiceRole: true,
      callerWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "all" } },
  );
});

Deno.test("resolveDataQualityAuditScope honors service-role workspace hint", () => {
  assertEquals(
    resolveDataQualityAuditScope({
      isServiceRole: true,
      callerWorkspaceId: WORKSPACE_B,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_B } },
  );
  assertEquals(
    resolveDataQualityAuditScope({
      isServiceRole: true,
      callerWorkspaceId: null,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_B } },
  );
});

Deno.test("JWT forged workspace still filters every count query to workspace A", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("GET", { workspace: WORKSPACE_B }),
    dependencies(client),
  );
  assertEquals(response.status, 200);

  for (const table of WORKSPACE_SCOPED_TABLES) {
    assertWorkspaceScoped(client.filters, WORKSPACE_A, table);
  }
  assertEquals(
    client.filters.some((filter) =>
      filter.table === "customer_profiles_extended" &&
      filter.column === "crm_companies.workspace_id" &&
      filter.value === WORKSPACE_A
    ),
    true,
  );
});

Deno.test("JWT missing workspace returns 403 before table access", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("GET"),
    dependencies(client, callerContext({ workspaceId: null })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.fromCalls.length, 0);
});

Deno.test("JWT rep is forbidden", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("GET"),
    dependencies(client, callerContext({ role: "rep" })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.fromCalls.length, 0);
});

Deno.test("JWT POST does not write global exec_data_quality_summary", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("POST", { workspace: WORKSPACE_B }),
    dependencies(client),
  );
  assertEquals(response.status, 200);
  assertEquals(client.upserts.length, 0);
  const payload = await response.json();
  assertEquals(payload.persisted, false);
});

Deno.test("service-role unscoped audit does not apply workspace filters", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("POST", {}, {}, `Bearer ${SERVICE_ROLE_KEY}`),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
      true,
    ),
  );
  assertEquals(response.status, 200);

  for (const table of WORKSPACE_SCOPED_TABLES) {
    assertNoWorkspaceScoped(client.filters, table);
  }
  assertEquals(
    client.filters.some((filter) => filter.column === "crm_companies.workspace_id"),
    false,
  );
  assertEquals(client.upserts.length > 0, true);
  const payload = await response.json();
  assertEquals(payload.persisted, true);
});

Deno.test("service-role with workspace hint scopes filters and skips persist", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("POST", { workspace: WORKSPACE_B }, {}, `Bearer ${SERVICE_ROLE_KEY}`),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
      true,
    ),
  );
  assertEquals(response.status, 200);

  for (const table of WORKSPACE_SCOPED_TABLES) {
    assertWorkspaceScoped(client.filters, WORKSPACE_B, table);
  }
  assertEquals(client.upserts.length, 0);
  const payload = await response.json();
  assertEquals(payload.persisted, false);
});

Deno.test("service-role x-workspace-id header scopes filters", async () => {
  const client = new MockAdminClient();
  const response = await handleDataQualityAudit(
    request("GET", {}, { "x-workspace-id": WORKSPACE_B }, `Bearer ${SERVICE_ROLE_KEY}`),
    dependencies(
      client,
      callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: WORKSPACE_B,
      }),
      true,
    ),
  );
  assertEquals(response.status, 200);
  assertWorkspaceScoped(client.filters, WORKSPACE_B, "qrm_equipment");
});

Deno.test({
  name: "data-quality-audit handler env cleanup",
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
