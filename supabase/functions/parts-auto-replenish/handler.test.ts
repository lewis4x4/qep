import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  applyWorkspaceFilter,
  authenticateAutoReplenish,
  handlePartsAutoReplenish,
  resolveAutoReplenishWorkspace,
  type AutoReplenishAuthResult,
} from "./handler.ts";

const SHOP_A = "workspace-shop-a";
const SHOP_B = "workspace-shop-b";
const FORGED_WORKSPACE = "workspace-forged-b";
const SERVICE_KEY = "service-role-token";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SERVICE_CRON_RUNS_DISABLED", "true");

type Filter = { table: string; column: string; value: unknown; op: "eq" | "in" };

const REORDER_BY_WORKSPACE: Record<string, Array<Record<string, unknown>>> = {
  [SHOP_A]: [{
    workspace_id: SHOP_A,
    branch_id: "branch-a",
    part_number: "PART-A1",
    qty_on_hand: 0,
    reorder_point: 5,
    economic_order_qty: 10,
    consumption_velocity: 1,
  }],
  [SHOP_B]: [{
    workspace_id: SHOP_B,
    branch_id: "branch-b",
    part_number: "PART-B1",
    qty_on_hand: 1,
    reorder_point: 5,
    economic_order_qty: 8,
    consumption_velocity: 1,
  }],
};

const RULES_BY_WORKSPACE: Record<string, Record<string, unknown>> = {
  [SHOP_A]: {
    workspace_id: SHOP_A,
    is_enabled: true,
    auto_approve_max_dollars: 500,
    daily_budget_cap: 0,
    cooldown_days: 3,
    excluded_part_numbers: [],
    vendor_overrides: {},
  },
  [SHOP_B]: {
    workspace_id: SHOP_B,
    is_enabled: true,
    auto_approve_max_dollars: 500,
    daily_budget_cap: 0,
    cooldown_days: 3,
    excluded_part_numbers: [],
    vendor_overrides: {},
  },
};

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string, _options?: Record<string, unknown>): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "eq" as const };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  in(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "in" as const };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  is(_column: string, _value: unknown): this {
    return this;
  }

  gte(_column: string, _value: unknown): this {
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const workspaceFilter = this.filters.find((filter) =>
      filter.column === "workspace_id" && filter.op === "eq"
    )?.value;

    let data: unknown;
    switch (this.table) {
      case "parts_inventory_reorder_status": {
        if (typeof workspaceFilter === "string") {
          data = REORDER_BY_WORKSPACE[workspaceFilter] ?? [];
        } else {
          data = Object.values(REORDER_BY_WORKSPACE).flat();
        }
        break;
      }
      case "parts_replenishment_rules": {
        if (typeof workspaceFilter === "string") {
          const rule = RULES_BY_WORKSPACE[workspaceFilter];
          data = rule ? [rule] : [];
        } else {
          data = Object.values(RULES_BY_WORKSPACE);
        }
        break;
      }
      case "parts_auto_replenish_queue":
      case "vendor_part_catalog":
      case "parts_catalog":
      case "parts_demand_forecasts":
      case "vendor_profiles":
      case "vendor_order_schedules":
      case "parts_vendor_prices":
        data = [];
        break;
      default:
        data = [];
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  queueInserts: Record<string, unknown>[][] = [];

  from(table: string) {
    if (table === "parts_auto_replenish_queue") {
      return {
        select: (_columns: string) => ({
          in: (_column: string, _value: unknown) => ({
            then: <TResult1, TResult2>(
              onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1) | null,
              onrejected?: ((reason: unknown) => TResult2) | null,
            ) => Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected),
            eq: (column: string, value: unknown) => {
              const filter = { table, column, value, op: "eq" as const };
              this.filters.push(filter);
              return {
                then: <TResult1, TResult2>(
                  onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1) | null,
                  onrejected?: ((reason: unknown) => TResult2) | null,
                ) => Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected),
              };
            },
          }),
          eq: (column: string, value: unknown) => {
            const filter = { table, column, value, op: "eq" as const };
            this.filters.push(filter);
            return {
              in: (_column: string, _value: unknown) => ({
                then: <TResult1, TResult2>(
                  onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1) | null,
                  onrejected?: ((reason: unknown) => TResult2) | null,
                ) => Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected),
              }),
            };
          },
        }),
        insert: (rows: Record<string, unknown>[]) => {
          this.queueInserts.push(rows);
          return {
            then: <TResult1, TResult2>(
              onfulfilled?: ((value: { error: null }) => TResult1) | null,
              onrejected?: ((reason: unknown) => TResult2) | null,
            ) => Promise.resolve({ error: null }).then(onfulfilled, onrejected),
          };
        },
      };
    }

    return new QueryBuilder(this, table);
  }
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
  method = "POST",
): Request {
  return new Request("https://example.test/functions/v1/parts-auto-replenish", {
    method,
    headers: { "content-type": "application/json", ...headers as Record<string, string> },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function dependencies(
  client: MockAdminClient,
  authResult: AutoReplenishAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<AutoReplenishAuthResult>;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
  };
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === table && filter.column === "workspace_id" && filter.op === "eq"
  );
}

function insertedWorkspaceIds(client: MockAdminClient): string[] {
  return client.queueInserts.flat().map((row) => String(row.workspace_id));
}

Deno.test("resolveAutoReplenishWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveAutoReplenishWorkspace({
      isServiceRole: false,
      authWorkspaceId: SHOP_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: SHOP_A },
  );
});

Deno.test("resolveAutoReplenishWorkspace allows service-role explicit workspace hint", () => {
  assertEquals(
    resolveAutoReplenishWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: SHOP_A,
      headerWorkspaceId: null,
    }),
    { mode: "scoped", workspaceId: SHOP_A },
  );
});

Deno.test("resolveAutoReplenishWorkspace defaults service-role to unscoped without hint", () => {
  assertEquals(
    resolveAutoReplenishWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: null,
      headerWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("applyWorkspaceFilter adds eq filter only when scoped", () => {
  const scopedCalls: Array<{ column: string; value: string }> = [];
  const scopedQuery = {
    eq(column: string, value: string) {
      scopedCalls.push({ column, value });
      return scopedQuery;
    },
  };
  applyWorkspaceFilter(scopedQuery, { mode: "scoped", workspaceId: SHOP_A });
  assertEquals(scopedCalls, [{ column: "workspace_id", value: SHOP_A }]);

  const unscopedCalls: Array<{ column: string; value: string }> = [];
  const unscopedQuery = {
    eq(column: string, value: string) {
      unscopedCalls.push({ column, value });
      return unscopedQuery;
    },
  };
  applyWorkspaceFilter(unscopedQuery, { mode: "unscoped" });
  assertEquals(unscopedCalls, []);
});

Deno.test("missing auth returns 401 without queue writes", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsAutoReplenish(
    request({ workspace_id: SHOP_A }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.queueInserts.length, 0);
});

Deno.test("JWT without workspace returns 403 without queue writes", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsAutoReplenish(
    request({ workspace: FORGED_WORKSPACE }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: "",
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.queueInserts.length, 0);
});

Deno.test("JWT scoped replenish never writes another shop's rows", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsAutoReplenish(
    request({
      workspace: FORGED_WORKSPACE,
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer manager-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-manager-1",
      role: "manager",
      workspaceId: SHOP_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, SHOP_A);
  assertEquals(workspaceFilters(client, "parts_inventory_reorder_status").length, 1);
  assertEquals(workspaceFilters(client, "parts_inventory_reorder_status")[0].value, SHOP_A);
  assertEquals(insertedWorkspaceIds(client).every((id) => id === SHOP_A), true);
  assertEquals(insertedWorkspaceIds(client).includes(SHOP_B), false);
});

Deno.test("service-role scoped hint scopes reads and writes to shop A only", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsAutoReplenish(
    request({ workspace_id: SHOP_A }, {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-workspace-id": SHOP_A,
    }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: SHOP_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, SHOP_A);
  assertEquals(workspaceFilters(client, "parts_inventory_reorder_status")[0].value, SHOP_A);
  assertEquals(workspaceFilters(client, "parts_replenishment_rules")[0].value, SHOP_A);
  assertEquals(insertedWorkspaceIds(client).every((id) => id === SHOP_A), true);
  assertEquals(insertedWorkspaceIds(client).includes(SHOP_B), false);
});

Deno.test("service-role unscoped cron processes all shops without workspace filter", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsAutoReplenish(
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
  assertEquals(workspaceFilters(client, "parts_inventory_reorder_status").length, 0);
  const inserted = insertedWorkspaceIds(client);
  assertEquals(inserted.includes(SHOP_A), true);
  assertEquals(inserted.includes(SHOP_B), true);
});

Deno.test("service-role scoped via x-workspace-id header binds without body", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsAutoReplenish(
    request({}, {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "x-workspace-id": SHOP_A,
    }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: SHOP_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, SHOP_A);
  assertEquals(insertedWorkspaceIds(client).includes(SHOP_B), false);
});

Deno.test("authenticateAutoReplenish returns 401 when no auth credentials are present", async () => {
  const client = new MockAdminClient();
  const result = await authenticateAutoReplenish(request({}), client as never);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "parts-auto-replenish handler env cleanup",
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
