import { describe, expect, test } from "bun:test";
import {
  normalizeBillingPostResult,
  normalizeCalendarSlotsResult,
  normalizeLinkFulfillmentRunPayload,
  normalizePartsPopulateResult,
  normalizePortalOrderSearchRows,
  normalizeReassignFromBranchPoolResult,
  normalizeResyncPartsResult,
  normalizeSearchPortalOrdersResponse,
  normalizeServiceJobResponse,
  normalizeServiceListResponse,
  normalizeServiceCloseoutResult,
  normalizeServiceTransitionResponse,
  normalizeTechnicianSuggestionsResult,
} from "./service-api-normalizers";

const job = {
  id: "job-1",
  workspace_id: "default",
  current_stage: "in_progress",
  tracking_token: "token",
  created_at: "2026-05-03T10:00:00.000Z",
  updated_at: "2026-05-03T11:00:00.000Z",
};

describe("service API normalizers", () => {
  test("normalizes service job and list responses", () => {
    expect(normalizeServiceJobResponse({ job })).toBe(job);
    expect(normalizeServiceTransitionResponse({
      job,
      closeout: {
        invoice_id: "inv-1",
        invoice_finalized: true,
        warranty_claim_id: null,
        warranty_queued: false,
        ar_synced: true,
        warnings: ["partial"],
      },
    })).toEqual({
      job,
      closeout: {
        invoice_id: "inv-1",
        invoice_finalized: true,
        warranty_claim_id: null,
        warranty_queued: false,
        ar_synced: true,
        warnings: ["partial"],
      },
    });
    expect(normalizeServiceListResponse({
      jobs: [job, { id: "bad" }],
      total: "4",
      page: "2",
      per_page: "20",
    })).toEqual({
      jobs: [job],
      total: 4,
      page: 2,
      per_page: 20,
    });
  });

  test("throws on malformed required job response", () => {
    expect(() => normalizeServiceJobResponse({ job: { id: "bad" } })).toThrow("malformed job");
  });

  test("normalizes service mutation utility results", () => {
    expect(normalizePartsPopulateResult({ populated: "3" })).toEqual({ populated: 3 });
    expect(normalizeBillingPostResult({
      ok: true,
      customer_invoice_id: "inv-1",
      lines_posted: "2",
      invoice_total: "123.45",
      error: "warning",
    })).toEqual({
      ok: true,
      customer_invoice_id: "inv-1",
      lines_posted: 2,
      invoice_total: 123.45,
      error: "warning",
    });
    expect(normalizeResyncPartsResult({ inserted: "2", cancelled: "1", mode: "full" })).toEqual({
      inserted: 2,
      cancelled: 1,
      mode: "full",
    });
    expect(normalizeReassignFromBranchPoolResult({ reassigned: "5", replacement: "user-2" })).toEqual({
      reassigned: 5,
      replacement: "user-2",
    });
  });

  test("normalizes portal order search responses", () => {
    const rows = normalizePortalOrderSearchRows([
      {
        id: "order-1",
        status: "submitted",
        fulfillment_run_id: "run-1",
        created_at: "2026-05-03T10:00:00.000Z",
        portal_customers: [{ first_name: "Avery", last_name: "Lane", email: "avery@example.com" }],
      },
      { id: "bad", status: "", created_at: "2026-05-03T10:00:00.000Z" },
    ]);

    expect(rows).toEqual([
      {
        id: "order-1",
        status: "submitted",
        fulfillment_run_id: "run-1",
        created_at: "2026-05-03T10:00:00.000Z",
        portal_customers: { first_name: "Avery", last_name: "Lane", email: "avery@example.com" },
      },
    ]);
    expect(normalizeSearchPortalOrdersResponse({ orders: rows })).toEqual(rows);
  });

  test("normalizes fulfillment link and calendar slot responses", () => {
    expect(normalizeLinkFulfillmentRunPayload({
      job,
      error: "shared",
      code: "shared_fulfillment_run",
      other_job_ids: ["job-2", 42],
    })).toEqual({
      job,
      error: "shared",
      code: "shared_fulfillment_run",
      other_job_ids: ["job-2"],
    });

    expect(normalizeCalendarSlotsResult({
      slots: ["2026-05-04T10:00:00.000Z", 42],
      slot_minutes: "60",
      branch_id: "OCALA",
    })).toEqual({
      slots: ["2026-05-04T10:00:00.000Z"],
      slot_minutes: 60,
      branch_id: "OCALA",
    });
  });

  test("normalizes H6 technician assignment suggestions with reasons and capacity", () => {
    expect(normalizeTechnicianSuggestionsResult({
      source: "service_schedule_assignment_candidates",
      suggestions: [
        {
          technician_profile_id: "profile-1",
          user_id: "tech-1",
          name: "Jordan Lane",
          score: "152",
          branch_id: "OCALA",
          branch_match: true,
          shop_field_eligible: true,
          brand_match: true,
          legacy_cert_match: false,
          oem_cert_match: true,
          in_house_completed_count: "3",
          active_workload: "2",
          availability_date: "2026-07-03",
          available_hours: "9",
          scheduled_hours: "4",
          capacity_remaining_hours: "5",
          reasons: [
            { key: "branch_match", label: "Branch match", detail: "OCALA" },
            { key: "bad", detail: "missing label" },
          ],
        },
        { user_id: "", name: "Invalid" },
      ],
    })).toEqual({
      source: "service_schedule_assignment_candidates",
      suggestions: [{
        technician_profile_id: "profile-1",
        user_id: "tech-1",
        name: "Jordan Lane",
        score: 152,
        branch_id: "OCALA",
        branch_match: true,
        shop_field_eligible: true,
        brand_match: true,
        legacy_cert_match: false,
        oem_cert_match: true,
        in_house_completed_count: 3,
        active_workload: 2,
        availability_date: "2026-07-03",
        available_hours: 9,
        scheduled_hours: 4,
        capacity_remaining_hours: 5,
        reasons: [{ key: "branch_match", label: "Branch match", detail: "OCALA" }],
      }],
    });
  });

  test("returns safe defaults for malformed optional responses", () => {
    expect(normalizeServiceListResponse(null)).toEqual({ jobs: [], total: 0, page: 1, per_page: 0 });
    expect(normalizeBillingPostResult(null)).toEqual({});
    expect(normalizeSearchPortalOrdersResponse(null)).toEqual([]);
    expect(normalizeCalendarSlotsResult(null)).toEqual({ slots: [], slot_minutes: 0, branch_id: "" });
    expect(normalizeTechnicianSuggestionsResult(null)).toEqual({ source: "unknown", suggestions: [] });
  });
});
