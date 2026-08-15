import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleM365MailboxSync,
  resolveM365MailboxSyncWorkspaceSelection,
  type M365MailboxSyncDependencies,
  type SyncState,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_m365_mailbox_sync_test_only";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = { table: string; column: string; value: unknown; op?: string };

const SYNC_ROWS: SyncState[] = [
  {
    id: "sync-a",
    user_id: "user-a",
    access_token: "token-a-encrypted",
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    m365_mail_last_synced_at: null,
    m365_mail_sync_fail_count: 0,
    profiles: {
      active_workspace_id: WORKSPACE_A,
      email: "rep-a@example.test",
    },
  },
  {
    id: "sync-b",
    user_id: "user-b",
    access_token: "token-b-encrypted",
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    m365_mail_last_synced_at: null,
    m365_mail_sync_fail_count: 0,
    profiles: {
      active_workspace_id: WORKSPACE_B,
      email: "rep-b@example.test",
    },
  },
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "update" = "select";
  private updateValues: Record<string, unknown> | null = null;
  private notNullColumn: string | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
    if (this.table === "onedrive_sync_state") {
      this.owner.syncStateSelectQueries += 1;
    }
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.updateValues = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "eq" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is" && value === null) {
      this.notNullColumn = column;
    }
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  #selectData(): unknown {
    if (this.table !== "onedrive_sync_state") return null;

    let rows = SYNC_ROWS.filter((row) => row.access_token !== null);
    const workspaceFilter = this.filters.find((filter) =>
      filter.column === "profiles.active_workspace_id"
    );
    if (workspaceFilter) {
      rows = rows.filter((row) =>
        row.profiles?.active_workspace_id === workspaceFilter.value
      );
    }
    return rows;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "update") {
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
  syncStateSelectQueries = 0;

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer manager-token",
    userId: "manager-1",
    role: "manager",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/m365-mailbox-sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext,
): Partial<M365MailboxSyncDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    decryptOneDriveToken: (async () => "graph-access-token") as never,
    fetchRecentMessages: (async () => []) as never,
    ingestSignalDetailed: (async () => ({ deduped: false, signalId: "signal-1" })) as never,
  };
}

function syncStateWorkspaceFilter(client: MockAdminClient): unknown {
  return client.filters.find((filter) =>
    filter.table === "onedrive_sync_state" &&
    filter.column === "profiles.active_workspace_id"
  )?.value;
}

Deno.test("resolveM365MailboxSyncWorkspaceSelection binds JWT callers to active workspace", () => {
  assertEquals(
    resolveM365MailboxSyncWorkspaceSelection({
      caller: callerContext(),
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, mode: "single", workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolveM365MailboxSyncWorkspaceSelection returns 403 when JWT caller has no workspace", () => {
  assertEquals(
    resolveM365MailboxSyncWorkspaceSelection({
      caller: callerContext({ workspaceId: null }),
      requestedWorkspaceId: WORKSPACE_B,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("resolveM365MailboxSyncWorkspaceSelection keeps service-role cron unscoped without hint", () => {
  assertEquals(
    resolveM365MailboxSyncWorkspaceSelection({
      caller: {
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      },
      requestedWorkspaceId: null,
    }),
    { ok: true, mode: "service_unscoped" },
  );
});

Deno.test("JWT shop A selects only shop A mailbox rows", async () => {
  const client = new MockAdminClient();
  const response = await handleM365MailboxSync(
    request({}),
    dependencies(client, callerContext()),
  );

  assertEquals(response.status, 200);
  assertEquals(syncStateWorkspaceFilter(client), WORKSPACE_A);
  assertEquals(client.syncStateSelectQueries, 1);

  const body = await response.json();
  assertEquals(body.workspaceScope, WORKSPACE_A);
  assertEquals(body.outcomes.length, 1);
  assertEquals(body.outcomes[0].workspaceId, WORKSPACE_A);
  assertEquals(
    body.outcomes.some((outcome: { workspaceId: string | null }) =>
      outcome.workspaceId === WORKSPACE_B
    ),
    false,
  );
});

Deno.test("JWT forged workspace B still scopes to shop A", async () => {
  const client = new MockAdminClient();
  const response = await handleM365MailboxSync(
    request({
      workspace: WORKSPACE_B,
      workspace_id: WORKSPACE_B,
    }),
    dependencies(client, callerContext()),
  );

  assertEquals(response.status, 200);
  assertEquals(syncStateWorkspaceFilter(client), WORKSPACE_A);

  const body = await response.json();
  assertEquals(body.workspaceScope, WORKSPACE_A);
  assertEquals(
    body.outcomes.every((outcome: { workspaceId: string | null }) =>
      outcome.workspaceId !== WORKSPACE_B
    ),
    true,
  );
});

Deno.test("JWT missing workspace returns 403 without onedrive_sync_state select", async () => {
  const client = new MockAdminClient();
  const response = await handleM365MailboxSync(
    request({}),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(client.syncStateSelectQueries, 0);
  assertEquals(client.filters.length, 0);
});

Deno.test("service-role without hint keeps unscoped cron contract", async () => {
  const client = new MockAdminClient();
  const response = await handleM365MailboxSync(
    request({}),
    dependencies(
      client,
      {
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      },
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(syncStateWorkspaceFilter(client), undefined);
  assertEquals(client.syncStateSelectQueries, 1);

  const body = await response.json();
  assertEquals(body.workspaceScope, "all");
  assertEquals(body.outcomes.length, 2);
  assertEquals(
    body.outcomes.some((outcome: { workspaceId: string | null }) =>
      outcome.workspaceId === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    body.outcomes.some((outcome: { workspaceId: string | null }) =>
      outcome.workspaceId === WORKSPACE_B
    ),
    true,
  );
});

Deno.test({
  name: "m365-mailbox-sync handler env cleanup",
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
