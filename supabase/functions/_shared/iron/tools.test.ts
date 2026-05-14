import { assertEquals } from "jsr:@std/assert@1";
import {
  executeIronTool,
  IRON_TOOL_DEFINITIONS,
  type ToolContext,
} from "./tools.ts";

type QuoteRow = {
  id: string;
  workspace_id: string;
  customer_name: string | null;
  customer_company: string | null;
  status: string;
  quote_number: string | null;
  created_at: string;
  equipment: unknown[];
  [key: string]: unknown;
};

class MockQueryBuilder {
  private rows: QuoteRow[];
  private eqFilters: Array<{ column: string; value: unknown }> = [];
  private inFilters: Array<{ column: string; values: unknown[] }> = [];
  private orFilter: string | null = null;
  private limitValue: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(rows: QuoteRow[]) {
    this.rows = rows;
  }

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.eqFilters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.inFilters.push({ column, values });
    return this;
  }

  or(filter: string) {
    if (!filter.trim()) {
      throw new Error("Empty OR filter is invalid");
    }
    this.orFilter = filter;
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  then(resolve: (value: { data: QuoteRow[]; error: null }) => unknown) {
    let filtered = [...this.rows];

    for (const filter of this.eqFilters) {
      filtered = filtered.filter((row) => row[filter.column] === filter.value);
    }

    for (const filter of this.inFilters) {
      filtered = filtered.filter((row) => filter.values.includes(row[filter.column]));
    }

    if (this.orFilter) {
      const conditions = this.orFilter.split(",").map((item) => item.trim()).filter(Boolean);
      filtered = filtered.filter((row) => {
        return conditions.some((condition) => {
          const match = condition.match(/^(customer_name|customer_company)\.ilike\.%(.+)%$/);
          if (!match) return false;
          const column = match[1] as "customer_name" | "customer_company";
          const term = match[2]?.toLowerCase() ?? "";
          const value = String(row[column] ?? "").toLowerCase();
          return value.includes(term);
        });
      });
    }

    if (this.orderBy) {
      const direction = this.orderBy.ascending ? 1 : -1;
      filtered.sort((a, b) => {
        const left = String(a[this.orderBy!.column] ?? "");
        const right = String(b[this.orderBy!.column] ?? "");
        return left.localeCompare(right) * direction;
      });
    }

    if (typeof this.limitValue === "number") {
      filtered = filtered.slice(0, this.limitValue);
    }

    return Promise.resolve(resolve({ data: filtered, error: null }));
  }
}

class MockSupabaseClient {
  rows: QuoteRow[];

  constructor(rows: QuoteRow[]) {
    this.rows = rows;
  }

  from(table: string) {
    if (table !== "quote_packages") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return new MockQueryBuilder(this.rows);
  }
}

function makeContext(rows: QuoteRow[]): ToolContext {
  return {
    admin: new MockSupabaseClient(rows) as unknown as ToolContext["admin"],
    workspaceId: "ws-1",
    userRole: "owner",
    tavilyApiKey: "",
  };
}

function makeQuote(overrides: Partial<QuoteRow>): QuoteRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    workspace_id: overrides.workspace_id ?? "ws-1",
    customer_name: overrides.customer_name ?? "John Coker",
    customer_company: overrides.customer_company ?? "Acme Construction",
    status: overrides.status ?? "draft",
    quote_number: overrides.quote_number ?? "Q-100",
    created_at: overrides.created_at ?? "2026-05-10T00:00:00.000Z",
    equipment: overrides.equipment ?? [{ make: "Bobcat", model: "S76", year: 2024 }],
    deal_id: null,
    contact_id: null,
    customer_email: null,
    customer_phone: null,
    branch_slug: null,
    attachments_included: [],
    subtotal: null,
    discount_total: null,
    trade_credit: null,
    net_total: null,
    tax_total: null,
    cash_down: null,
    amount_financed: null,
    customer_total: null,
    selected_finance_scenario: null,
    financing_scenarios: [],
    ai_recommendation: null,
    updated_at: null,
    sent_at: null,
  };
}

Deno.test("lookup_quote tool schema exposes optional status input", () => {
  const tool = IRON_TOOL_DEFINITIONS.find((item) => item.name === "lookup_quote");
  assertEquals(Boolean(tool), true);
  const properties = tool?.input_schema.properties as Record<string, unknown>;
  assertEquals(typeof properties.status, "object");
});

Deno.test("executeIronTool lookup_quote supports status-only queries", async () => {
  const ctx = makeContext([
    makeQuote({ id: "q-pending", status: "pending_approval", created_at: "2026-05-11T00:00:00.000Z" }),
    makeQuote({ id: "q-draft", status: "draft", created_at: "2026-05-10T00:00:00.000Z" }),
  ]);

  const result = await executeIronTool("lookup_quote", { status: "pending approval" }, ctx) as {
    count: number;
    quotes: Array<{ id: string; status: string }>;
    filter: { normalized_statuses: string[] };
  };

  assertEquals(result.count, 1);
  assertEquals(result.quotes[0]?.id, "q-pending");
  assertEquals(result.quotes[0]?.status, "pending_approval");
  assertEquals(result.filter.normalized_statuses.includes("pending_approval"), true);
});

Deno.test("executeIronTool lookup_quote sanitizes customer/company OR terms and combines with status", async () => {
  const ctx = makeContext([
    makeQuote({ id: "q-acme-pending", customer_company: "Acme Inc South", status: "pending_approval" }),
    makeQuote({ id: "q-other-pending", customer_company: "Other Co", status: "pending_approval" }),
    makeQuote({ id: "q-acme-draft", customer_company: "Acme Inc South", status: "draft" }),
  ]);

  const result = await executeIronTool(
    "lookup_quote",
    { customer_company: "Acme, Inc._(South)\\.", status: "pending approval" },
    ctx,
  ) as { count: number; quotes: Array<{ id: string }> };

  assertEquals(result.count, 1);
  assertEquals(result.quotes[0]?.id, "q-acme-pending");
});

Deno.test("executeIronTool lookup_quote returns concrete empty payload for zero results", async () => {
  const ctx = makeContext([
    makeQuote({ id: "q-1", status: "draft" }),
  ]);

  const result = await executeIronTool("lookup_quote", { status: "pending approval" }, ctx) as {
    count: number;
    quotes: unknown[];
    filter: { status: string; normalized_statuses: string[] };
  };

  assertEquals(result.count, 0);
  assertEquals(result.quotes, []);
  assertEquals(result.filter.status, "pending approval");
  assertEquals(result.filter.normalized_statuses.includes("pending_approval"), true);
});
