import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "656_fl_discretionary_surtax_and_ship_to_sourcing.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

// Count the seeded county value tuples: each begins with ('global','FL',
const countyRowMatches = sql.match(/\('global','FL',/g) ?? [];

const REPRESENTATIVE_COUNTIES = [
  "Columbia",
  "Alachua",
  "Miami-Dade",
  "Duval",
  "Citrus",
  "Hillsborough",
  "St. Johns",
];

describe("656_fl_discretionary_surtax_and_ship_to_sourcing.sql contract", () => {
  it("seeds all 67 Florida counties", () => {
    expect(countyRowMatches.length).toBe(67);
  });

  it("wraps the seed in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });

  it("targets the shared global reference workspace and FL state", () => {
    expect(compactSql).toContain("insert into public.tax_jurisdictions");
    expect(sql).toContain("'global','FL'");
  });

  it("applies the 6% Florida state rate to every county", () => {
    // Each of the 67 rows carries 0.06 as the state rate immediately after
    // the jurisdiction_name column.
    const stateRateMatches = sql.match(/, FL',0\.06,/g) ?? [];
    expect(stateRateMatches.length).toBe(67);
  });

  it("carries the $5,000 per-item discretionary surtax cap", () => {
    expect(compactSql).toContain("5000");
    expect(compactSql).toContain("surtax_cap_amount");
    // per-item cap intent is documented in the header
    expect(compactSql).toContain("per single item");
    expect(compactSql).toContain("per line item");
  });

  it("is idempotent via ON CONFLICT ... DO UPDATE on the natural key", () => {
    expect(compactSql).toContain(
      "on conflict (workspace_id, state_code, county_name, effective_date) do update",
    );
  });

  it("labels the seed source as FL DR-15DSS 2026 with the 2026-01-01 effective date", () => {
    expect(compactSql).toContain("fl dr-15dss 2026");
    expect(compactSql).toContain("'2026-01-01'");
  });

  it("keeps Columbia County at 1.5% to match the tax-calculator contract test", () => {
    expect(sql).toContain(
      "('global','FL','Columbia','Columbia County, FL',0.06,0.015,5000",
    );
  });

  it("documents Ship-To (delivery) county sourcing", () => {
    expect(compactSql).toContain("ship-to");
    expect(compactSql).toContain("qrm_company_ship_to_addresses");
    expect(compactSql).toContain("tax_jurisdiction_override");
  });

  it("includes the representative counties used across QEP tax flows", () => {
    for (const county of REPRESENTATIVE_COUNTIES) {
      expect(sql).toContain(`'${county}'`);
    }
  });
});
