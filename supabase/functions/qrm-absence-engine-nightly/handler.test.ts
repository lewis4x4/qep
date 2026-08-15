import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleAbsenceEngineNightly,
  resolveAbsenceEngineWorkspaceSelection,
  type AbsenceEngineNightlyDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_absence_engine_nightly_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown; op?: string };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "upsert" | "delete" | "insert" = "select";
  private upsertValues: Record<string, unknown> | null = null;
  private insertValues: Array<Record<string, unknown>> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "eq" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  is(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "is" };
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

  limit(_count: number): this {
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

  delete(): this {
    this.operation = "delete";
    return this;
  }

  insert(values: Array<Record<string, unknown>>): this {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  #selectData(): unknown {
    if (this.table === "crm_deals") {
      const workspaceFilter = this.filters.find((filter) =>
        filter.column === "workspace_id"
      );
      if (!workspaceFilter) {
        this.owner.workspaceDiscoveryQueries += 1;
        return [
          { workspace_id: WORKSPACE_A },
          { workspace_id: WORKSPACE_B },
        ];
      }
      const workspaceId = String(workspaceFilter.value);
      return [{
        id: `deal-${workspaceId}`,
        assigned_rep_id: "rep-1",
        amount: 1000,
        expected_close_on: "2026-09-01",
        primary_contact_id: "contact-1",
        company_id: "company-1",
      }];
    }
    if (this.table === "profiles") {
      return [{
        id: "rep-1",
        full_name: "Rep One",
        iron_role: "rep",
      }];
    }
    if (this.table === "knowledge_gaps") {
      return [{ id: "gap-1" }];
    }
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "upsert" && this.upsertValues) {
      this.owner.upserts.push({ table: this.table, payload: this.upsertValues });
      return Promise.resolve({
        data: { id: `run-${this.upsertValues.workspace_id}` },
        error: null,
      }).then(onfulfilled, onrejected);
    }
    if (this.operation === "delete") {
      this.owner.deletes.push({ table: this.table, filters: [...this.filters] });
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }
    if (this.operation === "insert" && this.insertValues) {
      this.owner.inserts.push({ table: this.table, rows: this.insertValues });
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }
    return Promise.resolve({ data: this.#selectData(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  inserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
  deletes: Array<{ table: string; filters: Filter[] }> = [];
  workspaceDiscoveryQueries = 0;
  processedWorkspaces: string[] = [];

  from(table: string): QueryBuilder {
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
): Partial<AbsenceEngineNightlyDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    discoverWorkspacesFromDeals: (async () => {
      client.workspaceDiscoveryQueries += 1;
      return [WORKSPACE_A, WORKSPACE_B];
    }) as never,
    processAbsenceEngineWorkspace: (async (_admin: unknown, workspaceId: string) => {
      client.processedWorkspaces.push(workspaceId);
      client.upserts.push({
        table: "qrm_absence_engine_runs",
        payload: { workspace_id: workspaceId },
      });
      return true;
    }) as never,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/qrm-absence-engine-nightly", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("resolveAbsenceEngineWorkspaceSelection binds JWT callers to active workspace", () => {
  assertEquals(
    resolveAbsenceEngineWorkspaceSelection({
      caller: callerContext(),
      requestedWorkspaceId: null,
    }),
    { ok: true, mode: "single", workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveAbsenceEngineWorkspaceSelection({
      caller: callerContext(),
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, mode: "single", workspaceId: WORKSPACE_A },
  );
  assertEquals(
    resolveAbsenceEngineWorkspaceSelection({
      caller: callerContext({ workspaceId: null }),
      requestedWorkspaceId: null,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("resolveAbsenceEngineWorkspaceSelection keeps service-role unscoped without hints", () => {
  assertEquals(
    resolveAbsenceEngineWorkspaceSelection({
      caller: callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
      requestedWorkspaceId: null,
    }),
    { ok: true, mode: "service_unscoped" },
  );
});

Deno.test("resolveAbsenceEngineWorkspaceSelection honors service-role workspace hints", () => {
  assertEquals(
    resolveAbsenceEngineWorkspaceSelection({
      caller: callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: WORKSPACE_B,
      }),
      requestedWorkspaceId: null,
    }),
    { ok: true, mode: "single", workspaceId: WORKSPACE_B },
  );
  assertEquals(
    resolveAbsenceEngineWorkspaceSelection({
      caller: callerContext({
        authHeader: `Bearer ${SERVICE_ROLE_KEY}`,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, mode: "single", workspaceId: WORKSPACE_B },
  );
});

Deno.test("JWT omit uses caller workspace and never writes shop B", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
    request(),
    dependencies(client),
  );
  assertEquals(response.status, 200);
  assertEquals(client.processedWorkspaces, [WORKSPACE_A]);
  assertEquals(client.workspaceDiscoveryQueries, 0);
  assertEquals(
    client.upserts.every((row) => row.payload.workspace_id === WORKSPACE_A),
    true,
  );
});

Deno.test("JWT forged workspace in body is ignored and stays on caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
    request({ workspace: WORKSPACE_B }),
    dependencies(client),
  );
  assertEquals(response.status, 200);
  assertEquals(client.processedWorkspaces, [WORKSPACE_A]);
  assertEquals(client.workspaceDiscoveryQueries, 0);
  assertEquals(
    client.upserts.every((row) => row.payload.workspace_id === WORKSPACE_A),
    true,
  );
});

Deno.test("JWT missing active workspace returns 403 before crm_deals reads", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
    request(),
    dependencies(client, callerContext({ workspaceId: null })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.processedWorkspaces.length, 0);
  assertEquals(client.workspaceDiscoveryQueries, 0);
  assertEquals(client.filters.length, 0);
});

Deno.test("rep role is forbidden before crm_deals reads", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
    request(),
    dependencies(client, callerContext({ role: "rep" })),
  );
  assertEquals(response.status, 403);
  assertEquals(client.processedWorkspaces.length, 0);
  assertEquals(client.workspaceDiscoveryQueries, 0);
  assertEquals(client.filters.length, 0);
});

Deno.test("service-role unscoped still walks multiple workspaces", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
    request(),
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
  assertEquals(client.processedWorkspaces, [WORKSPACE_A, WORKSPACE_B]);
  assertEquals(client.workspaceDiscoveryQueries, 1);
});

Deno.test("service-role explicit workspace in body narrows to one workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
    request({ workspace: WORKSPACE_B }),
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
  assertEquals(client.processedWorkspaces, [WORKSPACE_B]);
  assertEquals(client.workspaceDiscoveryQueries, 0);
});

Deno.test("service-role x-workspace-id header narrows to one workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleAbsenceEngineNightly(
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
  assertEquals(response.status, 200);
  assertEquals(client.processedWorkspaces, [WORKSPACE_B]);
  assertEquals(client.workspaceDiscoveryQueries, 0);
});

Deno.test({
  name: "qrm-absence-engine-nightly handler env cleanup",
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
