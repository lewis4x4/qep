import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "718_a57_margin_exception_report_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("718_a57_margin_exception_report_closeout.sql contract", () => {
  it("marks only A5.7 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a5.7'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a5.6'");
    expect(compactSql).not.toContain("where task_id = 'a5.8'");
  });

  it("records the owner-only margin report view and route evidence", () => {
    expect(compactSql).toContain("602_v_margin_exceptions.sql");
    expect(compactSql).toContain("joins qb_margin_exceptions to latest quote_approval_cases");
    expect(compactSql).toContain("workspace and owner gating");
    expect(compactSql).toContain("fetchownermarginexceptions");
    expect(compactSql).toContain("/owner/margin-exceptions route");
  });

  it("documents read-only safety bounds and manual adoption boundaries", () => {
    expect(compactSql).toContain("report is read-only");
    expect(compactSql).toContain("no duplicate margin exception persistence store is introduced");
    expect(compactSql).toContain("no qb-12 draft reason logging semantics are changed");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("production owner review cadence");
  });
});
