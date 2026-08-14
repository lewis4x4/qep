import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  applyWorkspaceFilter,
  authenticatePartsEmbedBackfill,
  handlePartsEmbedBackfill,
  type PartsEmbedBackfillAuthResult,
  resolvePartsEmbedBackfillWorkspace,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-shop-a";
const FORGED_WORKSPACE = "workspace-shop-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SERVICE_CRON_RUNS_DISABLED", "true");

type Filter = { table: string; column: string; value: unknown };

const BACKLOG_BY_WORKSPACE: Record<string, Array<Record<string, unknown>>> = {
  [PROFILE_WORKSPACE]: [{
    id: "part-a-1",
    workspace_id: PROFILE_WORKSPACE,
    part_number: "A-100",
    description: "Hydraulic filter",
    manufacturer: "OEM",
    vendor_code: null,
    machine_code: null,
    model_code: null,
    category: "filters",
    category_code: null,
  }],
  [FORGED_WORKSPACE]: [{
    id: "part-b-1",
    workspace_id: FORGED_WORKSPACE,
    part_number: "B-200",
    description: "Other shop part",
    manufacturer: "OEM",
    vendor_code: null,
    machine_code: null,
    model_code: null,
    category: "filters",
    category_code: null,
  }],
};

class QueryBuilder implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  readonly filters: Filter[] = [];
  private countMode = false;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string, options?: { count?: string; head?: boolean }): this {
    if (options?.count === "exact" && options?.head) {
      this.countMode = true;
    }
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  in(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
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

  then<TResult1 = { data: unknown; error: null; count?: number }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    let data: unknown;
    let count: number | undefined;

    if (this.table === "v_parts_embedding_backlog") {
      const workspaceFilter = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      if (typeof workspaceFilter === "string") {
        const rows = BACKLOG_BY_WORKSPACE[workspaceFilter] ?? [];
        data = rows;
        count = rows.length;
      } else {
        const rows = Object.values(BACKLOG_BY_WORKSPACE).flat();
        data = rows;
        count = rows.length;
      }
    } else if (this.table === "v_machine_parts_connections") {
      data = [];
    } else {
      data = [];
    }

    const result = this.countMode ? { data: null, error: null, count } : { data, error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(_name: string, _args: Record<string, unknown>): Promise<{ data: { rows_updated: number }; error: null }> {
    return Promise.resolve({ data: { rows_updated: 1 }, error: null });
  }
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/parts-embed-backfill", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === table && filter.column === "workspace_id"
  );
}

function dependencies(
  client: MockAdminClient,
  authResult: PartsEmbedBackfillAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<PartsEmbedBackfillAuthResult>;
  embedTexts: (texts: string[]) => Promise<number[][]>;
  sleep: () => Promise<void>;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    embedTexts: async (texts: string[]) => texts.map(() => Array(1536).fill(0.1)),
    sleep: async () => {},
  };
}

Deno.test("resolvePartsEmbedBackfillWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolvePartsEmbedBackfillWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolvePartsEmbedBackfillWorkspace scopes JWT to active workspace when body omits workspace", () => {
  assertEquals(
    resolvePartsEmbedBackfillWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolvePartsEmbedBackfillWorkspace allows service-role unscoped cron", () => {
  assertEquals(
    resolvePartsEmbedBackfillWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("resolvePartsEmbedBackfillWorkspace allows service-role explicit body workspace", () => {
  assertEquals(
    resolvePartsEmbedBackfillWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: CRON_WORKSPACE,
      headerWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("resolvePartsEmbedBackfillWorkspace allows service-role x-workspace-id header", () => {
  assertEquals(
    resolvePartsEmbedBackfillWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("applyWorkspaceFilter adds workspace_id eq for scoped mode", () => {
  const filters: Filter[] = [];
  const query = {
    eq(column: string, value: string) {
      filters.push({ table: "test", column, value });
      return this;
    },
  };
  applyWorkspaceFilter(query, { mode: "scoped", workspaceId: PROFILE_WORKSPACE });
  assertEquals(filters, [{ table: "test", column: "workspace_id", value: PROFILE_WORKSPACE }]);
});

Deno.test("applyWorkspaceFilter leaves query unchanged for unscoped mode", () => {
  const filters: Filter[] = [];
  const query = {
    eq(column: string, value: string) {
      filters.push({ table: "test", column, value });
      return this;
    },
  };
  applyWorkspaceFilter(query, { mode: "unscoped" });
  assertEquals(filters, []);
});

Deno.test("JWT caller without body.workspace only processes active workspace backlog", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsEmbedBackfill(
    request({ max_batches: 1 }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      role: "owner",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(body.rows_embedded, 1);
  assertEquals(
    workspaceFilters(client, "v_parts_embedding_backlog").every((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "v_parts_embedding_backlog").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
});

Deno.test("JWT caller with forged body.workspace still only processes active workspace", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsEmbedBackfill(
    request({ max_batches: 1, workspace: FORGED_WORKSPACE }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      role: "owner",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(body.rows_embedded, 1);
  assertEquals(
    workspaceFilters(client, "v_parts_embedding_backlog").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
  assertEquals(
    workspaceFilters(client, "v_parts_embedding_backlog").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
});

Deno.test("service-role unscoped cron can process backlog across workspaces", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsEmbedBackfill(
    request({ max_batches: 1 }),
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
  assertEquals(workspaceFilters(client, "v_parts_embedding_backlog").length, 0);
  assertEquals(body.batches, 1);
});

Deno.test("service-role explicit workspace narrows backlog", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsEmbedBackfill(
    request({ max_batches: 1, workspace: FORGED_WORKSPACE }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, FORGED_WORKSPACE);
  assertEquals(body.rows_embedded, 1);
  assertEquals(
    workspaceFilters(client, "v_parts_embedding_backlog").some((filter) => filter.value === FORGED_WORKSPACE),
    true,
  );
});

Deno.test("authenticatePartsEmbedBackfill returns 401 for missing credentials", async () => {
  const result = await authenticatePartsEmbedBackfill(
    new Request("https://example.test", { method: "POST" }),
    null,
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 401);
  }
});

Deno.test("handler returns 401 when authenticate fails with 401", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsEmbedBackfill(
    request(),
    dependencies(client, {
      ok: false,
      status: 401,
      message: "Missing authorization",
    }),
  );
  assertEquals(response.status, 401);
});

Deno.test("handler returns 403 when authenticate fails with 403", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsEmbedBackfill(
    request(),
    dependencies(client, {
      ok: false,
      status: 403,
      message: "parts-embed-backfill requires admin/manager/owner role",
    }),
  );
  assertEquals(response.status, 403);
});

if (originalServiceRoleKey) {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
}
