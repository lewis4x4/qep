import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "732_b52_customer_attach_search_closeout.sql");
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
const picker = readText("apps", "web", "src", "features", "sales", "components", "CustomerPickerInline.tsx");
const pickerTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "components",
  "SmartVoiceCapture.customer-picker.test.tsx",
);

const compactCloseout = compact(closeoutSql);
const compactRankedSearchSql = compact(rankedSearchSql);
const compactRankedSearchTest = compact(rankedSearchTest);
const compactCustomerSearch = compact(customerSearch);
const compactCustomerSearchTest = compact(customerSearchTest);
const compactSalesApi = compact(salesApi);
const compactSalesApiTest = compact(salesApiTest);
const compactPicker = compact(picker);
const compactPickerTest = compact(pickerTest);

describe("732_b52_customer_attach_search_closeout.sql contract", () => {
  it("marks only B5.2 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("correct customer");
    expect(compactCloseout).toContain("improving account memory");
    expect(compactCloseout).not.toContain("where task_id = 'b5.1'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.3'");
  });

  it("keeps manual and external-source boundaries explicit", () => {
    expect(compactCloseout).toContain("no live sales-rep uat");
    expect(compactCloseout).toContain("no external customer list import");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).toContain("does not alter customer picker runtime behavior");
  });

  it("matches local rep-book customers by legacy code and phone before fallback", () => {
    expect(compactCustomerSearch).toContain("function startswithlegacycode");
    expect(compactCustomerSearch).toContain("return value.tolowercase().startswith(query)");
    expect(compactCustomerSearch).toContain("function digitsonly");
    expect(compactCustomerSearch).toContain("const phonedigits = digitsonly(customer.primary_contact_phone)");
    expect(compactCustomerSearch).toContain("querydigits.length >= 3 && phonedigits.includes(querydigits)");
    expect(compactCustomerSearch).toContain("startswithlegacycode(customer.search_1, query)");
    expect(compactCustomerSearch).toContain("startswithlegacycode(customer.search_2, query)");
    expect(compactCustomerSearchTest).toContain("matches search 1 by prefix");
    expect(compactCustomerSearchTest).toContain("does not match legacy codes by mid-string");
    expect(compactCustomerSearchTest).toContain("matches phone across formatted/unformatted input");
    expect(compactCustomerSearchTest).toContain("matches drec legacy code by prefix");
  });

  it("debounces rep-book-first UI and only searches workspace fallback when needed", () => {
    expect(compactPicker).toContain("matchesrepcustomersearch(c, debounced)");
    expect(compactPicker).toContain(".slice(0, 12)");
    expect(compactPicker).toContain("const showfallback = debounced.length >= 2 && bookmatches.length === 0");
    expect(compactPicker).toContain("querykey: [\"sales\", \"smart-voice-capture\", \"ws-fallback\", debounced.tolowercase()]");
    expect(compactPicker).toContain("queryfn: ({ signal }) => searchcompanies(debounced, 8, signal)");
    expect(compactPicker).toContain("enabled: showfallback");
    expect(compactPicker).toContain("no rep-book match. showing workspace customer results.");
    expect(compactPicker).toContain("workspace");
  });

  it("locks picker fallback behavior with focused UI tests", () => {
    expect(compactPickerTest).toContain("keeps drec legacy prefix matches inside the rep book");
    expect(compactPickerTest).toContain("expect(searchcompaniesforpickermock).not.tohavebeencalled()");
    expect(compactPickerTest).toContain("finds precision land through workspace fallback when absent from first 100 rep-book rows");
    expect(compactPickerTest).toContain("expect(searchcalls[0].query).tobe(\"precision\")");
    expect(compactPickerTest).toContain("expect(searchcalls[0].limit).tobe(8)");
    expect(compactPickerTest).toContain("expect(searchcalls[0].signal).tobeinstanceof(abortsignal)");
    expect(compactPickerTest).toContain("no rep-book match. showing workspace customer results.");
    expect(compactPickerTest).toContain("{ id: \"workspace-precision-land\", name: \"precision land management\" }");
  });

  it("calls the ranked workspace RPC with active workspace and preserves phone queries", () => {
    expect(compactSalesApi).toContain("export async function searchcompaniesforpicker");
    expect(compactSalesApi).toContain("if (query.length < 2) return []");
    expect(compactSalesApi).toContain("const wsid = await getworkspaceid()");
    expect(compactSalesApi).toContain("supabase.rpc(\"search_companies_for_picker_ranked\"");
    expect(compactSalesApi).toContain("p_query: query");
    expect(compactSalesApi).toContain("p_workspace_id: wsid");
    expect(compactSalesApi).toContain("p_limit: limit");
    expect(compactSalesApi).toContain("abortsignal(signal)");
    expect(compactSalesApiTest).toContain("returns empty when query is shorter than 2 chars");
    expect(compactSalesApiTest).toContain("calls ranked rpc and maps rows to repcustomer shape");
    expect(compactSalesApiTest).toContain("passes formatted/unformatted phone query to ranked rpc");
    expect(compactSalesApiTest).toContain("name: \"search_companies_for_picker_ranked\"");
  });

  it("keeps the database fallback read-only, workspace-scoped, and phone-first", () => {
    expect(compactRankedSearchSql).toContain("create or replace function public.search_companies_for_picker_ranked");
    expect(compactRankedSearchSql).toContain("language sql");
    expect(compactRankedSearchSql).toContain("security invoker");
    expect(compactRankedSearchSql).toContain("and (st.ws is null or co.workspace_id = st.ws)");
    expect(compactRankedSearchSql).toContain("co.deleted_at is null");
    expect(compactRankedSearchSql).toContain("coalesce(co.search_1, '') ilike st.q_pattern");
    expect(compactRankedSearchSql).toContain("coalesce(co.search_2, '') ilike st.q_pattern");
    expect(compactRankedSearchSql).toContain("regexp_replace(coalesce(co.phone, ''), '\\\\d', '', 'g') like ('%' || st.q_digits || '%')");
    expect(compactRankedSearchSql).toContain("order by c.phone_match desc");
    expect(compactRankedSearchSql).toContain("grant execute on function public.search_companies_for_picker_ranked");
    expect(compactRankedSearchTest).toContain("keeps workspace picker fallback read-only");
    expect(compactRankedSearchTest).toContain("keeps both ranked picker functions phone-first before applying the limit");
    expect(compactRankedSearchTest).toContain("keeps drec and legacy code search fields in the ranked picker functions");
  });
});
