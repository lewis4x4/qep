import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "681_h61_scheduling_dispatch.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("681_h61_scheduling_dispatch.sql contract", () => {
  it("creates one live schedule view for all open service jobs", () => {
    expect(compactSql).toContain("create or replace view public.v_service_live_schedule");
    expect(compactSql).toContain("where j.closed_at is null and j.deleted_at is null");
    expect(compactSql).toContain("needs_schedule_and_assignment");
    expect(compactSql).toContain("field_dispatch_ready");
    expect(compactSql).toContain("mobile_dispatch_payload");
    expect(compactSql).toContain("grant select on public.v_service_live_schedule");
  });

  it("ranks technician candidates by H6 suitability signals", () => {
    expect(compactSql).toContain("create or replace function public.service_schedule_assignment_candidates");
    expect(compactSql).toContain("branch_match");
    expect(compactSql).toContain("shop_field_eligible");
    expect(compactSql).toContain("brands_supported");
    expect(compactSql).toContain("technician_oem_certifications");
    expect(compactSql).toContain("technician_in_house_certifications");
    expect(compactSql).toContain("capacity_remaining_hours");
    expect(compactSql).toContain("suitability_score");
    expect(compactSql).toContain("manager remains final approver");
  });

  it("marks H6.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'h6.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("whiteboard dependence");
    expect(compactSql).toContain("service managers get one live schedule");
  });
});
