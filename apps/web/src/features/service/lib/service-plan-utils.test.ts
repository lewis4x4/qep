import { describe, expect, test } from "bun:test";
import {
  canMutateServicePlans,
  getAgreementEnrollmentReadiness,
  getProgramActivationReadiness,
  isOpenSchedulePrompt,
  normalizeServicePlanEntitlementBalances,
  normalizeServicePlanEnrollment,
  normalizeServicePlanPrograms,
  normalizeServicePlanSchedulePrompts,
  parseBaselineHoursInput,
  provisionalProgramDisclosure,
  summarizeProgramInterval,
} from "./service-plan-utils";

describe("service-plan-utils", () => {
  test("gates mutations to elevated roles", () => {
    expect(canMutateServicePlans("admin")).toBe(true);
    expect(canMutateServicePlans("manager")).toBe(true);
    expect(canMutateServicePlans("owner")).toBe(true);
    expect(canMutateServicePlans("rep")).toBe(false);
    expect(canMutateServicePlans(null)).toBe(false);
  });

  test("normalizes programs with nested intervals", () => {
    expect(normalizeServicePlanPrograms([
      {
        id: "program-1",
        program_code: "BR-DRAFT-PM-250",
        name: "BlackRock Draft 250-Hour / 6-Month PM",
        sponsor: "BlackRock provisional draft",
        description: "Inactive first-pass cadence",
        catalog_owner: "BlackRock",
        is_provisional: true,
        review_status: "draft",
        is_active: false,
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        activated_by: null,
        activated_at: null,
        deactivated_at: null,
        service_agreement_program_intervals: [{
          id: "interval-1",
          program_id: "program-1",
          interval_code: "PM-250-6M",
          name: "250h / 6mo",
          interval_hours: "250",
          interval_months: "6",
          interval_days: null,
          entitlement_unit: "pm_service",
          entitlement_quantity: "1",
          is_active: true,
        }],
      },
      {
        id: "bad",
        program_code: "X",
        name: "Bad",
        review_status: "unknown",
      },
    ])).toEqual([{
      id: "program-1",
      program_code: "BR-DRAFT-PM-250",
      name: "BlackRock Draft 250-Hour / 6-Month PM",
      sponsor: "BlackRock provisional draft",
      description: "Inactive first-pass cadence",
      catalog_owner: "BlackRock",
      is_provisional: true,
      review_status: "draft",
      is_active: false,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      activated_by: null,
      activated_at: null,
      deactivated_at: null,
      intervals: [{
        id: "interval-1",
        program_id: "program-1",
        interval_code: "PM-250-6M",
        name: "250h / 6mo",
        interval_hours: 250,
        interval_months: 6,
        interval_days: null,
        entitlement_unit: "pm_service",
        entitlement_quantity: 1,
        is_active: true,
      }],
    }]);
  });

  test("reports activation readiness with fail-closed reasons", () => {
    const draft = {
      review_status: "draft" as const,
      is_provisional: true,
      is_active: false,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      intervals: [{
        id: "i1",
        program_id: "p1",
        interval_code: "PM",
        name: "PM",
        interval_hours: 250,
        interval_months: 6,
        interval_days: null,
        entitlement_unit: "pm_service",
        entitlement_quantity: 1,
        is_active: true,
      }],
    };
    expect(getProgramActivationReadiness(draft).ready).toBe(false);
    expect(getProgramActivationReadiness(draft).reasons).toContain("Record a QEP review with notes first.");
    expect(getProgramActivationReadiness(draft).reasons).toContain("Provisional programs cannot be activated.");

    expect(getProgramActivationReadiness({
      review_status: "reviewed",
      is_provisional: false,
      is_active: false,
      reviewed_by: "manager-1",
      reviewed_at: "2026-08-12T12:00:00.000Z",
      review_notes: "OEM/model, kit, labor, and commercial terms confirmed.",
      intervals: draft.intervals,
    }).ready).toBe(true);

    expect(getProgramActivationReadiness({
      review_status: "reviewed",
      is_provisional: false,
      is_active: false,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      intervals: draft.intervals,
    }).ready).toBe(false);
  });

  test("reports enrollment readiness for agreement binding", () => {
    const blocked = getAgreementEnrollmentReadiness({
      status: "draft",
      program_id: null,
      equipment_id: null,
      starts_on: "2026-08-01",
      expires_on: "2027-08-01",
      enrolled_on: "2026-08-12",
      programIsActive: false,
      programReviewed: false,
      programProvisional: true,
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.reasons).toContain("Agreement must be active.");
    expect(blocked.reasons).toContain("Bind a catalog program before enrollment.");

    expect(getAgreementEnrollmentReadiness({
      status: "active",
      program_id: "program-1",
      equipment_id: "eq-1",
      starts_on: "2026-08-01",
      expires_on: "2027-08-01",
      enrolled_on: "2026-08-12",
      programIsActive: true,
      programReviewed: true,
      programProvisional: false,
    }).ready).toBe(true);

    const unresolvedProgram = getAgreementEnrollmentReadiness({
      status: "active",
      program_id: "program-1",
      equipment_id: "eq-1",
      starts_on: "2026-08-01",
      expires_on: "2027-08-01",
      enrolled_on: "2026-08-12",
    });
    expect(unresolvedProgram.ready).toBe(false);
    expect(unresolvedProgram.reasons).toContain("Bound program must be active.");
    expect(unresolvedProgram.reasons).toContain("Bound program must be reviewed.");
    expect(unresolvedProgram.reasons).toContain("Bound program must not be provisional.");
  });

  test("normalizes enrollments, balances, and open prompts", () => {
    expect(normalizeServicePlanEnrollment({
      id: "enroll-1",
      service_agreement_id: "agreement-1",
      program_id: "program-1",
      equipment_id: "eq-1",
      status: "active",
      enrolled_on: "2026-08-01",
      requested_baseline_hours: null,
      baseline_hours: 120,
      baseline_source: "primary_actual_meter",
      baseline_meter_reading_id: "meter-1",
      enrolled_by: "user-1",
      ended_at: null,
      end_reason: null,
      service_plan_enrollment_schedules: [{
        id: "sched-1",
        enrollment_id: "enroll-1",
        program_interval_id: "interval-1",
        cycle_number: 1,
        baseline_on: "2026-08-01",
        baseline_hours: 120,
        next_due_on: "2027-02-01",
        next_due_hours: 370,
        last_completed_job_id: null,
        last_completed_at: null,
      }],
    })).toMatchObject({
      id: "enroll-1",
      baseline_source: "primary_actual_meter",
      schedules: [{ id: "sched-1", next_due_hours: 370 }],
    });

    expect(normalizeServicePlanEntitlementBalances([
      {
        service_agreement_id: "agreement-1",
        unit_code: "pm_service",
        available_quantity: "3",
        reserved_quantity: "1",
        consumed_quantity: "0",
        granted_quantity: "4",
      },
    ])).toEqual([{
      service_agreement_id: "agreement-1",
      unit_code: "pm_service",
      available_quantity: 3,
      reserved_quantity: 1,
      consumed_quantity: 0,
      granted_quantity: 4,
    }]);

    const prompts = normalizeServicePlanSchedulePrompts([
      {
        id: "prompt-1",
        due_event_id: "due-1",
        service_job_id: "job-1",
        prompt_type: "advisor_schedule_pm",
        prompt_key: "due-1",
        evidence: { entitlement_reserved: true },
        created_at: "2026-08-12T12:00:00.000Z",
        service_plan_pm_due_events: {
          status: "job_created",
          due_basis: "hours",
          due_on: null,
          due_hours: 370,
          service_agreement_id: "agreement-1",
          equipment_id: "eq-1",
        },
        service_jobs: { wo_number: "SJ-100", scheduled_start_at: null },
      },
      {
        id: "prompt-2",
        due_event_id: "due-2",
        service_job_id: "job-2",
        prompt_type: "advisor_schedule_pm",
        prompt_key: "due-2",
        evidence: {},
        created_at: "2026-08-11T12:00:00.000Z",
        service_plan_pm_due_events: { status: "completed" },
        service_jobs: { tracking_token: "WO-9", scheduled_start_at: null },
      },
      {
        id: "prompt-3",
        due_event_id: "due-3",
        service_job_id: "job-3",
        prompt_type: "advisor_schedule_pm",
        prompt_key: "due-3",
        evidence: {},
        created_at: "2026-08-10T12:00:00.000Z",
        service_plan_pm_due_events: { status: "job_created" },
        service_jobs: { wo_number: "SJ-101", scheduled_start_at: "2026-08-13T13:00:00.000Z" },
      },
    ]);
    expect(prompts).toHaveLength(3);
    expect(isOpenSchedulePrompt(prompts[0]!)).toBe(true);
    expect(isOpenSchedulePrompt(prompts[1]!)).toBe(false);
    expect(isOpenSchedulePrompt(prompts[2]!)).toBe(false);
    expect(prompts[0]?.job_number).toBe("SJ-100");
    expect(prompts[1]?.job_number).toBe("WO-9");
  });

  test("formats provisional disclosure and interval summaries", () => {
    expect(provisionalProgramDisclosure({
      is_provisional: true,
      catalog_owner: "BlackRock",
      is_active: false,
    })).toContain("not customer-live");
    expect(summarizeProgramInterval({
      id: "i1",
      program_id: "p1",
      interval_code: "PM",
      name: "PM",
      interval_hours: 250,
      interval_months: 6,
      interval_days: null,
      entitlement_unit: "pm_service",
      entitlement_quantity: 1,
      is_active: true,
    })).toBe("250h / 6mo");
  });

  test("parses baseline hours input", () => {
    expect(parseBaselineHoursInput("")).toBeNull();
    expect(parseBaselineHoursInput("120.44")).toBe(120.4);
    expect(() => parseBaselineHoursInput("-1")).toThrow("non-negative");
  });
});
