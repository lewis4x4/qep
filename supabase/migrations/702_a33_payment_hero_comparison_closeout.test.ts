import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "702_a33_payment_hero_comparison_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("702_a33_payment_hero_comparison_closeout.sql contract", () => {
  it("marks only A3.3 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.3'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.2'");
    expect(compactSql).not.toContain("where task_id = 'a3.4'");
  });

  it("records payment comparison evidence across UI, save, proposal, PDF, and public payloads", () => {
    expect(compactSql).toContain("financingstep.tsx");
    expect(compactSql).toContain("customer-finance-comparison-preview");
    expect(compactSql).toContain("formataprsourceattribution");
    expect(compactSql).toContain("buildquotesavepayload financing_scenarios");
    expect(compactSql).toContain("quotepdfdocument.tsx financingcard");
    expect(compactSql).toContain("buildfinancegrid");
    expect(compactSql).toContain("buildpublicdealroompayload");
  });

  it("documents APR, lease gating, selected-only output, and payment-hero safety bounds", () => {
    expect(compactSql).toContain("apr source");
    expect(compactSql).toContain("disabled lease scenarios are excluded");
    expect(compactSql).toContain("selected scenario");
    expect(compactSql).toContain("payment amount is emphasized as the hero field");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("manual_boundaries");
  });
});
