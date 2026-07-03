import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "697_i11_grapple_build_pipeline_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("697_i11_grapple_build_pipeline_closeout.sql contract", () => {
  it("marks only I1.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i1.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i8.1'");
  });

  it("records standalone grapple production pipeline evidence", () => {
    expect(compactSql).toContain("643_grapple_truck_production_pipeline.sql");
    expect(compactSql).toContain("public.grapple_builds");
    expect(compactSql).toContain("public.grapple_build_stage_events");
    expect(compactSql).toContain("public.create_grapple_build");
    expect(compactSql).toContain("public.transition_grapple_build_stage");
    expect(compactSql).toContain("public.v_grapple_build_pipeline");
    expect(compactSql).toContain("public.v_grapple_build_stage_summary");
    expect(compactSql).toContain("public.v_grapple_build_dashboard_timeline");
    expect(compactSql).toContain("grappleproductiondashboardpage.tsx");
    expect(compactSql).toContain("/service/grapple");
  });

  it("writes mission-aligned sync event evidence and preserves the service boundary", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("dedicated grapple-truck production command surface");
    expect(compactSql).toContain("without contaminating the service work-order lifecycle");
    expect(compactSql).toContain("without creating or depending on service_jobs");
  });
});
