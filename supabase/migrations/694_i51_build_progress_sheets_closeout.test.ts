import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "694_i51_build_progress_sheets_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("694_i51_build_progress_sheets_closeout.sql contract", () => {
  it("marks only I5.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i5.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i4.1'");
    expect(compactSql).not.toContain("where task_id = 'i6.1'");
  });

  it("records the cross-department progress-sheet evidence", () => {
    expect(compactSql).toContain("645_grapple_build_progress_qc_timeline.sql");
    expect(compactSql).toContain("public.grapple_build_can_read_progress(text)");
    expect(compactSql).toContain("public.v_grapple_build_progress_sheets");
    expect(compactSql).toContain("grapple_builds_select_progress_sales_service");
    expect(compactSql).toContain("grapple_build_stage_events_select_progress_sales_service");
    expect(compactSql).toContain("normalizegrappleprogresssheetrows");
  });

  it("writes mission-aligned sync event evidence and preserves read-only visibility", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("sales and service can read live grapple build progress");
    expect(compactSql).toContain("without granting build management rights");
  });
});
