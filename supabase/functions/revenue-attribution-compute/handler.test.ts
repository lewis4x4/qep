import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  dealAccessibleInScope,
  handleRevenueAttributionCompute,
  resolveRevenueAttributionWorkspace,
  type RevenueAttributionAuthResult,
} from "./handler.ts";

const WORKSPACE_A = "workspace-shop-a";
const WORKSPACE_B = "workspace-shop-b";
const FORGED_WORKSPACE = "workspace-forged";
const DEAL_A = "11111111-1111-1111-1111-111111111111";
const DEAL_B = "22222222-2222-2222-2222-222222222222";
const VOICE_A = "voice-a-1111-1111-1111-111111111111";
const VOICE_B = "voice-b-2222-2222-2222-222222222222";
const SERVICE_KEY = "service-role-token";

Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = { table: string; column: string; value: unknown; op?: string };

const deals = [
  {
    id: DEAL_A,
    workspace_id: WORKSPACE_A,
    amount: 10000,
    closed_at: "2026-08-01T00:00:00.000Z",
    company_id: "company-a",
  },
  {
    id: DEAL_B,
    workspace_id: WORKSPACE_B,
    amount: 20000,
    closed_at: "2026-08-01T00:00:00.000Z",
    company_id: "company-b",
  },
];

const activities = [
  {
    id: "activity-a",
    deal_id: DEAL_A,
    activity_type: "call",
    occurred_at: "2026-07-20T00:00:00.000Z",
  },
  {
    id: "activity-b",
    deal_id: DEAL_B,
    activity_type: "call",
    occurred_at: "2026-07-20T00:00:00.000Z",
  },
];

const voiceCaptures = [
  {
    id: VOICE_A,
    workspace_id: WORKSPACE_A,
    linked_deal_id: DEAL_A,
    created_at: "2026-07-21T00:00:00.000Z",
    extracted_data: {},
  },
  {
    id: VOICE_B,
    workspace_id: WORKSPACE_B,
    linked_deal_id: DEAL_B,
    created_at: "2026-07-21T00:00:00.000Z",
    extracted_data: {},
  },
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private pendingUpsert?: Record<string, unknown>;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
    private readonly operation: "select" | "upsert",
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value, op: "eq" });
    this.owner.filters.push({ table: this.table, column, value, op: "eq" });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value, op: "gt" });
    this.owner.filters.push({ table: this.table, column, value, op: "gt" });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is" && value === null) {
      this.filters.push({ table: this.table, column, value: "not-null", op: "not-null" });
      this.owner.filters.push({ table: this.table, column, value: "not-null", op: "not-null" });
    }
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ table: this.table, column, value, op: "is" });
    this.owner.filters.push({ table: this.table, column, value, op: "is" });
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

  upsert(payload: Record<string, unknown>, _options?: Record<string, unknown>): QueryBuilder {
    const builder = new QueryBuilder(this.owner, this.table, "upsert");
    builder.pendingUpsert = payload;
    return builder;
  }

  #matches(row: Record<string, unknown>): boolean {
    return this.filters.every((filter) => {
      if (filter.op === "gt") {
        return true;
      }
      if (filter.op === "not-null") {
        return row[filter.column] != null;
      }
      if (filter.op === "is") {
        return row[filter.column] === filter.value;
      }
      return row[filter.column] === filter.value;
    });
  }

  #resolveRows(): unknown {
    if (this.table === "qrm_deals") {
      const rows = deals.filter((row) => this.#matches(row));
      return this.filters.some((filter) => filter.column === "id")
        ? (rows[0] ?? null)
        : rows;
    }

    if (this.table === "qrm_activities") {
      return activities.filter((row) => this.#matches(row));
    }

    if (this.table === "voice_captures") {
      return voiceCaptures.filter((row) => this.#matches(row));
    }

    if (this.table === "crm_deal_equipment") {
      return [];
    }

    if (this.table === "customer_profiles_extended") {
      return null;
    }

    return this.operation === "select" ? [] : null;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "upsert" && this.pendingUpsert) {
      this.owner.upserts.push({
        table: this.table,
        payload: this.pendingUpsert,
      });
    }
    return Promise.resolve({ data: this.#resolveRows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table, "select");
  }
}

function request(
  action: string,
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request(
    `https://example.test/functions/v1/revenue-attribution-compute/${action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers as Record<string, string>,
      },
      body: JSON.stringify(body ?? {}),
    },
  );
}

function jwtAuth(workspaceId = WORKSPACE_A): RevenueAttributionAuthResult {
  return {
    ok: true,
    isServiceRole: false,
    userId: "user-a",
    role: "manager",
    workspaceId,
  };
}

function dependencies(
  client: MockAdminClient,
  authResult: RevenueAttributionAuthResult,
) {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => ({
      authHeader: "Bearer token-a",
      userId: "user-a",
      role: "manager",
      isServiceRole: false,
      workspaceId: WORKSPACE_A,
    } satisfies CallerContext)) as never,
    isServiceRoleCaller: (() => false) as never,
    authenticate: (async () => authResult) as never,
  };
}

function dealFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) => filter.table === "qrm_deals");
}

function voiceFilters(client: MockAdminClient): Filter[] {
  return client.filters.filter((filter) => filter.table === "voice_captures");
}

Deno.test("resolveRevenueAttributionWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveRevenueAttributionWorkspace({
      isServiceRole: false,
      authWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolveRevenueAttributionWorkspace keeps service-role cron unscoped without hints", () => {
  assertEquals(
    resolveRevenueAttributionWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("dealAccessibleInScope rejects foreign workspace deals for scoped JWT callers", () => {
  assertEquals(
    dealAccessibleInScope({ workspace_id: WORKSPACE_B }, { mode: "scoped", workspaceId: WORKSPACE_A }),
    false,
  );
  assertEquals(
    dealAccessibleInScope({ workspace_id: WORKSPACE_A }, { mode: "scoped", workspaceId: WORKSPACE_A }),
    true,
  );
});

Deno.test("JWT scan-recent-wins only returns workspace A deals", async () => {
  const client = new MockAdminClient();
  const response = await handleRevenueAttributionCompute(
    request("scan-recent-wins", { workspace: FORGED_WORKSPACE }, {
      Authorization: "Bearer token-a",
    }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(
    dealFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(body.results.every((row: { deal_id: string }) => row.deal_id !== DEAL_B), true);
  assertEquals(body.results.some((row: { deal_id: string }) => row.deal_id === DEAL_A), true);
});

Deno.test("JWT compute with shop B deal_id returns 404 and writes nothing", async () => {
  const client = new MockAdminClient();
  const response = await handleRevenueAttributionCompute(
    request("compute", { deal_id: DEAL_B, workspace: FORGED_WORKSPACE }, {
      Authorization: "Bearer token-a",
    }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );

  assertEquals(response.status, 404);
  assertEquals(client.upserts.length, 0);
});

Deno.test("JWT missing workspace returns 403", async () => {
  const client = new MockAdminClient();
  const response = await handleRevenueAttributionCompute(
    request("compute", { deal_id: DEAL_A, workspace: FORGED_WORKSPACE }, {
      Authorization: "Bearer token-a",
    }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.upserts.length, 0);
  assertEquals(dealFilters(client).length, 0);
});

Deno.test("voice reads are scoped to caller workspace during JWT compute", async () => {
  const client = new MockAdminClient();
  const response = await handleRevenueAttributionCompute(
    request("compute", { deal_id: DEAL_A }, {
      Authorization: "Bearer token-a",
    }),
    dependencies(client, jwtAuth(WORKSPACE_A)),
  );

  assertEquals(response.status, 200);
  assertEquals(
    voiceFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === WORKSPACE_A
    ),
    true,
  );
  assertEquals(
    voiceFilters(client).some((filter) =>
      filter.column === "linked_deal_id" && filter.value === DEAL_A
    ),
    true,
  );
  assertEquals(client.upserts.length, 4);
  assertEquals(
    client.upserts.every((row) => row.payload.workspace_id === WORKSPACE_A),
    true,
  );
});
