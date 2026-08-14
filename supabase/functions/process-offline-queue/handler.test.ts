import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  handleProcessOfflineQueue,
  type ProcessOfflineQueueDependencies,
  type QueuedAction,
} from "./handler.ts";

const REP_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEAL_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DEAL_OTHER_SHOP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STAGE_CURRENT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const STAGE_NEW = "99999999-9999-4999-8999-999999999999";
const ACTION_LOG_VISIT = "10000000-0000-4000-8000-000000000001";
const ACTION_CREATE_NOTE = "10000000-0000-4000-8000-000000000002";
const ACTION_ADVANCE_STAGE = "10000000-0000-4000-8000-000000000003";

interface DealRow {
  id: string;
  company_id: string | null;
  assigned_rep_id: string;
  workspace_id: string;
  stage_id: string | null;
  deleted_at: string | null;
}

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "update" | "insert" = "select";
  private insertValues: Record<string, unknown> | null = null;
  private updateValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
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

  limit(_count: number): this {
    return this;
  }

  maybeSingle(): this {
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
    });
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  readonly deals: DealRow[] = [
    {
      id: DEAL_A,
      company_id: COMPANY_A,
      assigned_rep_id: REP_ID,
      workspace_id: WORKSPACE_A,
      stage_id: STAGE_CURRENT,
      deleted_at: null,
    },
    {
      id: DEAL_OTHER_SHOP,
      company_id: COMPANY_A,
      assigned_rep_id: REP_ID,
      workspace_id: WORKSPACE_OTHER,
      stage_id: STAGE_CURRENT,
      deleted_at: null,
    },
  ];

  readonly activityInserts: Array<Record<string, unknown>> = [];
  readonly dealUpdates: Array<Record<string, unknown>> = [];
  readonly syncQueueUpdates: Array<Record<string, unknown>> = [];
  readonly tableTouches: string[] = [];

  from(table: string): QueryBuilder {
    this.tableTouches.push(table);
    return new QueryBuilder(this, table);
  }

  resolve(
    table: string,
    operation: "select" | "update" | "insert",
    params: {
      filters: Filter[];
      insertValues: Record<string, unknown> | null;
      updateValues: Record<string, unknown> | null;
    },
  ): { data: unknown; error: null } {
    if (table === "crm_activities" && operation === "insert" && params.insertValues) {
      this.activityInserts.push(params.insertValues);
      return { data: null, error: null };
    }

    if (table === "offline_sync_queue" && operation === "update" && params.updateValues) {
      this.syncQueueUpdates.push(params.updateValues);
      return { data: null, error: null };
    }

    if (table === "crm_deals" && operation === "update" && params.updateValues) {
      const id = params.filters.find((f) => f.column === "id")?.value;
      const repId = params.filters.find((f) => f.column === "assigned_rep_id")?.value;
      const workspaceId = params.filters.find((f) => f.column === "workspace_id")?.value;
      const deal = this.deals.find(
        (row) =>
          row.id === id &&
          row.assigned_rep_id === repId &&
          row.workspace_id === workspaceId &&
          row.deleted_at === null,
      );
      if (deal) {
        Object.assign(deal, params.updateValues);
        this.dealUpdates.push({ id, ...params.updateValues });
      }
      return { data: null, error: null };
    }

    if (table === "crm_deals" && operation === "select") {
      const rows = this.deals.filter((row) => {
        if (row.deleted_at !== null) return false;
        for (const filter of params.filters) {
          if (filter.column === "deleted_at" && filter.value === null && row.deleted_at !== null) {
            return false;
          }
          if (
            filter.column !== "deleted_at" &&
            (row as unknown as Record<string, unknown>)[filter.column] !== filter.value
          ) {
            return false;
          }
        }
        return true;
      });
      return { data: rows[0] ?? null, error: null };
    }

    return { data: null, error: null };
  }
}

function pastTimestamp(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function request(
  actions: QueuedAction[],
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/process-offline-queue", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ actions }),
  });
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
  overrides: Partial<ProcessOfflineQueueDependencies> = {},
): Partial<ProcessOfflineQueueDependencies> {
  return {
    createAdminClient: (() => mock) as never,
    resolveCallerContext: (async () => callerContext()) as never,
    resolveProfileActiveWorkspaceId: (async () => WORKSPACE_A) as never,
    ...overrides,
  };
}

Deno.test("unauthenticated requests return 401 with no database writes", async () => {
  const mock = new MockAdminClient();
  const response = await handleProcessOfflineQueue(
    request([
      {
        id: ACTION_LOG_VISIT,
        action_type: "log_visit",
        payload: { company_id: COMPANY_A, outcome: "positive" },
        queued_at: pastTimestamp(),
      },
    ]),
    dependencies(mock, {
      resolveCallerContext: (async () => callerContext({
        authHeader: null,
        userId: null,
        role: null,
        workspaceId: null,
      })) as never,
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(mock.tableTouches.length, 0);
  assertEquals(mock.activityInserts.length, 0);
  assertEquals(mock.dealUpdates.length, 0);
});

Deno.test("log_visit writes activities into the caller workspace, not default", async () => {
  const mock = new MockAdminClient();
  const response = await handleProcessOfflineQueue(
    request([
      {
        id: ACTION_LOG_VISIT,
        action_type: "log_visit",
        payload: {
          company_id: COMPANY_A,
          outcome: "positive",
          notes: "Rep was offline",
        },
        queued_at: pastTimestamp(),
      },
    ]),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.synced, 1);
  assertEquals(mock.activityInserts.length, 1);
  assertEquals(mock.activityInserts[0].workspace_id, WORKSPACE_A);
  assertEquals(mock.activityInserts[0].workspace_id !== "default", true);
  assertEquals(mock.activityInserts[0].deal_id, DEAL_A);
});

Deno.test("create_note with a foreign deal_id fails and does not insert", async () => {
  const mock = new MockAdminClient();
  const response = await handleProcessOfflineQueue(
    request([
      {
        id: ACTION_CREATE_NOTE,
        action_type: "create_note",
        payload: {
          deal_id: DEAL_OTHER_SHOP,
          text: "Should not land in another shop",
        },
        queued_at: pastTimestamp(),
      },
    ]),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.failed, 1);
  assertEquals(body.results[0].status, "failed");
  assertEquals(mock.activityInserts.length, 0);
});

Deno.test("advance_stage succeeds for an owned deal in the caller workspace", async () => {
  const mock = new MockAdminClient();
  const response = await handleProcessOfflineQueue(
    request([
      {
        id: ACTION_ADVANCE_STAGE,
        action_type: "advance_stage",
        payload: {
          deal_id: DEAL_A,
          new_stage_id: STAGE_NEW,
        },
        queued_at: pastTimestamp(),
      },
    ]),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.synced, 1);
  assertEquals(mock.dealUpdates.length, 1);
  assertEquals(mock.dealUpdates[0].stage_id, STAGE_NEW);
  assertEquals(
    mock.deals.find((deal) => deal.id === DEAL_A)?.stage_id,
    STAGE_NEW,
  );
});

Deno.test("create_note with an owned deal_id inserts into caller workspace", async () => {
  const mock = new MockAdminClient();
  const response = await handleProcessOfflineQueue(
    request([
      {
        id: ACTION_CREATE_NOTE,
        action_type: "create_note",
        payload: {
          deal_id: DEAL_A,
          text: "Offline note for owned deal",
        },
        queued_at: pastTimestamp(),
      },
    ]),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.synced, 1);
  assertEquals(mock.activityInserts.length, 1);
  assertEquals(mock.activityInserts[0].workspace_id, WORKSPACE_A);
  assertEquals(mock.activityInserts[0].deal_id, DEAL_A);
});
