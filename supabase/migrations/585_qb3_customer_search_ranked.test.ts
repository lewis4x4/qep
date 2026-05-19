import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "585_qb3_customer_search_ranked.sql"
);

const sql = readFileSync(migrationPath, "utf8");

describe("585_qb3_customer_search_ranked.sql regressions", () => {
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
});
