import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "709_a55_expiration_followup_defaults_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("709_a55_expiration_followup_defaults_closeout.sql contract", () => {
  it("marks only A5.5 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a5.5'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a5.2'");
    expect(compactSql).not.toContain("where task_id = 'a5.6'");
  });

  it("records the centralized 30-day expiration and 3-day follow-up implementation evidence", () => {
    expect(compactSql).toContain("quote_expiration_default_days = 30");
    expect(compactSql).toContain("quote_follow_up_default_days = 3");
    expect(compactSql).toContain("buildquotelifecycledefaultdates");
    expect(compactSql).toContain("usequotebuilderdetailsdefaults.ts details/send default seeding");
    expect(compactSql).toContain("preserves existing expiresat and followupat");
  });

  it("documents send guards, persistence, mission alignment, and manual boundaries", () => {
    expect(compactSql).toContain("email/text readiness guard");
    expect(compactSql).toContain("expires_at and follow_up_at persistence");
    expect(compactSql).toContain("customer-facing email/text send remains blocked without follow-up");
    expect(compactSql).toContain("customer-facing email/text send remains blocked when follow-up is after expiration");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("production follow-up delivery monitoring");
  });
});
