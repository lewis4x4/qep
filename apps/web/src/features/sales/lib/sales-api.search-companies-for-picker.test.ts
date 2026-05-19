import { beforeEach, describe, expect, mock, test } from "bun:test";

type CompanyRow = {
  id: string;
  name: string | null;
  dba: string | null;
  search_1: string | null;
  search_2: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
};

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcRows: CompanyRow[] = [];

function makeSelectChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = mock(() => chain);
  chain.eq = mock((field: string, value: string) => {
    return chain;
  });
  chain.is = mock(() => chain);
  chain.ilike = mock(() => chain);
  chain.order = mock(() => chain);
  chain.limit = mock(async () => ({ data: [], error: null }));
  chain.maybeSingle = mock(async () => ({ data: { active_workspace_id: "ws-1" }, error: null }));
  chain.insert = mock(async () => ({ error: null }));
  chain.update = mock(() => chain);
  chain.in = mock(() => chain);
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
    storage: { from: mock(() => ({ upload: mock(async () => ({ error: null })) })) },
  },
}));

const { searchCompaniesForPicker } = await import("./sales-api");

describe("searchCompaniesForPicker", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcRows = [];
  });

  test("returns empty when query is shorter than 2 chars", async () => {
    const rows = await searchCompaniesForPicker("d", 8);
    expect(rows).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  test("calls ranked RPC and maps rows to RepCustomer shape", async () => {
    rpcRows = [
      {
        id: "c-1",
        name: "DREC Holdings",
        dba: null,
        search_1: "DREC",
        search_2: "D001",
        city: "Austin",
        state: "TX",
        phone: "(555) 111-2233",
      },
    ];

    const rows = await searchCompaniesForPicker("DREC", 8);

    expect(rpcCalls).toContainEqual({
      name: "search_companies_for_picker_ranked",
      args: { p_query: "DREC", p_workspace_id: "ws-1", p_limit: 8 },
    });
    expect(rows[0]).toMatchObject({
      customer_id: "c-1",
      company_name: "DREC Holdings",
      search_1: "DREC",
      primary_contact_phone: "(555) 111-2233",
      open_deals: 0,
      active_quotes: 0,
    });
  });

  test("passes formatted/unformatted phone query to ranked RPC", async () => {
    await searchCompaniesForPicker("(352) 555-0100", 5);
    expect(rpcCalls[0]).toEqual({
      name: "search_companies_for_picker_ranked",
      args: { p_query: "(352) 555-0100", p_workspace_id: "ws-1", p_limit: 5 },
    });
  });
});
