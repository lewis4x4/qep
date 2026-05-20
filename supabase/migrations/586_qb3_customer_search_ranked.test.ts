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

describe("586_qb3_customer_search_ranked.sql regressions", () => {
  it("does not use invalid LIMIT st.lim syntax", () => {
    expect(sql).not.toContain("limit st.lim");
  });

  it("does not implement company picker via pre-limited customer wrapper", () => {
    const companyFn = sql.match(
      /create or replace function public\.search_companies_for_picker_ranked[\s\S]*?\$\$([\s\S]*?)\$\$;/i
    );

    expect(companyFn).not.toBeNull();
    expect(companyFn?.[1]).not.toContain("search_customer_picker_ranked(");
    expect(companyFn?.[1]).toContain("from company_candidates");
  });

  it("keeps workspace picker fallback read-only", () => {
    const companyFn = sql.match(
      /create or replace function public\.search_companies_for_picker_ranked[\s\S]*?\$\$([\s\S]*?)\$\$;/i
    );

    expect(companyFn).not.toBeNull();
    const body = companyFn?.[1] ?? "";
    expect(body).not.toMatch(/\b(insert|update|delete|merge)\b/i);
    expect(
      sqlStatements.some((statement) =>
        /\bgrant\s+(insert|update|delete|all)\b/i.test(statement)
        && /\bto\s+authenticated\b/i.test(statement),
      ),
    ).toBe(false);
  });
});
