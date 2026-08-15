import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handlePortalNotificationRefresh,
  resolvePortalNotificationRefreshScope,
  type PortalNotificationRefreshDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "sb_secret_portal_notification_refresh_test_only";
const INTERNAL_SECRET = "internal-secret-portal-notification-refresh";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
Deno.env.set("INTERNAL_SERVICE_SECRET", INTERNAL_SECRET);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = { table: string; column: string; value: unknown };

const FLEET_ROWS = [
  {
    id: "fleet-a",
    workspace_id: WORKSPACE_A,
    portal_customer_id: "portal-customer-a",
    make: "John Deere",
    model: "8R 370",
    next_service_due: "2026-08-20",
    is_active: true,
  },
  {
    id: "fleet-b",
    workspace_id: WORKSPACE_B,
    portal_customer_id: "portal-customer-b",
    make: "Case IH",
    model: "Magnum 340",
    next_service_due: "2026-08-20",
    is_active: true,
  },
];

const EQUIPMENT_ROWS = [
  {
    id: "equipment-a",
    workspace_id: WORKSPACE_A,
    make: "John Deere",
    model: "8R 370",
    year: 2024,
    vin_pin: "JD-001",
    availability: "available",
    ownership: "dealer",
    updated_at: "2026-08-15T10:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    deleted_at: null,
  },
  {
    id: "equipment-b",
    workspace_id: WORKSPACE_B,
    make: "Case IH",
    model: "Magnum 340",
    year: 2024,
    vin_pin: "CI-001",
    availability: "available",
    ownership: "dealer",
    updated_at: "2026-08-15T10:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    deleted_at: null,
  },
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "insert" = "select";
  private insertValues: Record<string, unknown> | null = null;

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

  neq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "neq" };
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

  or(_expression: string): this {
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  #workspaceFilter(): string | undefined {
    const filter = this.filters.find((entry) => entry.column === "workspace_id");
    return typeof filter?.value === "string" ? filter.value : undefined;
  }

  #rows(): unknown[] {
    const workspace = this.#workspaceFilter();

    if (this.table === "customer_fleet") {
      const rows = workspace
        ? FLEET_ROWS.filter((row) => row.workspace_id === workspace)
        : FLEET_ROWS;
      return rows.filter((row) => row.is_active);
    }

    if (this.table === "crm_equipment") {
      const rows = workspace
        ? EQUIPMENT_ROWS.filter((row) => row.workspace_id === workspace)
        : EQUIPMENT_ROWS;
      return rows.filter((row) =>
        row.availability === "available" &&
        row.ownership !== "customer_owned" &&
        row.deleted_at === null
      );
    }

    if (
      this.table === "portal_customer_notifications" &&
      this.operation === "insert"
    ) {
      this.owner.inserts.push({
        table: this.table,
        payload: this.insertValues ?? {},
      });
      return [];
    }

    return [];
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.#rows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer manager-token",
    userId: "user-manager-1",
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
): Partial<PortalNotificationRefreshDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    isServiceRoleCaller: ((req: Request) => {
      const auth = req.headers.get("authorization") ?? "";
      const internal = req.headers.get("x-internal-service-secret") ?? "";
      return auth === `Bearer ${SERVICE_ROLE_KEY}` ||
        internal === INTERNAL_SECRET;
    }) as never,
    insertPortalCustomerNotification: (async () => "inserted") as never,
  };
}

function tableFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) => filter.table === table);
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return tableFilters(client, table).filter((filter) =>
    filter.column === "workspace_id"
  );
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/portal-notification-refresh", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

Deno.test("resolvePortalNotificationRefreshScope binds JWT callers to active workspace", () => {
  assertEquals(
    resolvePortalNotificationRefreshScope({
      caller: callerContext(),
      isServiceRole: false,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_A } },
  );
  assertEquals(
    resolvePortalNotificationRefreshScope({
      caller: callerContext(),
      isServiceRole: false,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_A } },
  );
});

Deno.test("resolvePortalNotificationRefreshScope rejects JWT callers without active workspace", () => {
  assertEquals(
    resolvePortalNotificationRefreshScope({
      caller: callerContext({ workspaceId: null }),
      isServiceRole: false,
      requestedWorkspaceId: null,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("resolvePortalNotificationRefreshScope keeps service cron unscoped without workspace hint", () => {
  assertEquals(
    resolvePortalNotificationRefreshScope({
      caller: callerContext({
        isServiceRole: true,
        workspaceId: null,
        role: null,
        userId: null,
      }),
      isServiceRole: true,
      requestedWorkspaceId: null,
    }),
    { ok: true, scope: { mode: "all" } },
  );
});

Deno.test("resolvePortalNotificationRefreshScope scopes service callers with explicit workspace hint", () => {
  assertEquals(
    resolvePortalNotificationRefreshScope({
      caller: callerContext({
        isServiceRole: true,
        workspaceId: null,
        role: null,
        userId: null,
      }),
      isServiceRole: true,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, scope: { mode: "workspace", workspaceId: WORKSPACE_B } },
  );
});

Deno.test("JWT shop A scopes fleet and equipment queries to workspace A", async () => {
  const client = new MockAdminClient();
  const response = await handlePortalNotificationRefresh(
    request({}, { Authorization: "Bearer manager-token" }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    workspaceFilters(client, "customer_fleet").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    workspaceFilters(client, "crm_equipment").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
});

Deno.test("JWT forged body.workspace is ignored and stays on shop A", async () => {
  const client = new MockAdminClient();
  const response = await handlePortalNotificationRefresh(
    request({
      workspace: WORKSPACE_B,
      workspace_id: WORKSPACE_B,
    }, { Authorization: "Bearer manager-token" }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    workspaceFilters(client, "customer_fleet").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    workspaceFilters(client, "crm_equipment").every((filter) =>
      filter.value === WORKSPACE_A
    ),
    true,
  );
});

Deno.test("JWT missing active workspace returns 403 before table access", async () => {
  const client = new MockAdminClient();
  const response = await handlePortalNotificationRefresh(
    request({}, { Authorization: "Bearer manager-token" }),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(tableFilters(client, "customer_fleet").length, 0);
  assertEquals(tableFilters(client, "crm_equipment").length, 0);
});

Deno.test("service-role without hint keeps unscoped cron contract", async () => {
  const client = new MockAdminClient();
  const response = await handlePortalNotificationRefresh(
    request({}, { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
    dependencies(
      client,
      callerContext({
        isServiceRole: true,
        workspaceId: null,
        role: null,
        userId: null,
      }),
      true,
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "all" });
  assertEquals(workspaceFilters(client, "customer_fleet").length, 0);
  assertEquals(workspaceFilters(client, "crm_equipment").length, 0);
});

Deno.test("JWT shop A does not insert notifications for shop B fleet rows", async () => {
  const client = new MockAdminClient();
  const inserts: Array<{ workspace_id: string; portal_customer_id: string }> =
    [];

  await handlePortalNotificationRefresh(
    request({}, { Authorization: "Bearer manager-token" }),
    {
      ...dependencies(client),
      insertPortalCustomerNotification: (async (
        _supabase: unknown,
        input: { workspace_id: string; portal_customer_id: string | null },
      ) => {
        inserts.push({
          workspace_id: input.workspace_id,
          portal_customer_id: input.portal_customer_id ?? "",
        });
        return "inserted";
      }) as never,
    },
  );

  assertEquals(
    inserts.every((row) => row.workspace_id === WORKSPACE_A),
    true,
  );
  assertEquals(
    inserts.some((row) => row.portal_customer_id === "portal-customer-b"),
    false,
  );
});

if (originalServiceRoleKey === undefined) {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
} else {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
}
if (originalInternalSecret === undefined) {
  Deno.env.delete("INTERNAL_SERVICE_SECRET");
} else {
  Deno.env.set("INTERNAL_SERVICE_SECRET", originalInternalSecret);
}
