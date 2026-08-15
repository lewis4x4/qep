import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  executeVoiceOpsTool,
  handlePartsVoiceOps,
  resolveVoiceOpsWorkspace,
  type PartsVoiceOpsDependencies,
} from "./handler.ts";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORGED_WORKSPACE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-token");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = {
  table: string;
  column: string;
  value: unknown;
  op: "eq" | "ilike";
  referencedTable?: string;
};

const CATALOG_BY_WORKSPACE: Record<string, Array<Record<string, unknown>>> = {
  [SHOP_A]: [{
    id: "part-a-1",
    part_number: "PART-A1",
    description: "Filter A",
    manufacturer: "Yanmar",
    vendor_code: "YAN",
    on_hand: 3,
    list_price: 12.5,
    cost_price: 8,
    bin_location: "A-1",
    branch_code: "branch-a",
    workspace_id: SHOP_A,
  }],
  [SHOP_B]: [{
    id: "part-b-1",
    part_number: "PART-B1",
    description: "Filter B",
    manufacturer: "Bandit",
    vendor_code: "BAN",
    on_hand: 7,
    list_price: 20,
    cost_price: 14,
    bin_location: "B-1",
    branch_code: "branch-b",
    workspace_id: SHOP_B,
  }],
};

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private operation: "select" | "insert" | "single" = "select";
  private insertRows: Record<string, unknown>[] = [];

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    this.operation = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({
      table: this.table,
      column,
      value,
      op: "eq",
    });
    this.owner.filters.push({
      table: this.table,
      column,
      value,
      op: "eq",
    });
    return this;
  }

  ilike(column: string, value: unknown): this {
    this.filters.push({
      table: this.table,
      column,
      value,
      op: "ilike",
    });
    this.owner.filters.push({
      table: this.table,
      column,
      value,
      op: "ilike",
    });
    return this;
  }

  is(_column: string, _value: unknown): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  order(
    _column: string,
    options?: { referencedTable?: string; ascending?: boolean },
  ): this {
    if (options?.referencedTable) {
      this.filters.push({
        table: this.table,
        column: `${options.referencedTable}.order`,
        value: options.ascending,
        op: "eq",
        referencedTable: options.referencedTable,
      });
    }
    return this;
  }

  maybeSingle(): this {
    this.operation = "single";
    return this;
  }

  single(): this {
    this.operation = "single";
    return this;
  }

  insert(rows: Record<string, unknown>[]): {
    select: (_columns: string) => { single: () => QueryBuilder };
  } {
    this.operation = "insert";
    this.insertRows = rows;
    return {
      select: (_columns: string) => ({
        single: () => this,
      }),
    };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.operation === "insert") {
      if (this.table === "parts_auto_replenish_queue") {
        this.owner.queueInserts.push(this.insertRows);
      }
      return Promise.resolve({
        data: { id: "queue-row-1" },
        error: null,
      }).then(onfulfilled, onrejected);
    }

    let data: unknown;
    if (this.table === "parts_catalog") {
      const workspaceFilter = this.filters.find((filter) =>
        filter.column === "workspace_id" && filter.op === "eq"
      )?.value;
      const partFilter = this.filters.find((filter) =>
        filter.column === "part_number" && filter.op === "ilike"
      )?.value;
      const rows = typeof workspaceFilter === "string"
        ? CATALOG_BY_WORKSPACE[workspaceFilter] ?? []
        : [];
      data = rows.filter((row) => {
        if (typeof partFilter !== "string") return true;
        return String(row.part_number).toLowerCase() ===
          partFilter.toLowerCase();
      });
      if (this.operation === "single") {
        data = Array.isArray(data) ? data[0] ?? null : null;
      }
    } else if (this.table === "parts_order_lines") {
      const workspaceFilter = this.filters.find((filter) =>
        filter.column === "parts_orders.workspace_id" && filter.op === "eq"
      )?.value;
      data = typeof workspaceFilter === "string" && workspaceFilter === SHOP_A
        ? []
        : [];
    } else {
      data = this.operation === "single" ? null : [];
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  queueInserts: Record<string, unknown>[][] = [];
  voiceInteractionInserts: Record<string, unknown>[][] = [];

  from(table: string): QueryBuilder {
    if (table === "voice_interactions") {
      return {
        insert: (rows: Record<string, unknown>[]) => {
          this.voiceInteractionInserts.push(rows);
          return {
            then: <TResult1, TResult2>(
              onfulfilled?: ((value: { error: null }) => TResult1) | null,
              onrejected?: ((reason: unknown) => TResult2) | null,
            ) => Promise.resolve({ error: null }).then(onfulfilled, onrejected),
          };
        },
      } as unknown as QueryBuilder;
    }
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "match_parts_hybrid") {
      const workspace = args.p_workspace;
      const rows = typeof workspace === "string"
        ? CATALOG_BY_WORKSPACE[workspace] ?? []
        : [];
      return Promise.resolve({
        data: rows.map((row) => ({
          part_number: row.part_number,
          description: row.description,
          manufacturer: row.manufacturer,
          vendor_code: row.vendor_code,
          on_hand: row.on_hand,
          list_price: row.list_price,
          cost_price: row.cost_price,
          cosine_similarity: 0.9,
        })),
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }
}

function callerContext(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-rep-1",
    role: "rep",
    isServiceRole: false,
    workspaceId: SHOP_A,
    ...overrides,
  };
}

function dependencies(
  client: MockAdminClient,
  caller: CallerContext = callerContext(),
): Partial<PartsVoiceOpsDependencies> {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => caller) as never,
    getAnthropicApiKey: () => "anthropic-test-key",
    callClaude: (async () => ({
      content: [{ type: "text", text: "Three on hand." }],
      stop_reason: "end_turn",
      tokens_in: 10,
      tokens_out: 5,
    })) as never,
    embedText: (async () => [0.1, 0.2, 0.3]) as never,
  };
}

function request(
  body: Record<string, unknown> = {},
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/parts-voice-ops", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter((filter) =>
    filter.table === table &&
    filter.column === "workspace_id" &&
    filter.op === "eq"
  );
}

function insertedQueueWorkspaceIds(client: MockAdminClient): string[] {
  return client.queueInserts.flat().map((row) => String(row.workspace_id));
}

Deno.test("resolveVoiceOpsWorkspace binds JWT to active workspace and ignores forged body", () => {
  assertEquals(
    resolveVoiceOpsWorkspace({
      callerWorkspaceId: SHOP_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { ok: true, workspaceId: SHOP_A },
  );
  assertEquals(
    resolveVoiceOpsWorkspace({
      callerWorkspaceId: null,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    },
  );
});

Deno.test("JWT forged workspace uses profile workspace A for hybrid and catalog queries", async () => {
  const client = new MockAdminClient();

  await executeVoiceOpsTool(
    client as never,
    SHOP_A,
    "lookup_part_semantic",
    { query: "oil filter" },
    { embedText: async () => [0.1, 0.2] },
  );

  const hybridCall = client.rpcCalls.find((call) => call.name === "match_parts_hybrid");
  assertEquals(hybridCall?.args.p_workspace, SHOP_A);
  assertNotEquals(hybridCall?.args.p_workspace, FORGED_WORKSPACE);

  client.filters.length = 0;
  await executeVoiceOpsTool(
    client as never,
    SHOP_A,
    "check_part_stock",
    { part_number: "PART-A1" },
  );

  assertEquals(workspaceFilters(client, "parts_catalog").length, 1);
  assertEquals(workspaceFilters(client, "parts_catalog")[0].value, SHOP_A);
});

Deno.test("JWT cannot insert replenish into shop B", async () => {
  const client = new MockAdminClient();
  const result = await executeVoiceOpsTool(
    client as never,
    SHOP_A,
    "add_to_replenish_queue",
    { part_number: "PART-B1", quantity: 5 },
  );

  assertEquals(result, {
    ok: false,
    reason: "part_not_found",
    part_number: "PART-B1",
  });
  assertEquals(client.queueInserts.length, 0);
  assertEquals(insertedQueueWorkspaceIds(client).includes(SHOP_B), false);
});

Deno.test("JWT missing workspace returns 403 without writes", async () => {
  const client = new MockAdminClient();
  const response = await handlePartsVoiceOps(
    request({
      transcript: "price on PART-A1",
      workspace: FORGED_WORKSPACE,
      workspace_id: FORGED_WORKSPACE,
    }),
    dependencies(client, callerContext({ workspaceId: null })),
  );

  assertEquals(response.status, 403);
  assertEquals(client.queueInserts.length, 0);
  assertEquals(client.voiceInteractionInserts.length, 0);
});

Deno.test("foreign part number not in caller shop produces no write", async () => {
  const client = new MockAdminClient();

  const stock = await executeVoiceOpsTool(
    client as never,
    SHOP_A,
    "check_part_stock",
    { part_number: "PART-B1" },
  );
  assertEquals(stock, { found: false, part_number: "PART-B1" });

  const replenish = await executeVoiceOpsTool(
    client as never,
    SHOP_A,
    "add_to_replenish_queue",
    { part_number: "PART-B1", quantity: 2 },
  );
  assertEquals(replenish, {
    ok: false,
    reason: "part_not_found",
    part_number: "PART-B1",
  });
  assertEquals(client.queueInserts.length, 0);
});

Deno.test("JWT replenish writes only caller workspace rows", async () => {
  const client = new MockAdminClient();
  const result = await executeVoiceOpsTool(
    client as never,
    SHOP_A,
    "add_to_replenish_queue",
    { part_number: "PART-A1", quantity: 4 },
  ) as { ok: boolean };

  assertEquals(result.ok, true);
  assertEquals(insertedQueueWorkspaceIds(client), [SHOP_A]);
  assertEquals(insertedQueueWorkspaceIds(client).includes(SHOP_B), false);
});
