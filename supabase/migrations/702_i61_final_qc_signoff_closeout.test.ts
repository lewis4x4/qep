import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "702_i61_final_qc_signoff_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("702_i61_final_qc_signoff_closeout.sql contract", () => {
  it("marks only I6.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i6.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i5.1'");
    expect(compactSql).not.toContain("where task_id = 'i7.1'");
  });

  it("records the final QC and assigned Lead release-gate evidence", () => {
    expect(compactSql).toContain("645_grapple_build_progress_qc_timeline.sql");
    expect(compactSql).toContain("public.grapple_build_final_qc_checklists");
    expect(compactSql).toContain("public.grapple_build_final_qc_items");
    expect(compactSql).toContain("public.grapple_build_final_qc_release_gate(uuid)");
    expect(compactSql).toContain("public.sign_grapple_build_final_qc(uuid, text, text, text)");
    expect(compactSql).toContain("public.enforce_grapple_build_final_qc_release()");
    expect(compactSql).toContain("grapple_builds_final_qc_release_trg");
  });

  it("writes mission-aligned sync event evidence for release quality control", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("release-critical final qc checklist");
    expect(compactSql).toContain("assigned lead sign-off gate");
    expect(compactSql).toContain("finalqcpanel");
    expect(compactSql).toContain("releasegatepanel");
  });
});
