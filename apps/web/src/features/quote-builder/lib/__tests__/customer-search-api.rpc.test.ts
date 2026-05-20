import { beforeEach, describe, expect, mock, test } from "bun:test";

type RankedRow = {
  row_kind: "contact" | "company";
  contact_id: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  company_id: string | null;
  company_name: string | null;
  company_dba: string | null;
  company_phone: string | null;
  company_city: string | null;
  company_state: string | null;
  company_classification: string | null;
  phone_match: boolean | null;
};

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcRows: RankedRow[] = [];

function rowsForTable(table: string) {
  if (table === "crm_companies") {
    const companyRows = rpcRows
      .filter((row) => row.company_id)
      .map((row) => ({ id: row.company_id, name: row.company_name ?? "Customer", city: row.company_city, state: row.company_state }));
    return Array.from(new Map(companyRows.map((row) => [row.id, row])).values());
  }
  return [];
}

function makeSelectChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = mock(() => chain);
  chain.eq = mock(() => chain);
  chain.in = mock(() => chain);
  chain.is = mock(() => chain);
  chain.not = mock(() => chain);
  chain.order = mock(() => chain);
  chain.limit = mock(() => chain);
  chain.maybeSingle = mock(async () => ({ data: { active_workspace_id: "ws-1" }, error: null }));
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: rowsForTable(table), error: null }).then(resolve, reject);
  return chain;
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: mock(async () => ({ data: { user: { id: "rep-1" } } })) },
    from: mock((table: string) => makeSelectChain(table)),
    rpc: mock(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: rpcRows, error: null };
    }),
  },
}));

const { searchCustomers } = await import("../customer-search-api");

describe("searchCustomers ranked RPC integration", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcRows = [];
  });

  test("passes formatted phone queries through the QB ranked RPC", async () => {
    await searchCustomers("(352) 555-0100", 5);

    expect(rpcCalls).toEqual([
      {
        name: "search_customer_picker_ranked",
        args: { p_query: "(352) 555-0100", p_workspace_id: "ws-1", p_limit: 5 },
      },
    ]);
  });

  test("passes unformatted phone queries through the QB ranked RPC", async () => {
    await searchCustomers("3525550100", 5);

    expect(rpcCalls).toEqual([
      {
        name: "search_customer_picker_ranked",
        args: { p_query: "3525550100", p_workspace_id: "ws-1", p_limit: 5 },
      },
    ]);
  });

  test("preserves phone-first ranked RPC rows under client limit pressure", async () => {
    rpcRows = [
      {
        row_kind: "company",
        contact_id: null,
        contact_name: null,
        contact_title: null,
        contact_email: null,
        contact_phone: null,
        company_id: "co-phone",
        company_name: "Phone Match Excavating",
        company_dba: null,
        company_phone: "(352) 555-0100",
        company_city: "Ocala",
        company_state: "FL",
        company_classification: null,
        phone_match: true,
      },
      {
        row_kind: "company",
        contact_id: null,
        contact_name: null,
        contact_title: null,
        contact_email: null,
        contact_phone: null,
        company_id: "co-fuzzy",
        company_name: "352 Earthworks",
        company_dba: null,
        company_phone: "(999) 111-2222",
        company_city: "Tampa",
        company_state: "FL",
        company_classification: null,
        phone_match: false,
      },
    ];

    const rows = await searchCustomers("3525550100", 1);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "company",
      companyId: "co-phone",
      companyPhone: "(352) 555-0100",
      phoneMatch: true,
    });
  });
});
