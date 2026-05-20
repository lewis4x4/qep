import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "586_qb3_customer_search_ranked.sql"
);

const sql = readFileSync(migrationPath, "utf8");
const sqlStatements = sql
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

function functionBody(functionName: string): string {
  const match = sql.match(
    new RegExp(`create or replace function public\\.${functionName}[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, "i"),
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("586_qb3_customer_search_ranked.sql regressions", () => {
  it("does not use invalid LIMIT st.lim syntax", () => {
    expect(sql).not.toContain("limit st.lim");
  });

  it("does not implement company picker via pre-limited customer wrapper", () => {
    const body = functionBody("search_companies_for_picker_ranked");

    expect(body).not.toContain("search_customer_picker_ranked(");
    expect(body).toContain("from company_candidates");
  });

  it("keeps workspace picker fallback read-only", () => {
    const body = functionBody("search_companies_for_picker_ranked");
    expect(body).not.toMatch(/\b(insert|update|delete|merge)\b/i);
    expect(
      sqlStatements.some((statement) =>
        /\bgrant\s+(insert|update|delete|all)\b/i.test(statement)
        && /\bto\s+authenticated\b/i.test(statement),
      ),
    ).toBe(false);
  });

  it("keeps both ranked picker functions phone-first before applying the limit", () => {
    for (const name of ["search_customer_picker_ranked", "search_companies_for_picker_ranked"]) {
      const body = functionBody(name);
      expect(body).toMatch(/order by\s+c\.phone_match desc,[\s\S]*limit \(select lim from params\)/i);
      expect(body).toContain("length(st.q_digits) >= 3");
    }
  });

  it("keeps DREC and legacy code search fields in the ranked picker functions", () => {
    for (const name of ["search_customer_picker_ranked", "search_companies_for_picker_ranked"]) {
      const body = functionBody(name);
      expect(body).toContain("coalesce(co.search_1, '') ilike st.q_pattern");
      expect(body).toContain("coalesce(co.search_2, '') ilike st.q_pattern");
    }
    expect(functionBody("search_companies_for_picker_ranked")).toContain("coalesce(co.legacy_customer_number, '') ilike st.q_pattern");
  });

  it("preserves v_rep_customers lateral primary-contact one-row-per-company shape", () => {
    const view = sql.match(/create or replace view public\.v_rep_customers[\s\S]*?order by opportunity_score desc, last_interaction desc nulls last;/i)?.[0] ?? "";

    expect(view).toContain("left join lateral");
    expect(view).toContain("limit 1");
    expect(view).toContain("pc.contact_name");
    expect(view).toContain("co.search_1");
    expect(view).toContain("co.search_2");
    expect(view).not.toMatch(/group by[\s\S]*\bct\.id\b/i);
  });
});
