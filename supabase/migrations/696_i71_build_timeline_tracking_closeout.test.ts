import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "696_i71_build_timeline_tracking_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("696_i71_build_timeline_tracking_closeout.sql contract", () => {
  it("marks only I7.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i7.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i6.1'");
    expect(compactSql).not.toContain("where task_id = 'i8.1'");
  });

  it("records stage-event timeline evidence without duplicating the event log", () => {
    expect(compactSql).toContain("645_grapple_build_progress_qc_timeline.sql");
    expect(compactSql).toContain("public.grapple_build_stage_events");
    expect(compactSql).toContain("public.transition_grapple_build_stage(uuid, text, text, jsonb)");
    expect(compactSql).toContain("public.v_grapple_build_timeline");
    expect(compactSql).toContain("public.v_grapple_build_dashboard_timeline");
    expect(compactSql).toContain("public.v_grapple_build_progress_sheets");
    expect(compactSql).toContain("stage_durations duration_seconds/duration_hours rollups");
    expect(compactSql).toContain("without a duplicate log");
  });

  it("writes mission-aligned sync event evidence for build duration reporting", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("duration and transition history");
    expect(compactSql).toContain("equipment delivery predictability");
    expect(compactSql).toContain("normalizegrappletimelinerows");
    expect(compactSql).toContain("timelinedurationspanel");
  });
});
