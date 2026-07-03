import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "680_e57_service_writer_workflow_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("680_e57_service_writer_workflow_closeout.sql contract", () => {
  it("marks E5.7 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'e5.7'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to the service-writer implementation evidence", () => {
    expect(compactSql).toContain("634_service_h2_intake_header_fields.sql");
    expect(compactSql).toContain("635_service_h3_estimate_authorization_gates.sql");
    expect(compactSql).toContain("637_service_h5_technician_execution_documentation.sql");
    expect(compactSql).toContain("machine year");
    expect(compactSql).toContain("mandatory hour-meter");
    expect(compactSql).toContain("no approval = no repair");
    expect(compactSql).toContain("service advisor review gate");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("e57_service_writer_workflow_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("equipment-service intake and authorization controls");
  });
});
