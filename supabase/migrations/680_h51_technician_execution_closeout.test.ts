import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "680_h51_technician_execution_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("680_h51_technician_execution_closeout.sql contract", () => {
  it("marks H5.1 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'h5.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to technician execution implementation evidence", () => {
    expect(compactSql).toContain("637_service_h5_technician_execution_documentation.sql");
    expect(compactSql).toContain("service-h5-execution.ts");
    expect(compactSql).toContain("service-job-router/index.ts");
    expect(compactSql).toContain("service-wo-gates.ts");
    expect(compactSql).toContain("per-segment diagnostic and repair sign-off");
    expect(compactSql).toContain("quoted-time overrun alerting");
    expect(compactSql).toContain("before/during/after service photo metadata");
    expect(compactSql).toContain("warranty-parts label and turn-in");
    expect(compactSql).toContain("service advisor documentation review");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("h51_technician_execution_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("auditable equipment repair execution controls");
    expect(compactSql).toContain("customer-visible labor stories");
  });
});
