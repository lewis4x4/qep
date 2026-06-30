import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/653_qep_agent_runner_dispatcher.sql"),
  "utf8",
);
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("653_qep_agent_runner_dispatcher.sql", () => {
  it("marks F2.7 shipped with dispatcher evidence", () => {
    expect(compactSql).toContain("'f2.7'");
    expect(compactSql).toContain("'agent runner dispatcher'");
    expect(compactSql).toContain("'shipped'");
    expect(compactSql).toContain("scripts/agent-work-orders/dispatch.mjs");
    expect(compactSql).toContain(".github/workflows/qep-agent-work-orders.yml");
    expect(compactSql).toContain("external runners are only claimed when their command env var is configured");
  });

  it("keeps F2.8 open as the next progress-comment slice", () => {
    expect(compactSql).toContain("'f2.8'");
    expect(compactSql).toContain("'agent progress comments back to linear'");
    expect(compactSql).toContain("'not_started'");
    expect(compactSql).toContain("array['f2.6', 'f2.7']");
    expect(compactSql).toContain("wire runner checkpoints back to linear comments");
  });

  it("is idempotent and update-safe", () => {
    expect(compactSql).toContain("on conflict (task_id) do update set");
    expect(compactSql).toContain("when coalesce(public.qep_roadmap_tasks.notes, '') like '%' || excluded.notes || '%'");
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });
});
