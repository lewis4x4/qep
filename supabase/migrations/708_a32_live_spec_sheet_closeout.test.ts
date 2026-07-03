import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "708_a32_live_spec_sheet_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("708_a32_live_spec_sheet_closeout.sql contract", () => {
  it("marks only A3.2 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.2'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.1'");
    expect(compactSql).not.toContain("where task_id = 'a3.3'");
  });

  it("records structured manufacturer spec evidence across catalog, save, and proposal paths", () => {
    expect(compactSql).toContain("catalog-specs.ts");
    expect(compactSql).toContain("projectcatalogspecs");
    expect(compactSql).toContain("formatcatalogstructuredspec");
    expect(compactSql).toContain("quote-api.ts");
    expect(compactSql).toContain("structured_specs/spec_search_text/spec_source");
    expect(compactSql).toContain("metadataforcatalogentry");
    expect(compactSql).toContain("structuredspecbullets");
  });

  it("documents the free-text rejection and manufacturer-source safety boundaries", () => {
    expect(compactSql).toContain("rejects free-text-only");
    expect(compactSql).toContain("manufacturer_ingested");
    expect(compactSql).toContain("qb_equipment_models.specs");
    expect(compactSql).toContain("legacy spec_bullets as fallback");
    expect(compactSql).toContain("mission_alignment");
  });
});
