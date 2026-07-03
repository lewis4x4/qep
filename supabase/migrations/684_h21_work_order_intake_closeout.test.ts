import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "684_h21_work_order_intake_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("684_h21_work_order_intake_closeout.sql contract", () => {
  it("marks H2.1 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'h2.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to intake schema and router enforcement evidence", () => {
    expect(compactSql).toContain("633_service_h2_intake_enum_values.sql");
    expect(compactSql).toContain("634_service_h2_intake_header_fields.sql");
    expect(compactSql).toContain("service-intake-hardening.ts");
    expect(compactSql).toContain("service-job-router/index.ts");
    expect(compactSql).toContain("seven owner-required work-order types");
    expect(compactSql).toContain("mandatory hour-meter");
    expect(compactSql).toContain("grapple-truck miles");
    expect(compactSql).toContain("three-cs");
    expect(compactSql).toContain("road-job site details");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("h21_work_order_intake_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("service writers");
    expect(compactSql).toContain("operations accept work");
  });
});
