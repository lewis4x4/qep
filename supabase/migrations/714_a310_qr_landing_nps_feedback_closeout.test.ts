import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "714_a310_qr_landing_nps_feedback_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("714_a310_qr_landing_nps_feedback_closeout.sql contract", () => {
  it("marks only A3.10 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'a3.10'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'a3.8'");
    expect(compactSql).not.toContain("where task_id = 'a5.2'");
  });

  it("records QR landing, Deal Room, and NPS feedback evidence", () => {
    expect(compactSql).toContain("600_quote_customer_feedback.sql");
    expect(compactSql).toContain("quote-qr.ts safe public quote qr generation");
    expect(compactSql).toContain("scan for quote status, acceptance, and feedback");
    expect(compactSql).toContain("quotepdfdocument.tsx qr modules rendered in the pdf footer");
    expect(compactSql).toContain("branded /q/:share_token quote status landing");
    expect(compactSql).toContain("proposal feedback panel");
    expect(compactSql).toContain("handlepublicquotefeedback");
  });

  it("documents rep follow-up evidence, safety bounds, and manual deployment boundaries", () => {
    expect(compactSql).toContain("customer_lifecycle_events nps_response insert");
    expect(compactSql).toContain("crm_in_app_notifications quote_feedback_submitted insert");
    expect(compactSql).toContain("public-feedback requires a valid share_token");
    expect(compactSql).toContain("client_submission_id unique index dedupes repeat submissions");
    expect(compactSql).toContain("ip address is stored only as a sha-256 hash");
    expect(compactSql).toContain("live mobile-camera qr scan test");
    expect(compactSql).toContain("mission_alignment");
  });
});
