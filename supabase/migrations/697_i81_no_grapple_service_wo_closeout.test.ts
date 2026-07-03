import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "697_i81_no_grapple_service_wo_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("697_i81_no_grapple_service_wo_closeout.sql contract", () => {
  it("marks only I8.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i8.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i7.1'");
    expect(compactSql).not.toContain("where task_id = 'j1.1'");
  });

  it("records migration, classifier, migration audit, and service-job guard evidence", () => {
    expect(compactSql).toContain("643_grapple_truck_production_pipeline.sql");
    expect(compactSql).toContain("public.grapple_builds");
    expect(compactSql).toContain("public.grapple_build_service_job_confidence");
    expect(compactSql).toContain("public.grapple_build_service_job_migrations");
    expect(compactSql).toContain("public.v_service_jobs_grapple_production_candidates");
    expect(compactSql).toContain("public.service_jobs_prevent_grapple_production_route()");
    expect(compactSql).toContain("public.service_jobs_freeze_migrated_grapple_production_lifecycle()");
    expect(compactSql).toContain("service_jobs.grapple_production_routing_status");
  });

  it("writes mission-aligned sync event evidence for separating production from service work orders", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("dedicated equipment build lifecycle");
    expect(compactSql).toContain("service work orders remain reserved for repair/service");
    expect(compactSql).toContain("createbuildpanel");
  });
});
