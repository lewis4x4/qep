import { describe, expect, test } from "bun:test";
import type { ServiceJobWithRelations } from "./types";
import {
  getServiceWipAgingBucket,
  getServiceWipBillingStatus,
  getServiceWipValue,
  matchesServiceWipFilters,
  normalizeServiceCronRunRows,
  normalizeServiceDashboardOverdueRows,
  normalizeServiceDashboardRollupRows,
  normalizeServiceWipJobRows,
  normalizeServiceWipSummaryRows,
} from "./service-wip-utils";

function makeJob(overrides: Partial<ServiceJobWithRelations>): ServiceJobWithRelations {
  return {
    id: "job-1",
    workspace_id: "default",
    customer_id: "cust-1",
    contact_id: null,
    machine_id: "eq-1",
    source_type: "call",
    request_type: "repair",
    priority: "normal",
    current_stage: "in_progress",
    status_flags: [],
    branch_id: "OCALA",
    advisor_id: null,
    service_manager_id: null,
    technician_id: null,
    requested_by_name: "Jordan Lane",
    customer_problem_summary: "Hydraulic drift",
    ai_diagnosis_summary: null,
    selected_job_code_id: null,
    haul_required: false,
    shop_or_field: "shop",
    scheduled_start_at: null,
    scheduled_end_at: null,
    quote_total: 1200,
    invoice_total: null,
    portal_request_id: null,
    fulfillment_run_id: null,
    tracking_token: "token",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    closed_at: null,
    deleted_at: null,
    customer: { id: "cust-1", name: "Evergreen Farms" },
    machine: { id: "eq-1", make: "Kubota", model: "KX080", serial_number: "SER-1", year: 2024 },
    ...overrides,
  };
}

describe("service-wip-utils", () => {
  test("derives billing status from flags", () => {
    expect(getServiceWipBillingStatus(makeJob({ status_flags: ["internal"] }))).toBe("internal");
    expect(getServiceWipBillingStatus(makeJob({ status_flags: ["warranty_recall"] }))).toBe("warranty");
    expect(getServiceWipBillingStatus(makeJob({ status_flags: [] }))).toBe("customer");
  });

  test("computes aging buckets", () => {
    const now = new Date("2026-04-22T00:00:00.000Z");
    expect(getServiceWipAgingBucket("2026-04-10T00:00:00.000Z", now)).toBe("current");
    expect(getServiceWipAgingBucket("2026-03-01T00:00:00.000Z", now)).toBe("31_60");
    expect(getServiceWipAgingBucket("2026-01-15T00:00:00.000Z", now)).toBe("91_120");
  });

  test("prefers invoice total over quote total", () => {
    expect(getServiceWipValue(makeJob({ quote_total: 1200, invoice_total: 900 }))).toBe(900);
    expect(getServiceWipValue(makeJob({ quote_total: 1200, invoice_total: null }))).toBe(1200);
  });

  test("matches search and bucket filters", () => {
    const job = makeJob({});
    const now = new Date("2026-04-22T00:00:00.000Z");
    expect(matchesServiceWipFilters(job, "evergreen", "customer", "31_60", now)).toBe(true);
    expect(matchesServiceWipFilters(job, "wheel loader", "customer", "31_60", now)).toBe(false);
  });

  test("normalizes scheduler cron run rows", () => {
    expect(normalizeServiceCronRunRows([
      {
        id: "run-1",
        job_name: "service-aging",
        started_at: "2026-05-03T10:00:00.000Z",
        finished_at: null,
        ok: false,
        error: "timeout",
        metadata: { path: "github-actions" },
      },
      { id: "bad", job_name: "", started_at: "2026-05-03T10:00:00.000Z", ok: true },
    ])).toEqual([
      {
        id: "run-1",
        job_name: "service-aging",
        started_at: "2026-05-03T10:00:00.000Z",
        finished_at: null,
        ok: false,
        error: "timeout",
        metadata: { path: "github-actions" },
      },
    ]);
  });

  test("normalizes WIP summary rows and filters invalid buckets", () => {
    expect(normalizeServiceWipSummaryRows([
      {
        workspace_id: "default",
        branch_id: "OCALA",
        billing_status: "customer",
        aging_bucket: "61_90",
        job_count: "4",
        total_value: "9000.50",
        avg_stage_hours: "18",
      },
      {
        workspace_id: "default",
        billing_status: "customer",
        aging_bucket: "future",
        job_count: 1,
        total_value: 1,
        avg_stage_hours: 1,
      },
    ])).toEqual([
      {
        workspace_id: "default",
        branch_id: "OCALA",
        billing_status: "customer",
        aging_bucket: "61_90",
        job_count: 4,
        total_value: 9000.5,
        avg_stage_hours: 18,
      },
    ]);
  });

  test("normalizes WIP service jobs with joined customer and machine rows", () => {
    const rows = normalizeServiceWipJobRows([
      {
        ...makeJob({}),
        quote_total: "1200",
        invoice_total: "950",
        status_flags: ["customer_pay", "not_a_flag", "internal"],
        customer: [{ id: "cust-1", name: "Evergreen Farms" }],
        machine: { id: "eq-1", make: "Kubota", model: "KX080", serial_number: "SER-1", year: "2024" },
      },
      { ...makeJob({ id: "bad" }), current_stage: "unknown_stage" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].quote_total).toBe(1200);
    expect(rows[0].invoice_total).toBe(950);
    expect(rows[0].status_flags).toEqual(["customer_pay", "internal"]);
    expect(rows[0].customer?.name).toBe("Evergreen Farms");
    expect(rows[0].machine?.year).toBe(2024);
  });

  test("normalizes dashboard rollups and overdue rows", () => {
    expect(normalizeServiceDashboardRollupRows([
      {
        workspace_id: "default",
        branch_id: "OCALA",
        overdue_count: "2",
        pending_count: null,
        active_count: 4,
        closed_count: "5",
        total_count: "11",
      },
      { workspace_id: "", overdue_count: 1 },
    ])).toEqual([
      {
        workspace_id: "default",
        branch_id: "OCALA",
        overdue_count: 2,
        pending_count: 0,
        active_count: 4,
        closed_count: 5,
        total_count: 11,
      },
    ]);

    expect(normalizeServiceDashboardOverdueRows([
      {
        id: "job-1",
        customer_id: "cust-1",
        machine_id: "eq-1",
        current_stage: "in_progress",
        scheduled_end_at: "2026-05-01T00:00:00.000Z",
        customer_problem_summary: "Hydraulic leak",
        branch_id: "OCALA",
        technician_id: "tech-1",
        invoice_total: "450.25",
      },
      { id: "", current_stage: "in_progress" },
    ])).toEqual([
      {
        id: "job-1",
        customer_id: "cust-1",
        machine_id: "eq-1",
        current_stage: "in_progress",
        scheduled_end_at: "2026-05-01T00:00:00.000Z",
        customer_problem_summary: "Hydraulic leak",
        branch_id: "OCALA",
        technician_id: "tech-1",
        invoice_total: 450.25,
        customer_name: null,
        open_deal_value: null,
        trade_up_score: null,
      },
    ]);
  });

  test("normalizers return safe empty arrays for malformed inputs", () => {
    expect(normalizeServiceCronRunRows(null)).toEqual([]);
    expect(normalizeServiceWipSummaryRows({})).toEqual([]);
    expect(normalizeServiceWipJobRows("bad")).toEqual([]);
    expect(normalizeServiceDashboardRollupRows(undefined)).toEqual([]);
    expect(normalizeServiceDashboardOverdueRows(42)).toEqual([]);
  });
});
