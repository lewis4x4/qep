import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "685_h11_service_metrics_dashboard_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("685_h11_service_metrics_dashboard_closeout.sql contract", () => {
  it("marks H11.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'h11.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
  });

  it("records the H11 metrics backend and dashboard evidence", () => {
    expect(compactSql).toContain("638_service_h11_metrics_dashboard.sql");
    expect(compactSql).toContain("v_service_metrics_margin_by_request_type");
    expect(compactSql).toContain("v_service_metrics_owner_watch");
    expect(compactSql).toContain("v_service_metrics_cycle_time_by_segment");
    expect(compactSql).toContain("v_service_metrics_open_wo_by_status");
    expect(compactSql).toContain("v_service_metrics_open_wo_by_hold_reason");
    expect(compactSql).toContain("servicemetricsdashboardpage.tsx");
    expect(compactSql).toContain("service-metrics-api.test.ts");
  });

  it("writes mission-aligned sync event evidence", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("margin-by-wo-type first");
    expect(compactSql).toContain("first-touch evidence");
  });
});
