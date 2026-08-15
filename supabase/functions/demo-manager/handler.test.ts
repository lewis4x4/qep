import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleDemoManager,
  notifyIronManagersForDemoApproval,
  resolveDemoManagerWorkspace,
  type DemoManagerDependencies,
} from "./handler.ts";

const REP_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_A = "22222222-2222-4222-8222-222222222222";
const MANAGER_B = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEAL_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DEAL_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DEMO_A = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type Filter = { table: string; column: string; value: unknown };

interface DealRow {
  id: string;
  workspace_id: string;
  stage_id: string;
  deleted_at: string | null;
  crm_deal_stages: { sort_order: number };
}

interface ProfileRow {
  id: string;
  active_workspace_id: string;
  iron_role: string;
}

interface AssessmentRow {
  deal_id: string;
  fields_populated: number;
}

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "insert" | "update" = "select";
  private insertValues: Record<string, unknown> | null = null;
  private updateValues: Record<string, unknown> | null = null;
  private limitCount: number | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    if (this.operation !== "insert") {
      this.operation = "select";
    }
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.operation = "insert";
    this.insertValues = values;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.updateValues = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value });
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  maybeSingle(): this {
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
    const result = this.owner.resolve(this.table, this.operation, {
      filters: this.filters,
      insertValues: this.insertValues,
      updateValues: this.updateValues,
      limitCount: this.limitCount,
    });
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  readonly deals: DealRow[] = [
    {
      id: DEAL_A,
      workspace_id: WORKSPACE_A,
      stage_id: "stage-8",
      deleted_at: null,
      crm_deal_stages: { sort_order: 8 },
    },
    {
      id: DEAL_B,
      workspace_id: WORKSPACE_B,
      stage_id: "stage-8",
      deleted_at: null,
      crm_deal_stages: { sort_order: 8 },
    },
  ];

  readonly profiles: ProfileRow[] = [
    {
      id: MANAGER_A,
      active_workspace_id: WORKSPACE_A,
      iron_role: "iron_manager",
    },
    {
      id: MANAGER_B,
      active_workspace_id: WORKSPACE_B,
      iron_role: "iron_manager",
    },
  ];

  readonly assessments: AssessmentRow[] = [
    { deal_id: DEAL_A, fields_populated: 6 },
    { deal_id: DEAL_B, fields_populated: 6 },
  ];

  readonly profileFilters: Filter[] = [];
  readonly notificationInserts: Array<Record<string, unknown>> = [];
  readonly demoInserts: Array<Record<string, unknown>> = [];
  readonly tableTouches: string[] = [];

  from(table: string): QueryBuilder {
    this.tableTouches.push(table);
    return new QueryBuilder(this, table);
  }

  resolve(
    table: string,
    operation: "select" | "insert" | "update",
    params: {
      filters: Filter[];
      insertValues: Record<string, unknown> | null;
      updateValues: Record<string, unknown> | null;
      limitCount: number | null;
    },
  ): { data: unknown; error: null } {
    if (table === "profiles" && operation === "select") {
      for (const filter of params.filters) {
        this.profileFilters.push(filter);
      }

      const rows = this.profiles.filter((profile) => {
        for (const filter of params.filters) {
          if (
            (profile as unknown as Record<string, unknown>)[filter.column] !==
              filter.value
          ) {
            return false;
          }
        }
        return true;
      });
      return { data: rows, error: null };
    }

    if (table === "crm_in_app_notifications" && operation === "insert" && params.insertValues) {
      this.notificationInserts.push(params.insertValues);
      return { data: null, error: null };
    }

    if (table === "crm_deals" && operation === "select") {
      const rows = this.deals.filter((deal) => {
        if (deal.deleted_at !== null) return false;
        for (const filter of params.filters) {
          if (filter.column === "deleted_at" && filter.value === null) continue;
          if (
            (deal as unknown as Record<string, unknown>)[filter.column] !==
              filter.value
          ) {
            return false;
          }
        }
        return true;
      });
      return { data: rows[0] ?? null, error: null };
    }

    if (table === "needs_assessments" && operation === "select") {
      const dealId = params.filters.find((filter) => filter.column === "deal_id")?.value;
      const row = this.assessments.find((assessment) => assessment.deal_id === dealId);
      return { data: row ?? null, error: null };
    }

    if (table === "demos" && operation === "insert" && params.insertValues) {
      this.demoInserts.push(params.insertValues);
      return {
        data: { id: DEMO_A, ...params.insertValues },
        error: null,
      };
    }

    return { data: null, error: null };
  }
}

class MockCallerClient {
  constructor(private readonly admin: MockAdminClient) {}

  from(table: string): QueryBuilder {
    return this.admin.from(table);
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer rep-token",
    userId: REP_ID,
    role: "rep",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function dependencies(
  mock = new MockAdminClient(),
  overrides: Partial<DemoManagerDependencies> = {},
): Partial<DemoManagerDependencies> {
  return {
    createAdminClient: (() => mock) as never,
    createCallerClient: (() => new MockCallerClient(mock)) as never,
    resolveCallerContext: (async () => callerContext()) as never,
    notifyIronManagersForDemoApproval,
    ...overrides,
  };
}

function postRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.test/functions/v1/demo-manager", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("resolveDemoManagerWorkspace binds JWT callers to profile workspace", () => {
  const result = resolveDemoManagerWorkspace({ caller: callerContext() });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.workspaceId, WORKSPACE_A);
    assertEquals(result.userId, REP_ID);
  }
});

Deno.test("resolveDemoManagerWorkspace returns 403 when JWT caller has no active workspace", () => {
  const result = resolveDemoManagerWorkspace({
    caller: callerContext({ workspaceId: null }),
  });
  assertEquals(result, {
    ok: false,
    status: 403,
    message: "The authenticated user has no active workspace",
  });
});

Deno.test("JWT with no active workspace returns 403 with zero admin writes", async () => {
  const mock = new MockAdminClient();
  const response = await handleDemoManager(
    postRequest({
      deal_id: DEAL_A,
      buying_intent_confirmed: true,
      workspace: WORKSPACE_B,
    }),
    dependencies(mock, {
      resolveCallerContext: (async () => callerContext({ workspaceId: null })) as never,
    }),
  );

  assertEquals(response.status, 403);
  assertEquals(mock.tableTouches.length, 0);
  assertEquals(mock.demoInserts.length, 0);
  assertEquals(mock.notificationInserts.length, 0);
});

Deno.test("JWT shop A POST inserts notifications in workspace A and queries managers in workspace A", async () => {
  const mock = new MockAdminClient();
  const response = await handleDemoManager(
    postRequest({
      deal_id: DEAL_A,
      deal_name: "Acme Loader",
      buying_intent_confirmed: true,
      equipment_category: "construction",
    }),
    dependencies(mock),
  );

  assertEquals(response.status, 201);
  assertEquals(mock.demoInserts.length, 1);
  assertEquals(mock.demoInserts[0].workspace_id, WORKSPACE_A);
  assertEquals(mock.notificationInserts.length, 1);
  assertEquals(mock.notificationInserts[0].workspace_id, WORKSPACE_A);
  assertEquals(mock.notificationInserts[0].workspace_id !== "default", true);
  assertEquals(mock.notificationInserts[0].user_id, MANAGER_A);
  assertEquals(
    mock.profileFilters.some(
      (filter) =>
        filter.table === "profiles" &&
        filter.column === "active_workspace_id" &&
        filter.value === WORKSPACE_A,
    ),
    true,
  );
  assertEquals(
    mock.profileFilters.some(
      (filter) =>
        filter.table === "profiles" &&
        filter.column === "iron_role" &&
        filter.value === "iron_manager",
    ),
    true,
  );
});

Deno.test("JWT shop A with shop B deal_id creates no demo and no notifications", async () => {
  const mock = new MockAdminClient();
  const response = await handleDemoManager(
    postRequest({
      deal_id: DEAL_B,
      buying_intent_confirmed: true,
      workspace: WORKSPACE_A,
    }),
    dependencies(mock),
  );

  assertEquals(response.status, 403);
  assertEquals(mock.demoInserts.length, 0);
  assertEquals(mock.notificationInserts.length, 0);
});

Deno.test("notifyIronManagersForDemoApproval never targets managers outside the caller workspace", async () => {
  const mock = new MockAdminClient();
  const result = await notifyIronManagersForDemoApproval(mock as never, {
    workspaceId: WORKSPACE_A,
    dealId: DEAL_A,
    dealName: "Acme Loader",
    equipmentCategory: "construction",
    demoId: DEMO_A,
  });

  assertEquals(result.managerIds, [MANAGER_A]);
  assertEquals(result.notificationCount, 1);
  assertEquals(mock.notificationInserts.length, 1);
  assertEquals(mock.notificationInserts[0].workspace_id, WORKSPACE_A);
  assertEquals(mock.notificationInserts[0].user_id, MANAGER_A);
});
