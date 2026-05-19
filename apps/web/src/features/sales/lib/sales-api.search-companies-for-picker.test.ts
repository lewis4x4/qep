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

const rowsByField = new Map<string, CompanyRow[]>();
const calls: Array<{ table: string; field?: string; pattern?: string; workspace?: string }> = [];

function makeSelectChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = mock(() => chain);
  chain.eq = mock((field: string, value: string) => {
    if (field === "workspace_id") calls.push({ table, workspace: value });
    return chain;
  });
  chain.is = mock(() => chain);
  chain.ilike = mock((field: string, pattern: string) => {
    calls.push({ table, field, pattern });
    return chain;
  });
  chain.order = mock(() => chain);
  chain.limit = mock(async () => {
    const lastField = [...calls].reverse().find((call) => call.table === table && call.field)?.field;
    return { data: lastField ? rowsByField.get(lastField) ?? [] : [], error: null };
  });
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
    storage: { from: mock(() => ({ upload: mock(async () => ({ error: null })) })) },
  },
}));

const { searchCompaniesForPicker } = await import("./sales-api");

describe("searchCompaniesForPicker", () => {
  beforeEach(() => {
    rowsByField.clear();
    calls.length = 0;
  });

  test("returns empty when query is shorter than 2 chars", async () => {
    const rows = await searchCompaniesForPicker("d", 8);
    expect(rows).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("searches workspace companies and maps them to RepCustomer shape", async () => {
    rowsByField.set("search_1", [
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
    ]);

    const rows = await searchCompaniesForPicker("DREC", 8);

    expect(calls).toContainEqual({ table: "crm_companies", workspace: "ws-1" });
    expect(calls).toContainEqual({ table: "crm_companies", field: "search_1", pattern: "%DREC%" });
    expect(rows[0]).toMatchObject({
      customer_id: "c-1",
      company_name: "DREC Holdings",
      search_1: "DREC",
      primary_contact_phone: "(555) 111-2233",
      open_deals: 0,
      active_quotes: 0,
    });
  });

  test("deduplicates matches from multiple fields and respects the limit", async () => {
    const row = {
      id: "c-1",
      name: "Precision Landworks",
      dba: null,
      search_1: "PLW",
      search_2: "P100",
      city: "Waco",
      state: "TX",
      phone: "555-222-1000",
    };
    rowsByField.set("name", [row]);
    rowsByField.set("phone", [row]);

    const rows = await searchCompaniesForPicker("Precision", 1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.customer_id).toBe("c-1");
  });
});
