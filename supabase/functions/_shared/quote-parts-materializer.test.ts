import { assertEquals } from "jsr:@std/assert@1";
import { materializePartsOrderFromQuote } from "./quote-parts-materializer.ts";

const QUOTE_ID = "10000000-0000-4000-8000-000000000001";
const DEAL_ID = "20000000-0000-4000-8000-000000000002";
const COMPANY_ID = "30000000-0000-4000-8000-000000000003";
const OTHER_WORKSPACE_DEAL_ID = "20000000-0000-4000-8000-000000000099";
const WORKSPACE = "alpha";

type Row = Record<string, unknown>;

function pricedLine(partNumber: string) {
  return {
    part_catalog_id: "40000000-0000-4000-8000-000000000004",
    part_id: "50000000-0000-4000-8000-000000000005",
    part_number: partNumber,
    description: `${partNumber} desc`,
    price_source: "list_price",
    price_source_id: null,
    pricing_rule_id: null,
    list_unit_price_cents: 1000,
    base_unit_price_cents: 1000,
    final_unit_price_cents: 1000,
    requested_discount_pct: 0,
    applied_discount_pct: 0,
    discount_authority: "none",
    discount_approval_status: "not_required",
    margin_floor_applied: false,
    pricing_metadata: {},
  };
}

function createMockAdmin(seed: {
  quote?: Row | null;
  deal?: Row | null;
  partLines?: Row[];
  existingOrder?: Row | null;
  insertConflict?: boolean;
}) {
  const partsOrders: Row[] = seed.existingOrder ? [seed.existingOrder] : [];
  const partsOrderLines: Row[] = [];
  const exceptions: Row[] = [];
  let insertAttempts = 0;

  const admin = {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const resolveQuery = () => {
        if (table === "parts_orders") {
          const quotePackageId = filters.find((f) => f.column === "quote_package_id")?.value;
          const match = partsOrders.find((row) => row.quote_package_id === quotePackageId);
          return { data: match ?? null, error: null };
        }
        if (table === "quote_packages") {
          const id = filters.find((f) => f.column === "id")?.value;
          return {
            data: id === QUOTE_ID ? (seed.quote ?? null) : null,
            error: null,
          };
        }
        if (table === "qrm_deals") {
          const id = filters.find((f) => f.column === "id")?.value;
          if (id === DEAL_ID) return { data: seed.deal ?? null, error: null };
          if (id === OTHER_WORKSPACE_DEAL_ID) {
            return {
              data: {
                company_id: COMPANY_ID,
                workspace_id: "other-workspace",
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }
        if (table === "quote_package_line_items") {
          return { data: seed.partLines ?? [], error: null };
        }
        return { data: null, error: null };
      };
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(resolveQuery()),
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(resolveQuery()).then(onFulfilled, onRejected);
        },
        insert(payload: Row | Row[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table === "parts_orders") {
            insertAttempts += 1;
            if (seed.insertConflict) {
              return {
                select: () => ({
                  single: () => Promise.resolve({
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
                  }),
                }),
              };
            }
            const created = {
              id: `order-${partsOrders.length + 1}`,
              ...rows[0],
            };
            partsOrders.push(created);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: created.id }, error: null }),
              }),
            };
          }
          if (table === "parts_order_lines") {
            partsOrderLines.push(...rows);
            return Promise.resolve({ error: null });
          }
          return builder;
        },
      };
      return builder;
    },
    rpc(name: string, payload: Record<string, unknown>) {
      if (name === "enqueue_exception") {
        exceptions.push(payload);
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "parts_resolve_priced_line") {
        const partNumber = String(payload.p_part_number ?? "PART-1");
        return {
          single: () => Promise.resolve({ data: pricedLine(partNumber), error: null }),
        };
      }
      return {
        single: () => Promise.resolve({ data: null, error: null }),
      };
    },
  };

  return {
    admin,
    partsOrders,
    partsOrderLines,
    exceptions,
  };
}

Deno.test("materializePartsOrderFromQuote creates draft order when quote has part lines", async () => {
  const mock = createMockAdmin({
    quote: {
      id: QUOTE_ID,
      workspace_id: WORKSPACE,
      deal_id: DEAL_ID,
      contact_id: null,
    },
    deal: {
      company_id: COMPANY_ID,
      workspace_id: WORKSPACE,
    },
    partLines: [{
      id: "line-1",
      line_type: "part",
      description: "Filter",
      quantity: 2,
      unit_price: 10,
      extended_price: 20,
      metadata: { part_number: "FILTER-01" },
      display_order: 0,
    }],
  });

  const result = await materializePartsOrderFromQuote(mock.admin, QUOTE_ID);

  assertEquals(result.status, "created");
  assertEquals(result.status === "created" ? result.lineCount : 0, 1);
  assertEquals(mock.partsOrders.length, 1);
  assertEquals(mock.partsOrders[0].workspace_id, WORKSPACE);
  assertEquals(mock.partsOrders[0].crm_company_id, COMPANY_ID);
  assertEquals(mock.partsOrders[0].order_source, "quote");
  assertEquals(mock.partsOrders[0].quote_package_id, QUOTE_ID);
  assertEquals(mock.partsOrders[0].status, "draft");
  assertEquals(mock.partsOrderLines.length, 1);
});

Deno.test("materializePartsOrderFromQuote skips when quote has no part lines", async () => {
  const mock = createMockAdmin({
    quote: {
      id: QUOTE_ID,
      workspace_id: WORKSPACE,
      deal_id: DEAL_ID,
      contact_id: null,
    },
    deal: {
      company_id: COMPANY_ID,
      workspace_id: WORKSPACE,
    },
    partLines: [],
  });

  const result = await materializePartsOrderFromQuote(mock.admin, QUOTE_ID);

  assertEquals(result, { status: "skipped", reason: "no_part_lines" });
  assertEquals(mock.partsOrders.length, 0);
});

Deno.test("materializePartsOrderFromQuote is idempotent when order already exists", async () => {
  const existingOrderId = "existing-order-id";
  const mock = createMockAdmin({
    existingOrder: {
      id: existingOrderId,
      quote_package_id: QUOTE_ID,
    },
    quote: {
      id: QUOTE_ID,
      workspace_id: WORKSPACE,
      deal_id: DEAL_ID,
      contact_id: null,
    },
    deal: {
      company_id: COMPANY_ID,
      workspace_id: WORKSPACE,
    },
    partLines: [{
      id: "line-1",
      line_type: "part",
      description: "Filter",
      quantity: 1,
      unit_price: 10,
      extended_price: 10,
      metadata: { part_number: "FILTER-01" },
      display_order: 0,
    }],
  });

  const result = await materializePartsOrderFromQuote(mock.admin, QUOTE_ID);

  assertEquals(result, {
    status: "skipped",
    reason: "already_materialized",
    partsOrderId: existingOrderId,
  });
  assertEquals(mock.partsOrders.length, 1);
});

Deno.test("materializePartsOrderFromQuote rejects workspace mismatch on deal anchor", async () => {
  const mock = createMockAdmin({
    quote: {
      id: QUOTE_ID,
      workspace_id: WORKSPACE,
      deal_id: OTHER_WORKSPACE_DEAL_ID,
      contact_id: null,
    },
    partLines: [{
      id: "line-1",
      line_type: "part",
      description: "Filter",
      quantity: 1,
      unit_price: 10,
      extended_price: 10,
      metadata: { part_number: "FILTER-01" },
      display_order: 0,
    }],
  });

  const result = await materializePartsOrderFromQuote(mock.admin, QUOTE_ID);

  assertEquals(result, { status: "skipped", reason: "workspace_mismatch" });
  assertEquals(mock.partsOrders.length, 0);
});

Deno.test("materializePartsOrderFromQuote treats unique-index race as already materialized", async () => {
  const racedOrderId = "raced-order-id";
  const mock = createMockAdmin({
    quote: {
      id: QUOTE_ID,
      workspace_id: WORKSPACE,
      deal_id: DEAL_ID,
      contact_id: null,
    },
    deal: {
      company_id: COMPANY_ID,
      workspace_id: WORKSPACE,
    },
    partLines: [{
      id: "line-1",
      line_type: "part",
      description: "Filter",
      quantity: 1,
      unit_price: 10,
      extended_price: 10,
      metadata: { part_number: "FILTER-01" },
      display_order: 0,
    }],
    insertConflict: true,
  });
  mock.partsOrders.push({
    id: racedOrderId,
    quote_package_id: QUOTE_ID,
  });

  const result = await materializePartsOrderFromQuote(mock.admin, QUOTE_ID);

  assertEquals(result, {
    status: "skipped",
    reason: "already_materialized",
    partsOrderId: racedOrderId,
  });
});
