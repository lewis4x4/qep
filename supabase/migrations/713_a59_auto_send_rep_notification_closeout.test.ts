import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "713_a59_auto_send_rep_notification_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("713_a59_auto_send_rep_notification_closeout.sql contract", () => {
  it("marks only A5.9 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a5.9'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a5.8'");
    expect(compactSql).not.toContain("where task_id = 'a5.10'");
  });

  it("records the three approved auto-send notification outcomes", () => {
    expect(compactSql).toContain("approved+auto-sent");
    expect(compactSql).toContain("approved+send-failed");
    expect(compactSql).toContain("approved+return-to-rep");
    expect(compactSql).toContain("auto-sent, send needs attention, and ready to send");
  });

  it("documents safety bounds and manual live-send boundaries", () => {
    expect(compactSql).toContain("does not claim customer delivery unless autosendresult.sent is true");
    expect(compactSql).toContain("sanitized failure_code");
    expect(compactSql).toContain("live provider delivery success");
    expect(compactSql).toContain("mission_alignment");
  });
});
