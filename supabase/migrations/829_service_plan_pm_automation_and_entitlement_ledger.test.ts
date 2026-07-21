import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/829_service_plan_pm_automation_and_entitlement_ledger.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();
const seedBlock =
  compact.split("-- 7. inactive blackrock first-pass catalog")[1]
    ?.split("-- 8. deterministic daily due scanner")[0] ?? "";

function functionSql(name: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("829 reviewed service-plan PM automation", () => {
  it("seeds only the default-workspace BlackRock catalog as inactive draft data", () => {
    expect(compact).toContain("'br-draft-pm-250'");
    expect(compact).toContain("'br-draft-pm-500'");
    expect(compact).toContain("'br-draft-pm-1000'");
    expect(compact).toContain("'default', 'br-draft-pm-250'");
    expect(compact).toContain("'status', 'provisional_not_customer_live'");
    expect(compact).toContain(
      "set is_provisional = true, review_status = 'draft', is_active = false",
    );
    expect(seedBlock).not.toContain("select distinct workspace_id");
    expect(seedBlock).not.toContain("from public.profiles");
  });

  it("makes review a recorded pre-activation gate", () => {
    const guard = functionSql("guard_service_agreement_program_activation");
    expect(guard).toContain("old.review_status <> 'reviewed'");
    expect(guard).toContain("old.is_provisional");
    expect(guard).toContain("previously recorded qep-reviewed");
    expect(guard).toContain("separate review transition");
    expect(guard).not.toContain("separate transaction");
    expect(guard).not.toContain("committed service agreement review evidence");
    expect(guard).toContain("at least one active interval");
    expect(compact).toContain(
      "deactivate the service agreement program before changing intervals",
    );
    expect(compact).toContain(
      "version the service agreement program instead of changing intervals for active enrollments",
    );
    expect(compact).toContain("reset_program_review_after_interval_change");
  });

  it("models hour-or-calendar whichever arrives first", () => {
    expect(compact).toContain(
      "interval_hours is not null or interval_months is not null or interval_days is not null",
    );
    const scan = functionSql("service_plan_scan_due_pm_internal");
    expect(scan).toContain("s.next_due_on <= p_as_of");
    expect(scan).toContain("meter.hours >= s.next_due_hours");
    expect(scan).toContain("then 'hours_and_calendar'");
    expect(scan).toContain("then 'hours'");
    expect(scan).toContain("else 'calendar'");
    expect(scan).toContain("r.meter_index = 1");
    expect(scan).toContain("r.code = 'actual'");
  });

  it("enrolls only reviewed active plans and derives baselines from the meter ledger", () => {
    const enroll = functionSql("service_plan_enroll_equipment");
    expect(enroll).toContain("and is_active");
    expect(enroll).toContain("and review_status = 'reviewed'");
    expect(enroll).toContain("and not is_provisional");
    expect(enroll).toContain("from public.equipment_meter_readings r");
    expect(enroll).toContain("r.meter_index = 1");
    expect(enroll).toContain("r.code = 'actual'");
    expect(enroll).toContain("hour-based service-plan enrollment requires");
    expect(enroll).toContain(
      "v_enrollment.enrolled_on is distinct from p_enrolled_on",
    );
    expect(enroll).toContain(
      "v_enrollment.requested_baseline_hours is distinct from p_baseline_hours",
    );
    expect(enroll).toContain(
      "v_enrollment.enrolled_by is distinct from p_actor_id",
    );
    expect(enroll).toContain(
      "service-plan enrollment retry conflicts with recorded date, baseline, actor, program, or equipment evidence",
    );
    expect(enroll).not.toContain(
      "on conflict (workspace_id, service_agreement_id) do nothing",
    );
    expect(compact).toContain("requested_baseline_hours numeric(12, 1)");
    expect(compact).toContain("baseline_source text not null");
    expect(compact).toContain("baseline_meter_reading_id uuid references");
    expect(enroll).toContain("v_baseline_hours + i.interval_hours");
    expect(enroll).toContain("months => coalesce(i.interval_months, 0)");
  });

  it("creates one open PM job with append-only scheduling evidence", () => {
    const scan = functionSql("service_plan_scan_due_pm_internal");
    expect(compact).toContain("unique (workspace_id, scan_date)");
    expect(compact).toContain("idx_service_plan_pm_due_events_one_open");
    expect(scan).toContain("on conflict do nothing");
    expect(scan).toContain("for update of s skip locked");
    expect(scan).toContain("'service_plan_pm_daily_scan'");
    expect(scan).toContain("'pm_schedule_prompt_created'");
    expect(compact).toContain("service_plan_schedule_prompts_append_only");
  });

  it("drains deterministic bounded batches without per-schedule meter probes", () => {
    const scan = functionSql("service_plan_scan_due_pm_internal");
    const hasDue = functionSql("service_plan_has_due_pm_internal");
    const daily = functionSql("run_service_plan_pm_daily_scan");
    expect(scan).toContain("p_batch_size integer default 100");
    expect(scan).toContain("p_batch_size < 1 or p_batch_size > 500");
    expect(scan).toContain("limit p_batch_size for update of s skip locked");
    expect(scan).toContain(
      "limit greatest( p_batch_size - (select count(*) from calendar_claims), 0 ) for update of s skip locked",
    );
    expect(scan).toContain("select distinct en.equipment_id");
    expect(scan).toContain("from hour_candidate_equipment candidate");
    expect(scan).toContain("from calendar_equipment candidate");
    expect(scan).toContain("if v_claimed_count = 0 then");
    expect(scan).toContain(
      "v_scan_complete := not public.service_plan_has_due_pm_internal",
    );
    expect(scan).toContain("'needs_follow_up', not v_scan_complete");
    expect(scan).toContain("v_existing_due_count + v_due_count");
    expect(compact).toContain(
      "idx_equipment_meter_readings_pm_latest_actual",
    );
    expect(compact).toContain(
      "include (hours) where deleted_at is null and meter_index = 1 and code = 'actual'",
    );
    expect(hasDue).toContain("if v_calendar_due then return true");
    expect(hasDue).toContain("from hour_candidate_equipment candidate");
    expect(hasDue).toContain("select distinct equipment_id");
    expect(daily).toContain("v_workspace_batch_size constant integer := 5");
    expect(daily).toContain("v_schedule_batch_size constant integer := 100");
    expect(daily).toContain("limit v_workspace_batch_size");
  });

  it("serializes an append-only grant/reserve/consume ledger without negative balances", () => {
    const guard = functionSql("guard_service_agreement_entitlement_insert");
    expect(guard).toContain("pg_advisory_xact_lock");
    expect(guard).toContain("insufficient available entitlement");
    expect(guard).toContain("entitlement reserve would become negative");
    expect(guard).toContain("related entitlement reserve not found");
    expect(guard).toContain("release/consume links must match");
    expect(compact).toContain(
      "service_agreement_entitlement_ledger_append_only",
    );
    expect(compact).toContain("service_agreement_entitlement_balances");
  });

  it("returns exact entitlement retries and rejects source-payload conflicts", () => {
    const post = functionSql("service_plan_post_entitlement");
    expect(post).toContain(
      "select * into v_row from public.service_agreement_entitlement_ledger",
    );
    expect(post).toContain("v_row.entry_type is distinct from p_entry_type");
    expect(post).toContain("v_row.quantity is distinct from p_quantity");
    expect(post).toContain("v_row.metadata is distinct from v_metadata");
    expect(post).toContain(
      "idempotency key conflicts with an existing source payload",
    );
    expect(post).toContain(
      "pm-reserve, pm-consume, and pm-cancel-release idempotency namespaces are system-managed",
    );
    expect(post).not.toContain(
      "on conflict (workspace_id, service_agreement_id, unit_code, idempotency_key) do nothing",
    );
  });

  it("atomically cancels generated PM work and releases its reservation", () => {
    const cancel = functionSql("service_plan_cancel_pm_due_event");
    expect(cancel).toContain("'release'");
    expect(cancel).toContain("'pm-cancel-release:' || v_due.id::text");
    expect(cancel).toContain("set status = 'cancelled'");
    expect(cancel).toContain("'pm_service_plan_cycle_cancelled'");
    expect(cancel).toContain("set deleted_at = coalesce(deleted_at, now())");
    expect(compact).toContain(
      "use service_plan_cancel_pm_due_event to cancel, delete, or abandon",
    );
    expect(compact).toContain(
      "grant execute on function public.service_plan_cancel_pm_due_event",
    );
  });

  it("consumes reserved PM service and advances both cadence anchors on close", () => {
    const complete = functionSql("complete_service_plan_pm_cycle");
    expect(complete).toContain("new.current_stage <> 'paid_closed'");
    expect(complete).toContain("'consume'");
    expect(complete).toContain("'pm-consume:' || v_due.id::text");
    expect(complete).toContain("cycle_number = cycle_number + 1");
    expect(complete).toContain("months => coalesce(v_due.interval_months, 0)");
    expect(complete).toContain("v_completed_hours + v_due.interval_hours");
  });

  it("uses tenant RLS, least privilege, and a fail-safe SQL-only cron wrapper", () => {
    expect(compact).toContain("alter table public.%i force row level security");
    expect(compact).toContain(
      "grant select on table public.%i to authenticated",
    );
    expect(compact).toContain(
      "grant select on table public.%i to service_role",
    );
    expect(compact).toContain("from public, anon, authenticated, service_role");
    expect(compact).not.toContain(
      "grant all on table public.%i to service_role",
    );
    expect(compact).toContain(
      "daily service-plan scanner is restricted to service_role or postgres",
    );
    expect(compact).toContain(
      "skipping service-plan-pm-daily cron: pg_cron not available",
    );
    expect(compact).toContain(
      "$job$select public.run_service_plan_pm_daily_scan(current_date);$job$",
    );
    expect(compact).toContain("'*/5 * * * *'");
  });

  it("records backend readiness without falsely shipping the UI workflow", () => {
    expect(compact).toContain("where task_id = 'h9.1'");
    expect(compact).toContain("set ship_state = 'in_progress'");
    expect(compact).toContain("'ship_state', 'in_progress'");
    expect(compact).toContain(
      "'implementation_state', 'backend_schema_ready_ui_follow_on'",
    );
    expect(compact).toContain(
      "'owner_answers', jsonb_build_array('sv1', 'sv2', 'sv3')",
    );
    expect(compact).toContain(
      "'safety_gate', 'blackrock_catalog_inactive_until_qep_review'",
    );
    expect(compact).toContain(
      "'mission_alignment', 'pass for backend foundation:",
    );
    expect(compact).not.toContain("set ship_state = 'shipped'");
  });

  it("documents a non-destructive rollback path for audit-bearing data", () => {
    expect(compact).toContain("rollback notes");
    expect(compact).toContain("unschedule cron job service-plan-pm-daily");
    expect(compact).toContain(
      "entitlement history is financial/audit evidence",
    );
  });
});
