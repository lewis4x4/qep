import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  DEAL_SCORE_LIMIT,
  ORPHAN_CHUNKS_LIMIT,
  OVERDUE_FOLLOW_UPS_LIMIT,
  PIPELINE_RISK_LIMIT,
  STALLING_DEALS_LIMIT,
  buildDetectorMeta,
  handleAnomalyScan,
  resolveAnomalyScanScope,
  type AnomalyScanDependencies,
} from "./handler.ts";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ROLE_KEY = "service-role-test-key";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "insert" | "update" = "select";
  private limitCount: number | null = null;
  private insertValues: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private updateValues: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
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
    this.owner.filters.push({ table: this.table, column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value });
    this.owner.filters.push({ table: this.table, column, value });
    return this;
  }

  not(_column: string, _operator: string, _value: unknown): this {
    return this;
  }

  lt(_column: string, _value: unknown): this {
    return this;
  }

  gte(_column: string, _value: unknown): this {
    return this;
  }

  lte(_column: string, _value: unknown): this {
    return this;
  }

  in(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value });
    this.owner.filters.push({ table: this.table, column, value });
    return this;
  }

  neq(_column: string, _value: unknown): this {
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

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.owner.resolve(this.table, this.operation, {
      filters: this.filters,
      limit: this.limitCount,
      insertValues: this.insertValues,
      updateValues: this.updateValues,
    });
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  readonly filters: Filter[] = [];
  readonly inserts: Array<{ table: string; payload: unknown }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  resolve(
    table: string,
    operation: "select" | "insert" | "update",
    params: {
      filters: Filter[];
      limit: number | null;
      insertValues: Record<string, unknown> | Record<string, unknown>[] | null;
      updateValues: Record<string, unknown> | null;
    },
  ): unknown {
    if (operation === "insert" && params.insertValues) {
      this.inserts.push({ table, payload: params.insertValues });
      return null;
    }

    if (operation === "update") {
      return null;
    }

    const workspace = params.filters.find((filter) => filter.column === "workspace_id")?.value;

    if (table === "crm_deals") {
      const rows = [
        {
          id: "deal-a",
          name: "Deal A",
          workspace_id: WORKSPACE_A,
          assigned_rep_id: "rep-a",
          updated_at: "2020-01-01T00:00:00.000Z",
          amount: 1000,
          stage_id: "stage-1",
          next_follow_up_at: "2020-01-01T00:00:00.000Z",
          expected_close_on: "2099-01-01",
          created_at: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "deal-b",
          name: "Deal B",
          workspace_id: WORKSPACE_B,
          assigned_rep_id: "rep-b",
          updated_at: "2020-01-01T00:00:00.000Z",
          amount: 2000,
          stage_id: "stage-1",
          next_follow_up_at: "2020-01-01T00:00:00.000Z",
          expected_close_on: "2099-01-01",
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ];
      const filtered = workspace
        ? rows.filter((row) => row.workspace_id === workspace)
        : rows;
      if (params.limit !== null) {
        return filtered.slice(0, params.limit);
      }
      return filtered;
    }

    if (table === "crm_activities") {
      return [];
    }

    if (table === "profiles") {
      const workspaceFilter = params.filters.find((filter) =>
        filter.column === "active_workspace_id"
      )?.value;
      const reps = [
        { id: "rep-a", full_name: "Rep A", active_workspace_id: WORKSPACE_A },
        { id: "rep-b", full_name: "Rep B", active_workspace_id: WORKSPACE_B },
      ];
      return workspaceFilter
        ? reps.filter((rep) => rep.active_workspace_id === workspaceFilter)
        : reps;
    }

    if (table === "voice_captures") {
      return [];
    }

    if (table === "crm_deal_stages") {
      return [{ id: "stage-1", name: "Initial", display_order: 1 }];
    }

    if (table === "documents") {
      const docs = [
        {
          id: "doc-a",
          title: "Doc A",
          status: "draft",
          workspace_id: WORKSPACE_A,
        },
        {
          id: "doc-b",
          title: "Doc B",
          status: "draft",
          workspace_id: WORKSPACE_B,
        },
      ];
      const filtered = workspace
        ? docs.filter((doc) => doc.workspace_id === workspace)
        : docs;
      return filtered.slice(0, params.limit ?? filtered.length);
    }

    if (table === "chunks") {
      return [];
    }

    if (
      table === "crm_contacts" ||
      table === "crm_companies" ||
      table === "crm_equipment" ||
      table === "crm_embeddings"
    ) {
      return [];
    }

    if (table === "anomaly_alerts") {
      return null;
    }

    return [];
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-a",
    role: "manager",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
): Partial<AnomalyScanDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    isServiceRoleCaller: ((req: Request) =>
      req.headers.get("authorization") === `Bearer ${SERVICE_ROLE_KEY}`) as never,
    publishFlowEvent: (async () => undefined) as never,
  };
}

function dealWorkspaceFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === "crm_deals" && filter.column === "workspace_id"
  );
}

Deno.test("resolveAnomalyScanScope binds JWT callers to their workspace", () => {
  const jwtScope = resolveAnomalyScanScope({
    caller: callerContext(),
    isServiceRole: false,
    requestedWorkspaceId: WORKSPACE_B,
  });
  assertEquals(jwtScope, {
    ok: true,
    scope: { mode: "workspace", workspaceId: WORKSPACE_A },
  });

  const serviceAll = resolveAnomalyScanScope({
    caller: callerContext({ isServiceRole: true }),
    isServiceRole: true,
    requestedWorkspaceId: null,
  });
  assertEquals(serviceAll, { ok: true, scope: { mode: "all" } });

  const serviceScoped = resolveAnomalyScanScope({
    caller: callerContext({ isServiceRole: true }),
    isServiceRole: true,
    requestedWorkspaceId: WORKSPACE_B,
  });
  assertEquals(serviceScoped, {
    ok: true,
    scope: { mode: "workspace", workspaceId: WORKSPACE_B },
  });
});

Deno.test("buildDetectorMeta marks first-N passes as truncated", () => {
  assertEquals(buildDetectorMeta(50, 50), {
    limit: 50,
    scanned: 50,
    truncated: true,
  });
  assertEquals(buildDetectorMeta(50, 12), {
    limit: 50,
    scanned: 12,
    truncated: false,
  });
});

Deno.test("JWT manager scan filters detectors to caller workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleAnomalyScan(
    new Request("https://example.test/functions/v1/anomaly-scan", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspace_id: WORKSPACE_B }),
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_A });
  assertEquals(
    dealWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_A),
    true,
  );
  assertEquals(body.breakdown.stalling_deals > 0, true);
  assertEquals(
    client.inserts.every((insert) => {
      const rows = Array.isArray(insert.payload) ? insert.payload : [insert.payload];
      return rows.every((row) =>
        (row as { workspace_id?: string }).workspace_id === WORKSPACE_A
      );
    }),
    true,
  );
});

Deno.test("JWT rep role is forbidden", async () => {
  const client = new MockAdminClient();
  const response = await handleAnomalyScan(
    new Request("https://example.test/functions/v1/anomaly-scan", {
      method: "POST",
      headers: { Authorization: "Bearer user-token" },
    }),
    dependencies(client, callerContext({ role: "rep" })),
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "Forbidden" });
  assertEquals(client.filters.length, 0);
});

Deno.test("service-role cron scan stays unscoped", async () => {
  const client = new MockAdminClient();
  const response = await handleAnomalyScan(
    new Request("https://example.test/functions/v1/anomaly-scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "all" });
  assertEquals(dealWorkspaceFilters(client).length, 0);
});

Deno.test("service-role may scope to an explicit workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleAnomalyScan(
    new Request("https://example.test/functions/v1/anomaly-scan", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspace_id: WORKSPACE_B }),
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.scope, { mode: "workspace", workspace_id: WORKSPACE_B });
  assertEquals(
    dealWorkspaceFilters(client).every((filter) => filter.value === WORKSPACE_B),
    true,
  );
});

Deno.test("response includes truncation metadata for capped detectors", async () => {
  const client = new MockAdminClient();
  const response = await handleAnomalyScan(
    new Request("https://example.test/functions/v1/anomaly-scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.truncation.stalling_deals.limit, STALLING_DEALS_LIMIT);
  assertEquals(body.truncation.overdue_follow_ups.limit, OVERDUE_FOLLOW_UPS_LIMIT);
  assertEquals(body.truncation.pipeline_risks.limit, PIPELINE_RISK_LIMIT);
  assertEquals(body.truncation.orphan_chunks.limit, ORPHAN_CHUNKS_LIMIT);
  assertEquals(body.truncation.deal_scoring.limit, DEAL_SCORE_LIMIT);
  assertEquals(typeof body.truncation.stalling_deals.scanned, "number");
  assertEquals(typeof body.truncation.stalling_deals.truncated, "boolean");
});

if (originalServiceRoleKey === undefined) {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
} else {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
}
