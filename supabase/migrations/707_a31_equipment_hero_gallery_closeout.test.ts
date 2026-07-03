import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "707_a31_equipment_hero_gallery_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("707_a31_equipment_hero_gallery_closeout.sql contract", () => {
  it("marks only A3.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.2'");
    expect(compactSql).not.toContain("where task_id = 'a3.8'");
  });

  it("records the customer-safe equipment gallery implementation evidence", () => {
    expect(compactSql).toContain("quote-proposal-data.ts");
    expect(compactSql).toContain("quotepdfdocument.tsx");
    expect(compactSql).toContain("quote-print-html.ts");
    expect(compactSql).toContain("buildlinemedia");
    expect(compactSql).toContain("buildcovergalleryunits");
    expect(compactSql).toContain("covergallery");
  });

  it("documents safety limits for quote cover media", () => {
    expect(compactSql).toContain("customer-safe equipment media");
    expect(compactSql).toContain("rejects private or unsafe media urls");
    expect(compactSql).toContain("dedupes and limits each unit to five photos");
    expect(compactSql).toContain("excludes attachment/trade/internal media");
    expect(compactSql).toContain("mission_alignment");
  });
});
