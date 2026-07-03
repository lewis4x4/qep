import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "712_a36_deal_iq_sidebar_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("712_a36_deal_iq_sidebar_closeout.sql contract", () => {
  it("marks only A3.6 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.6'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.5'");
    expect(compactSql).not.toContain("where task_id = 'a3.8'");
  });

  it("records Deal IQ margin, win probability, commission status, and risk evidence", () => {
    expect(compactSql).toContain("computedealiqsummary");
    expect(compactSql).toContain("margin_below_floor");
    expect(compactSql).toContain("trade_above_max");
    expect(compactSql).toContain("discount_above_cap");
    expect(compactSql).toContain("win probability summary");
    expect(compactSql).toContain("commission readiness status");
    expect(compactSql).toContain("dealiqsummarycard.tsx internal only badge");
  });

  it("documents customer-artifact leak guards and commission policy boundaries", () => {
    expect(compactSql).toContain("forbidden_customer_internal_economics_prose");
    expect(compactSql).toContain("customer artifact leak guard");
    expect(compactSql).toContain("commission is status-only until a signed commission-dollar plan feed exists");
    expect(compactSql).toContain("qa-r2 commission-dollar rule signoff");
    expect(compactSql).toContain("mission_alignment");
  });
});
