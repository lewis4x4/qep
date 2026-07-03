import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "695_h14_customer_communication_closeout.sql",
);
const h14MigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "640_service_h14_customer_communication.sql",
);
const lifecyclePath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "service-lifecycle-notify.ts",
);
const queuePath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "service-customer-notification-queue.ts",
);
const routerPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "service-job-router",
  "index.ts",
);
const dispatchPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "service-customer-notify-dispatch",
  "index.ts",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();
const h14Sql = readFileSync(h14MigrationPath, "utf8").replace(/\s+/g, " ").toLowerCase();
const lifecycleSource = readFileSync(lifecyclePath, "utf8");
const queueSource = readFileSync(queuePath, "utf8");
const routerSource = readFileSync(routerPath, "utf8");
const dispatchSource = readFileSync(dispatchPath, "utf8");

describe("695_h14_customer_communication_closeout.sql contract", () => {
  it("marks H14.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'h14.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
  });

  it("records idempotent queue storage for customer notification events", () => {
    expect(h14Sql).toContain("alter table public.service_customer_notifications add column if not exists dedupe_key");
    expect(h14Sql).toContain("idx_scn_h14_dedupe_key");
    expect(h14Sql).toContain("idx_scn_h14_pending_dispatch");
    expect(compactSql).toContain("640_service_h14_customer_communication.sql");
  });

  it("locks the H14 stage and promised-date notification mapping", () => {
    for (const sourceNeedle of [
      'case "quote_sent":',
      'await queueCustomerOutbound("awaiting_approval")',
      'case "in_progress":',
      'await queueCustomerOutbound("job_started")',
      'case "blocked_waiting":',
      '"on_hold_parts"',
      'case "ready_for_pickup":',
      'await queueCustomerOutbound("ready_for_pickup")',
      'export async function notifyPromisedDateChanged',
    ]) {
      expect(lifecycleSource).toContain(sourceNeedle);
    }
    expect(compactSql).toContain("quote_sent/awaiting approval");
    expect(compactSql).toContain("promised_at changes");
  });

  it("keeps provider dispatch optional while still queueing portal/email/sms notifications", () => {
    expect(queueSource).toContain('type QueueChannel = "portal" | "email" | "sms"');
    expect(queueSource).toContain("recorded_no_external_recipient");
    expect(queueSource).toContain("service_customer_contact_missing");
    expect(queueSource).toContain("isDuplicateError");
    expect(dispatchSource).toContain("TWILIO_ACCOUNT_SID");
    expect(dispatchSource).toContain("RESEND_API_KEY");
    expect(dispatchSource).toContain("skipped_no_credentials_or_recipient");
  });

  it("records router hooks that fire the lifecycle notifications automatically", () => {
    expect(routerSource).toContain("await notifyAfterStageChange(");
    expect(routerSource).toContain("await notifyPromisedDateChanged(");
    expect(routerSource).toContain('event_type: "promised_date_changed"');
    expect(compactSql).toContain("service-job-router/index.ts transition/update hooks");
  });

  it("writes mission-aligned sync event evidence", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("fewer status-check calls");
    expect(compactSql).toContain("safe email/sms dispatch fallback");
  });
});
