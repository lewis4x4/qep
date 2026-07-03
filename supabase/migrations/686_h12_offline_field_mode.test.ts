import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "686_h12_offline_field_mode.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("686_h12_offline_field_mode.sql contract", () => {
  it("marks H12.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'h12.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
  });

  it("records offline field mode implementation evidence", () => {
    expect(compactSql).toContain("service-offline-field-mode.ts");
    expect(compactSql).toContain("servicetechnicianmobilepage.tsx");
    expect(compactSql).toContain("recordsegmentlabor/uploadandrecordsegmentphoto");
    expect(compactSql).toContain("service-job-router/index.ts record_segment_labor");
    expect(compactSql).toContain("service-job-router-h12-source.test.ts");
  });

  it("writes mission-aligned no-signal capture evidence", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("no-signal conditions");
    expect(compactSql).toContain("meter, three-c, labor, and photo evidence");
  });
});

