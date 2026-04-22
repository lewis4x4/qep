import { describe, expect, test } from "bun:test";
import type { ServiceJobWithRelations } from "./types";
import {
  filterTechnicianJobs,
  getPrimaryTechnicianJob,
  getTechnicianJobSummary,
  getTechnicianNextMove,
  getTechnicianStageActions,
  summarizeTechnicianJobs,
} from "./mobile-tech-utils";

function makeJob(overrides: Partial<ServiceJobWithRelations>): ServiceJobWithRelations {
  return {
    id: overrides.id ?? "job-1",
    workspace_id: "default",
    customer_id: null,
    contact_id: null,
    machine_id: null,
    source_type: "field_tech",
    request_type: "repair",
    priority: "normal",
    current_stage: "scheduled",
    status_flags: [],
    branch_id: "north",
    advisor_id: null,
    service_manager_id: null,
    technician_id: "tech-1",
    requested_by_name: "Jordan Lane",
    customer_problem_summary: "Hydraulic drift under load",
    ai_diagnosis_summary: null,
    selected_job_code_id: null,
    haul_required: false,
    shop_or_field: "field",
    scheduled_start_at: "2026-04-22T14:00:00.000Z",
    scheduled_end_at: "2026-04-22T16:00:00.000Z",
    quote_total: null,
    invoice_total: null,
    portal_request_id: null,
    fulfillment_run_id: null,
    tracking_token: "track-1",
    created_at: "2026-04-22T09:00:00.000Z",
    updated_at: "2026-04-22T09:00:00.000Z",
    closed_at: null,
    deleted_at: null,
    customer: { id: "cust-1", name: "Evergreen Farms" },
    machine: { id: "machine-1", make: "Kubota", model: "KX080", serial_number: "KBTA-17", year: 2024 },
    ...overrides,
  };
}

describe("mobile-tech-utils", () => {
  const now = new Date("2026-04-22T15:00:00.000Z");

  test("summarizes technician queue counts", () => {
    const jobs = [
      makeJob({ id: "scheduled", current_stage: "scheduled" }),
      makeJob({ id: "active", current_stage: "in_progress" }),
      makeJob({ id: "blocked", current_stage: "blocked_waiting" }),
      makeJob({ id: "down", current_stage: "parts_pending", status_flags: ["machine_down"] }),
    ];

    expect(summarizeTechnicianJobs(jobs, now)).toEqual({
      activeCount: 3,
      todayCount: 4,
      blockedCount: 1,
      machineDownCount: 1,
    });
  });

  test("filters jobs for focus lane", () => {
    const jobs = [
      makeJob({ id: "today", current_stage: "scheduled" }),
      makeJob({
        id: "future",
        scheduled_start_at: "2026-04-24T14:00:00.000Z",
        scheduled_end_at: "2026-04-24T16:00:00.000Z",
        current_stage: "approved",
      }),
      makeJob({ id: "down", current_stage: "parts_pending", status_flags: ["machine_down"] }),
    ];

    const ids = filterTechnicianJobs(jobs, "focus", now).map((job) => job.id);
    expect(ids).toEqual(["today", "down"]);
  });

  test("picks active machine-down work first", () => {
    const jobs = [
      makeJob({ id: "later", current_stage: "scheduled", priority: "urgent" }),
      makeJob({ id: "active", current_stage: "in_progress" }),
      makeJob({ id: "critical", current_stage: "blocked_waiting", status_flags: ["machine_down"], priority: "critical" }),
    ];

    expect(getPrimaryTechnicianJob(jobs, now)?.id).toBe("critical");
  });

  test("returns technician stage actions and next move copy", () => {
    expect(getTechnicianStageActions("scheduled")).toEqual([
      { toStage: "in_progress", label: "Start work", tone: "primary" },
    ]);
    expect(getTechnicianNextMove(makeJob({ current_stage: "parts_pending" }))).toBe("Waiting on parts");
  });

  test("builds compact job summary copy", () => {
    const summary = getTechnicianJobSummary(makeJob({ current_stage: "scheduled" }));
    expect(summary).toContain("Scheduled");
    expect(summary).toContain("Apr");
  });
});
