import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  handleWatchdogRequest,
  resolveWatchdogWorkspace,
  type CheckOutcome,
  type SourceRow,
  type WatchdogAuthResult,
} from "./handler.ts";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";
const FORGED_WORKSPACE = "workspace-forged";
const SOURCE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SOURCE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SERVICE_KEY = "service-role-token";

Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = { table: string; column: string; value: unknown };

const overdueSource = (row: Partial<SourceRow> & Pick<SourceRow, "id" | "workspace_id">): SourceRow => ({
  brand_id: "brand-1",
  label: "Test source",
  url: null,
  check_freq_hours: 24,
  last_checked_at: null,
  last_hash: null,
  last_etag: null,
  last_http_status: null,
  last_error: null,
  consecutive_failures: 0,
  active: true,
  ...row,
});

const sheetSources: SourceRow[] = [
  overdueSource({ id: SOURCE_A, workspace_id: WORKSPACE_A }),
  overdueSource({ id: SOURCE_B, workspace_id: WORKSPACE_B }),
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
    private readonly operation: "select" | "insert" | "update",
  ) {}

  select(_columns: string): this {
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

  insert(payload: Record<string, unknown>): QueryBuilder {
    this.owner.inserts.push({ table: this.table, payload });
    return new QueryBuilder(this.owner, this.table, "insert");
  }

  update(payload: Record<string, unknown>): QueryBuilder {
    const builder = new QueryBuilder(this.owner, this.table, "update");
    builder.owner.updates.push({ table: this.table, payload, filters: [...this.filters] });
    return builder;
  }

  #resolveRows(): unknown {
    if (this.table !== "qb_brand_sheet_sources" || this.operation !== "select") {
      return this.operation === "select" ? [] : null;
    }

    let rows = [...sheetSources];
    for (const filter of this.filters) {
      rows = rows.filter((row) =>
        (row as Record<string, unknown>)[filter.column] === filter.value
      );
    }

    const sourceId = this.filters.find((filter) => filter.column === "id")?.value;
    if (sourceId) {
      return rows.find((row) => row.id === sourceId) ?? null;
    }

    return rows;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.#resolveRows();
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Filter[];
  }> = [];
  fromCalls = 0;

  from(table: string): QueryBuilder {
    this.fromCalls += 1;
    return new QueryBuilder(this, table, "select");
  }
}

function jwtAuth(workspaceId = WORKSPACE_A): WatchdogAuthResult {
  return {
    ok: true,
    isServiceRole: false,
    userId: "user-admin-1",
    role: "admin",
    workspaceId,
  };
}

function serviceRoleAuth(headerWorkspaceId: string | null = null): WatchdogAuthResult {
  return {
    ok: true,
    isServiceRole: true,
    headerWorkspaceId,
  };
}

function dependencies(
  client: MockAdminClient,
  authResult: WatchdogAuthResult,
) {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    processSource: (async (): Promise<CheckOutcome> => ({
      kind: "error",
      message: "Source has no URL configured",
      stage: "config",
    })) as never,
  };
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/qb-price-sheet-watchdog", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers as Record<string, string>,
    },
    body: JSON.stringify(body ?? {}),
  });
}

function sourceFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) => filter.table === "qb_brand_sheet_sources");
}

Deno.test("resolveWatchdogWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveWatchdogWorkspace({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolveWatchdogWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolveWatchdogWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("JWT batch only loads sources for profile workspace A", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ batch: true }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(
    sourceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    sourceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_B
    ),
    false,
  );
  assertEquals(body.results[0]?.sourceId, SOURCE_A);
});

Deno.test("JWT empty-body batch only loads sources for profile workspace A", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({}),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(
    sourceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_A
    ),
    true,
  );
});

Deno.test("JWT forged body.workspace does not retarget batch", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ batch: true, workspace: FORGED_WORKSPACE }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(
    sourceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    sourceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === FORGED_WORKSPACE
    ),
    false,
  );
  assertEquals(body.results[0]?.sourceId, SOURCE_A);
});

Deno.test("JWT sourceId for shop B returns 404 without processing", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ sourceId: SOURCE_B, manualTrigger: true }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );

  assertEquals(response.status, 404);
  assertEquals(client.inserts.length, 0);
  assertEquals(client.updates.length, 0);
});

Deno.test("JWT sourceId for shop A is allowed", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ sourceId: SOURCE_A, manualTrigger: true }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(body.results[0]?.sourceId, SOURCE_A);
});

Deno.test("service-role cron batch remains unscoped", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({}, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, serviceRoleAuth()),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 2);
  assertEquals(
    sourceFilters(client).some((filter) => filter.column === "workspace_id"),
    false,
  );
  assertEquals(body.results.map((entry: { sourceId: string }) => entry.sourceId).sort(), [
    SOURCE_A,
    SOURCE_B,
  ]);
});

Deno.test("401 returns before any source query", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ batch: true }),
    dependencies(client, { ok: false, status: 401, message: "Unauthorized" }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.fromCalls, 0);
});

Deno.test("403 returns before any source query", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ batch: true }),
    dependencies(client, { ok: false, status: 403, message: "Forbidden" }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("JWT without active workspace returns 403 before source query", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ batch: true }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: "",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("service-role honors body.workspace to narrow batch", async () => {
  const client = new MockAdminClient();
  const response = await handleWatchdogRequest(
    request({ workspace: WORKSPACE_B }),
    dependencies(client, serviceRoleAuth()),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.processed, 1);
  assertEquals(
    sourceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_B
    ),
    true,
  );
  assertEquals(body.results[0]?.sourceId, SOURCE_B);
});
