import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "623_qep_cc_export_detail.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("623_qep_cc_export_detail.sql Command Center detail contract", () => {
  it("returns owner_kind on every decision item", () => {
    expect(compactSql).toContain("'owner_kind', owner_kind");
    expect(compactSql).toContain("select id, title, owner, owner_kind, risk_class");
    expect(compactSql).toContain("end::text as owner_kind");
  });

  it("classifies QEP/client decision owners separately from operator-only decisions", () => {
    expect(compactSql).toContain("then 'client'");
    expect(compactSql).toContain("client|customer|qep|rylee|ryan|angela|tina|norman|juan|bobby|david");
    expect(compactSql).toContain("then 'unknown'");
    expect(compactSql).toContain("else 'operator'");
  });

  it("lets client classification win for mixed owners like Brian/Rylee", () => {
    const clientBranch = compactSql.indexOf("then 'client'");
    const unknownBranch = compactSql.indexOf("then 'unknown'");
    const operatorBranch = compactSql.indexOf("else 'operator'");

    expect(clientBranch).toBeGreaterThan(-1);
    expect(unknownBranch).toBeGreaterThan(clientBranch);
    expect(operatorBranch).toBeGreaterThan(unknownBranch);
  });
});
