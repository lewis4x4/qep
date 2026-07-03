import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "686_h41_hold_states_efficiency_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("686_h41_hold_states_efficiency_closeout.sql contract", () => {
  it("marks H4.1 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'h4.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to hold-state and efficiency implementation evidence", () => {
    expect(compactSql).toContain("636_service_h4_hold_states_efficiency_integrity.sql");
    expect(compactSql).toContain("service-hold-integrity.ts");
    expect(compactSql).toContain("service-metrics-api.ts");
    expect(compactSql).toContain("servicemetricsdashboardpage.tsx");
    expect(compactSql).toContain("five owner-named hold states");
    expect(compactSql).toContain("parts/sublet");
    expect(compactSql).toContain("warranty authorization");
    expect(compactSql).toContain("hold-excluded efficiency");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("h41_hold_states_efficiency_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("technician productivity");
    expect(compactSql).toContain("equipment repair hold trail");
  });
});
