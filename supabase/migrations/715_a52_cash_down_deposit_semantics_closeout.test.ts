import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "715_a52_cash_down_deposit_semantics_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("715_a52_cash_down_deposit_semantics_closeout.sql contract", () => {
  it("marks only A5.2 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a5.2'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a5.3'");
    expect(compactSql).not.toContain("where task_id = 'a5.5'");
  });

  it("records separate cash down and good-faith deposit implementation evidence", () => {
    expect(compactSql).toContain("quote_packages.cash_down");
    expect(compactSql).toContain("quote_packages.deposit_required_amount");
    expect(compactSql).toContain("good-faith deposit (holds unit)");
    expect(compactSql).toContain("cash down (reduces financed balance)");
    expect(compactSql).toContain("amount financed = customer total - cash down");
    expect(compactSql).toContain("cash_down and deposit_required_amount persistence");
  });

  it("documents alias guards, proposal copy, and deposit policy boundaries", () => {
    expect(compactSql).toContain("legacy down_payment aliases hydrate to cashdown");
    expect(compactSql).toContain("legacy deposit aliases hydrate to depositrequiredamount");
    expect(compactSql).toContain("customer proposal output avoids cash down / deposit credit wording");
    expect(compactSql).toContain("miscellaneous pricing lines no longer instruct reps to enter down payment received");
    expect(compactSql).toContain("a5.3 sop deposit recommendation");
    expect(compactSql).toContain("mission_alignment");
  });
});
