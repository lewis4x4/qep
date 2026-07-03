import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "700_i41_build_parts_sheet_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("700_i41_build_parts_sheet_closeout.sql contract", () => {
  it("marks only I4.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i4.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i3.1'");
    expect(compactSql).not.toContain("where task_id = 'i5.1'");
  });

  it("records build parts sheet header, line, rollup, and view evidence", () => {
    expect(compactSql).toContain("644_grapple_build_child_entities.sql");
    expect(compactSql).toContain("public.grapple_build_parts_sheets");
    expect(compactSql).toContain("public.grapple_build_parts_sheet_lines");
    expect(compactSql).toContain("public.grapple_build_parts_sheet_recalculate(uuid)");
    expect(compactSql).toContain("public.v_grapple_build_parts_sheets");
    expect(compactSql).toContain("public.v_grapple_build_parts_sheet_lines");
    expect(compactSql).toContain("creategrapplepartssheet");
    expect(compactSql).toContain("addgrapplepartssheetline");
    expect(compactSql).toContain("lockgrapplepartssheet");
  });

  it("writes mission-aligned sync event evidence and preserves production/service separation", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("against the grapple build itself");
    expect(compactSql).toContain("without creating a service work order or counter sale");
  });
});
