import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "705_j11_performance_appraisals_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("705_j11_performance_appraisals_closeout.sql contract", () => {
  it("marks only J1.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'j1.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i8.1'");
    expect(compactSql).not.toContain("where task_id = 'j2.1'");
  });

  it("records the seven-category appraisal, banding, raise, and signature evidence", () => {
    expect(compactSql).toContain("641_workforce_performance_appraisals.sql");
    expect(compactSql).toContain("public.employee_appraisal_scorecard_categories");
    expect(compactSql).toContain("public.employee_performance_appraisals");
    expect(compactSql).toContain("public.employee_performance_appraisal_scores");
    expect(compactSql).toContain("exactly seven active equal-weight categories");
    expect(compactSql).toContain("public.employee_appraisal_score_band(numeric)");
    expect(compactSql).toContain("public.employee_appraisal_recommended_raise_pct(numeric, numeric)");
    expect(compactSql).toContain("public.enforce_employee_performance_appraisal_finalize()");
  });

  it("writes mission-aligned sync event evidence for workforce appraisal operations", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("structured appraisal scorecards");
    expect(compactSql).toContain("signature accountability");
    expect(compactSql).toContain("workforceperformanceappraisalspage.tsx");
  });
});
