import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type MetaSocialAuthResult,
  handleMetaSocial,
  resolveMetaSocialWorkspace,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";

type Filter = { table: string; column: string; value: unknown };
type InsertRow = { table: string; row: Record<string, unknown> };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private insertRow: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
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

  order(_column: string): this {
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.insertRow = row;
    this.owner.inserts.push({ table: this.table, row });
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
    let data: unknown;
    if (this.table === "social_accounts") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      data = workspace === PROFILE_WORKSPACE
        ? [{ id: "acct-a", platform: "facebook", account_name: "Shop A", is_active: true }]
        : workspace === CRON_WORKSPACE
        ? [{ id: "acct-cron", platform: "instagram", account_name: "Cron Shop", is_active: true }]
        : [];
    } else if (this.table === "social_media_posts" && this.insertRow) {
      data = { id: "post-1", ...this.insertRow };
    } else {
      data = null;
    }
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: InsertRow[] = [];
  fromCalls = 0;

  from(table: string): QueryBuilder {
    this.fromCalls += 1;
    return new QueryBuilder(this, table);
  }
}

function request(
  method: string,
  action: string,
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  const init: RequestInit = {
    method,
    headers: { ...headers },
  };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json", ...init.headers as Record<string, string> };
    init.body = JSON.stringify(body);
  }
  return new Request(`https://example.test/functions/v1/meta-social/${action}`, init);
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter(
    (filter) => filter.table === table && filter.column === "workspace_id",
  );
}

function dependencies(
  client: MockAdminClient,
  authResult: MetaSocialAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<MetaSocialAuthResult>;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
  };
}

Deno.test("resolveMetaSocialWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveMetaSocialWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    PROFILE_WORKSPACE,
  );
});

Deno.test("resolveMetaSocialWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolveMetaSocialWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    CRON_WORKSPACE,
  );
});

Deno.test("resolveMetaSocialWorkspace defaults service-role callers to default workspace", () => {
  assertEquals(
    resolveMetaSocialWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    "default",
  );
});

Deno.test("missing auth returns 401 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleMetaSocial(
    request("POST", "post", {
      platform: "facebook",
      content_text: "hello",
      workspace_id: FORGED_WORKSPACE,
    }),
    dependencies(client, { ok: false }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.fromCalls, 0);
  assertEquals(client.inserts.length, 0);
});

Deno.test("JWT caller with forged workspace_id writes to profile workspace on POST /post", async () => {
  const client = new MockAdminClient();
  const response = await handleMetaSocial(
    request(
      "POST",
      "post",
      {
        platform: "facebook",
        content_text: "New listing",
        workspace_id: FORGED_WORKSPACE,
      },
      { Authorization: "Bearer owner-token" },
    ),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      workspaceId: PROFILE_WORKSPACE,
      role: "owner",
    }),
  );

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.post.workspace_id, PROFILE_WORKSPACE);
  assertEquals(
    client.inserts.some(
      (insert) =>
        insert.table === "social_media_posts" &&
        insert.row.workspace_id === PROFILE_WORKSPACE,
    ),
    true,
  );
  assertEquals(
    client.inserts.some(
      (insert) =>
        insert.table === "social_media_posts" &&
        insert.row.workspace_id === FORGED_WORKSPACE,
    ),
    false,
  );
});

Deno.test("JWT caller with forged workspace_id writes to profile workspace on POST /schedule", async () => {
  const client = new MockAdminClient();
  const response = await handleMetaSocial(
    request(
      "POST",
      "schedule",
      {
        platform: "instagram",
        content_text: "Scheduled listing",
        scheduled_at: "2026-08-15T12:00:00.000Z",
        workspace_id: FORGED_WORKSPACE,
      },
      { Authorization: "Bearer owner-token" },
    ),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      workspaceId: PROFILE_WORKSPACE,
      role: "owner",
    }),
  );

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.post.workspace_id, PROFILE_WORKSPACE);
});

Deno.test("JWT GET /accounts filters to profile workspace only", async () => {
  const client = new MockAdminClient();
  const response = await handleMetaSocial(
    request("GET", "accounts", undefined, { Authorization: "Bearer owner-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      workspaceId: PROFILE_WORKSPACE,
      role: "admin",
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.accounts.length, 1);
  assertEquals(body.accounts[0].account_name, "Shop A");
  assertEquals(
    workspaceFilters(client, "social_accounts").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "social_accounts").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
});

Deno.test("service-role caller can target an explicit workspace on POST /post", async () => {
  const client = new MockAdminClient();
  const response = await handleMetaSocial(
    request(
      "POST",
      "post",
      {
        platform: "facebook",
        content_text: "Cron post",
        workspace_id: CRON_WORKSPACE,
      },
      { Authorization: "Bearer service-role-token" },
    ),
    dependencies(client, { ok: true, isServiceRole: true }),
  );

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.post.workspace_id, CRON_WORKSPACE);
  assertEquals(
    client.inserts.some(
      (insert) =>
        insert.table === "social_media_posts" &&
        insert.row.workspace_id === CRON_WORKSPACE,
    ),
    true,
  );
});

Deno.test("service-role caller can target an explicit workspace on GET /accounts", async () => {
  const client = new MockAdminClient();
  const response = await handleMetaSocial(
    request("GET", "accounts", undefined, { Authorization: "Bearer service-role-token" }),
    dependencies(client, { ok: true, isServiceRole: true }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.accounts.length, 0);
  assertEquals(
    workspaceFilters(client, "social_accounts").some((filter) => filter.value === "default"),
    true,
  );
});
