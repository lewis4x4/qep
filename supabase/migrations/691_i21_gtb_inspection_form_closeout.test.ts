import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "691_i21_gtb_inspection_form_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("691_i21_gtb_inspection_form_closeout.sql contract", () => {
  it("marks only I2.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i2.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i3.1'");
    expect(compactSql).not.toContain("where task_id = 'i4.1'");
  });

  it("records first-class GTB inspection evidence", () => {
    expect(compactSql).toContain("644_grapple_build_child_entities.sql");
    expect(compactSql).toContain("public.grapple_build_gtb_inspections");
    expect(compactSql).toContain("public.grapple_build_gtb_inspection_items");
    expect(compactSql).toContain("public.grapple_build_gtb_inspection_recalculate");
    expect(compactSql).toContain("public.v_grapple_build_gtb_inspections");
    expect(compactSql).toContain("creategrapplegtbinspection");
    expect(compactSql).toContain("completegrapplegtbinspection");
    expect(compactSql).toContain("gtb inspection card");
  });

  it("writes mission-aligned sync event evidence and preserves service inspection separation", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("management concrete quality evidence");
    expect(compactSql).toContain("outside service inspection checklists");
  });
});
