import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "710_a34_trade_market_context_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("710_a34_trade_market_context_closeout.sql contract", () => {
  it("marks only A3.4 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.4'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.3'");
    expect(compactSql).not.toContain("where task_id = 'a3.5'");
  });

  it("records trade-market context evidence across QRM, Deal IQ, and point-shoot trade", () => {
    expect(compactSql).toContain("trade-market-context.ts");
    expect(compactSql).toContain("trademarketcontextcard.tsx");
    expect(compactSql).toContain("rep-facing only");
    expect(compactSql).toContain("internal comparable market context");
    expect(compactSql).toContain("dealcoachsidebar.tsx");
    expect(compactSql).toContain("normalizetradevaluationproposalsnapshot");
  });

  it("documents the customer PDF safety boundary for trade valuation internals", () => {
    expect(compactSql).toContain("customer trade-in leak guards");
    expect(compactSql).toContain("customer proposal data strips deal iq and internal economics");
    expect(compactSql).toContain("excludes preliminary value, market midpoint, and comp-range prose");
    expect(compactSql).toContain("unsafe trade photo urls are rejected");
    expect(compactSql).toContain("mission_alignment");
  });
});
