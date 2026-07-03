import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "678_h31_estimate_authorization_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("678_h31_estimate_authorization_closeout.sql contract", () => {
  it("marks H3.1 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'h3.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to approval gate implementation evidence", () => {
    expect(compactSql).toContain("635_service_h3_estimate_authorization_gates.sql");
    expect(compactSql).toContain("service-estimate-authorization.ts");
    expect(compactSql).toContain("service-job-router/index.ts");
    expect(compactSql).toContain("service-quote-engine/index.ts");
    expect(compactSql).toContain("serviceworkordergatepanels.tsx");
    expect(compactSql).toContain("no approval = no repair");
    expect(compactSql).toContain("10% re-authorization threshold");
    expect(compactSql).toContain("technician clock-on");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("h31_estimate_authorization_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("customer approval");
    expect(compactSql).toContain("scope reauthorization");
  });
});
