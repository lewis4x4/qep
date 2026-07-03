import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "675_f28_agent_progress_comments_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("675_f28_agent_progress_comments_closeout.sql contract", () => {
  it("marks F2.8 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'f2.8'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to dispatcher and workflow evidence", () => {
    expect(compactSql).toContain("scripts/agent-work-orders/dispatch.mjs");
    expect(compactSql).toContain(".github/workflows/qep-agent-work-orders.yml");
    expect(compactSql).toContain("675_f28_agent_progress_comments_closeout.sql");
    expect(compactSql).toContain("started");
    expect(compactSql).toContain("handoff-ready");
    expect(compactSql).toContain("runner-launched");
    expect(compactSql).toContain("done");
    expect(compactSql).toContain("failed");
    expect(compactSql).toContain("tests-green");
    expect(compactSql).toContain("pr-opened");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("f28_agent_progress_comments_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("linear becomes the visible control surface");
    expect(compactSql).toContain("runner vendors");
  });
});
