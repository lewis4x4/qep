import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "712_a58_save_draft_reason_logging.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("712_a58_save_draft_reason_logging.sql contract", () => {
  it("widens quote package statuses with additive low-margin draft state", () => {
    expect(compactSql).toContain("drop constraint if exists quote_packages_status_check");
    expect(compactSql).toContain("add constraint quote_packages_status_check");
    expect(compactSql).toContain("'draft_low_margin'");
    expect(compactSql).toContain("manual low-margin save draft reason capture");
  });

  it("marks only A5.8 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a5.8'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a5.7'");
    expect(compactSql).not.toContain("where task_id = 'a5.9'");
  });

  it("records manual-save, autosave, and customer-facing safety bounds", () => {
    expect(compactSql).toContain("resolves configured margin floor during post /save");
    expect(compactSql).toContain("autosave saves remain ordinary draft");
    expect(compactSql).toContain("blocks draft_low_margin from share, pdf upload, and send paths");
    expect(compactSql).toContain("mission_alignment");
  });
});
