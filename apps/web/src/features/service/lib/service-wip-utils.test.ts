import { describe, expect, test } from "bun:test";
import type { ServiceJobWithRelations } from "./types";
import {
  getServiceWipAgingBucket,
  getServiceWipBillingStatus,
  getServiceWipValue,
  matchesServiceWipFilters,
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
});
