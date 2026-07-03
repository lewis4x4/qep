import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "710_a56_review_margin_gated_send_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("710_a56_review_margin_gated_send_closeout.sql contract", () => {
  it("marks only A5.6 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a5.6'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a5.5'");
    expect(compactSql).not.toContain("where task_id = 'a5.7'");
  });

  it("records Review gating, note, and primary CTA evidence", () => {
    expect(compactSql).toContain("computereviewsendgate requires approvalcasecansend and packet readiness");
    expect(compactSql).toContain("computereviewapprovalsubmissionstate fails closed on unresolved margin floor");
    expect(compactSql).toContain("low-margin approval submission requires a non-empty note");
    expect(compactSql).toContain("packet readiness alone cannot bypass approval cansend");
    expect(compactSql).toContain("global primary cta cannot submit approval while a low-margin justification is required");
  });

  it("documents web/server margin agreement and manual boundaries", () => {
    expect(compactSql).toContain("configured margin floor drives approvalstate and packetreadiness");
    expect(compactSql).toContain("loadconfiguredmarginfloorpct");
    expect(compactSql).toContain("assertquotecustomershareable configured margin floor gate");
    expect(compactSql).toContain("send-package configured margin floor gate");
    expect(compactSql).toContain("approved_with_conditions requires condition evaluation before share or send");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("live manager approval uat");
  });
});
