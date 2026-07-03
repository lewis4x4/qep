import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "742_a51_fuzzy_phone_search_closeout.sql");
const rankedSearchSql = readText("supabase", "migrations", "586_qb3_customer_search_ranked.sql");
const rankedSearchTest = readText("supabase", "migrations", "586_qb3_customer_search_ranked.test.ts");
const customerSearch = readText("apps", "web", "src", "features", "sales", "lib", "customer-search.ts");
const customerSearchTest = readText("apps", "web", "src", "features", "sales", "lib", "customer-search.test.ts");
const salesApi = readText("apps", "web", "src", "features", "sales", "lib", "sales-api.ts");
const salesApiTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "lib",
  "sales-api.search-companies-for-picker.test.ts",
);
const b52Closeout = readText("supabase", "migrations", "732_b52_customer_attach_search_closeout.sql");
const historicalGate = JSON.parse(
  readText("test-results", "agent-gates", "20260520T230316Z-A5.1-qb-3-fuzzy-phone-customer-search.json"),
) as { segment: string; verdict: string };

const compactCloseout = compact(closeoutSql);
const compactRankedSearchSql = compact(rankedSearchSql);
const compactRankedSearchTest = compact(rankedSearchTest);
const compactCustomerSearch = compact(customerSearch);
const compactCustomerSearchTest = compact(customerSearchTest);
const compactSalesApi = compact(salesApi);
const compactSalesApiTest = compact(salesApiTest);
const compactB52Closeout = compact(b52Closeout);

describe("742_a51_fuzzy_phone_search_closeout.sql contract", () => {
  it("marks only A5.1 shipped with mission and dependency evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'a5.1'");
    expect(compactCloseout).toContain("ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("partial phone digits");
    expect(compactCloseout).toContain("dependency_evidence");
    expect(compactCloseout).toContain("b5.2");
    expect(compactCloseout).toContain("732_b52_customer_attach_search_closeout.sql");
    expect(compactCloseout).not.toContain("where task_id = 'b5.2'");
    expect(compactCloseout).not.toContain("where task_id = 'a5.2'");
  });

  it("keeps manual and external-source boundaries explicit", () => {
    expect(compactCloseout).toContain("no live sales-rep uat");
    expect(compactCloseout).toContain("no external customer export");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).toContain("does not alter picker runtime behavior");
  });

  it("uses the shipped B5.2 closeout as the dependency proof", () => {
    expect(compactB52Closeout).toContain("where task_id = 'b5.2'");
    expect(compactB52Closeout).toContain("set ship_state = 'shipped'");
    expect(compactB52Closeout).toContain("search_companies_for_picker_ranked");
    expect(compactB52Closeout).toContain("phone-first before limit");
  });

  it("preserves phone-first ranked database search for quote-builder customer lookup", () => {
    expect(compactRankedSearchSql).toContain("create or replace function public.search_customer_picker_ranked");
    expect(compactRankedSearchSql).toContain("create or replace function public.search_companies_for_picker_ranked");
    expect(compactRankedSearchSql).toContain("security invoker");
    expect(compactRankedSearchSql).toContain("and (st.ws is null or co.workspace_id = st.ws)");
    expect(compactRankedSearchSql).toContain("regexp_replace(coalesce(co.phone, ''), '\\\\d', '', 'g') like ('%' || st.q_digits || '%')");
    expect(compactRankedSearchSql).toContain("order by c.phone_match desc");
    expect(compactRankedSearchSql).toContain("coalesce(co.search_1, '') ilike st.q_pattern");
    expect(compactRankedSearchSql).toContain("coalesce(co.search_2, '') ilike st.q_pattern");
    expect(compactRankedSearchSql).toContain("coalesce(co.legacy_customer_number, '') ilike st.q_pattern");
    expect(compactRankedSearchTest).toContain("keeps workspace picker fallback read-only");
    expect(compactRankedSearchTest).toContain("keeps both ranked picker functions phone-first before applying the limit");
  });

  it("keeps sales picker phone matching and RPC argument mapping covered", () => {
    expect(compactCustomerSearch).toContain("function digitsonly");
    expect(compactCustomerSearch).toContain("const phonedigits = digitsonly(customer.primary_contact_phone)");
    expect(compactCustomerSearch).toContain("querydigits.length >= 3 && phonedigits.includes(querydigits)");
    expect(compactCustomerSearchTest).toContain("matches phone across formatted/unformatted input");
    expect(compactCustomerSearchTest).toContain("matches search 1 by prefix");
    expect(compactCustomerSearchTest).toContain("matches search 2 by prefix");
    expect(compactSalesApi).toContain("export async function searchcompaniesforpicker");
    expect(compactSalesApi).toContain("supabase.rpc(\"search_companies_for_picker_ranked\"");
    expect(compactSalesApi).toContain("p_query: query");
    expect(compactSalesApi).toContain("p_workspace_id: wsid");
    expect(compactSalesApi).toContain("p_limit: limit");
    expect(compactSalesApiTest).toContain("passes formatted/unformatted phone query to ranked rpc");
  });

  it("references the historical A5.1 gate report as passing evidence", () => {
    expect(historicalGate.segment).toBe("A5.1-qb-3-fuzzy-phone-customer-search");
    expect(historicalGate.verdict).toBe("PASS");
    expect(compactCloseout).toContain("20260520t230316z-a5.1-qb-3-fuzzy-phone-customer-search.json");
  });
});
