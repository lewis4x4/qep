import { describe, expect, test } from "bun:test";
import {
  evaluateH3EstimateGate,
  evaluateH5CloseGate,
  isH2GrappleTruck,
  shouldBlockStageTransition,
  validateH2IntakeDraft,
} from "./service-wo-gates";
import type { ServiceJobWithRelations } from "./types";

const baseJob = {
  id: "job-1",
  workspace_id: "default",
  customer_id: "cust-1",
  contact_id: null,
  machine_id: "machine-1",
  source_type: "call",
  request_type: "repair",
  priority: "normal",
  current_stage: "scheduled",
  status_flags: [],
  branch_id: null,
  advisor_id: null,
  service_manager_id: null,
  technician_id: null,
  requested_by_name: null,
  customer_problem_summary: "Hydraulic leak under load",
  ai_diagnosis_summary: null,
  selected_job_code_id: null,
  haul_required: false,
  shop_or_field: "shop",
  scheduled_start_at: null,
  scheduled_end_at: null,
  quote_total: 1000,
  invoice_total: null,
  portal_request_id: null,
  fulfillment_run_id: null,
  tracking_token: "track-token",
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
  closed_at: null,
  deleted_at: null,
} satisfies Partial<ServiceJobWithRelations>;

describe("service work-order gates", () => {
  test("H2 intake validates seven-type vocabulary and grapple miles", () => {
    const machine = {
      id: "machine-1",
      name: "QEP grapple truck",
      make: "Freightliner",
      model: "Grapple Truck",
      serial_number: "GT-100",
      year: 2024,
      category: "truck",
      metadata: { equipment_class: "grapple_truck" },
    };

    expect(isH2GrappleTruck(machine)).toBe(true);
    const missingMiles = validateH2IntakeDraft({
      machine,
      machineId: "machine-1",
      sourceType: "field_request",
      requestType: "field_service",
      priority: "emergency",
      hourMeter: "20.1",
      odometerMiles: "",
      promisedAt: "2026-06-01T14:00",
      complaint: "Customer says boom will not lift",
      cause: "Hydraulic pressure issue suspected",
      correction: "Diagnose and repair hydraulic lift circuit",
      shopOrField: "field",
      fieldSiteLocation: "Farm lane 2",
      fieldSiteContactName: "Jamie",
      fieldSiteContactPhone: "555-0100",
      fieldSiteConditionsAccessNotes: "Gate code required",
    });

    expect(missingMiles.ok).toBe(false);
    expect(missingMiles.missing).toContain("odometer_miles");

    const complete = validateH2IntakeDraft({ ...missingMilesFixture(machine), odometerMiles: "12345" });
    expect(complete.ok).toBe(true);
  });

  test("H3 blocks work start without documented approval and catches >10 percent scope", () => {
    const pending = { ...baseJob, estimate_authorization_required: true, estimate_authorization_status: "pending" } as ServiceJobWithRelations;
    expect(evaluateH3EstimateGate(pending).code).toBe("estimate_approval_required");
    expect(shouldBlockStageTransition(pending, "in_progress")?.code).toBe("estimate_approval_required");

    const overScope = {
      ...baseJob,
      quote_total: 1110,
      estimate_authorization_required: true,
      estimate_authorization_status: "approved",
      approved_estimate_amount: 1000,
      estimate_reauth_threshold_pct: 10,
      approved_estimate_quote_id: "quote-1",
      approved_estimate_approval_id: "approval-1",
    } as ServiceJobWithRelations;
    expect(evaluateH3EstimateGate(overScope).code).toBe("estimate_reauthorization_required");
  });

  test("H5 close gate explains missing segment docs, story, photos, and advisor review", () => {
    const job = {
      ...baseJob,
      current_stage: "ready_for_pickup",
      h5_documentation_required: true,
      documentation_review_status: "pending",
      segments: [{
        id: "segment-1",
        segment_number: 1,
        description: "Repair leak",
        status: "active",
        technician_id: "tech-1",
        estimated_hours: 2,
        quoted_labor_hours: 2,
        hours_actual: 2.4,
        h5_documentation_required: true,
        diagnostic_signoff_status: "submitted",
        diagnostic_submitted_at: null,
        diagnostic_approved_at: null,
        repair_signoff_status: "not_started",
        repair_signed_off_at: null,
        labor_story: "short",
        labor_story_complaint_verification: "checked",
        labor_story_diagnostic_steps: "tested pump",
        labor_story_root_cause: "bad hose",
        labor_story_parts_used: "hose",
        labor_story_work_performed: "replaced",
        overrun_status: "overrun_unacknowledged",
        overrun_flagged_at: null,
        overrun_acknowledged_at: null,
        lockout_tagout_required: false,
        lockout_tagout_completed: false,
        warranty_parts_turn_in_required: true,
        warranty_parts_turn_in_completed: false,
        warranty_parts_label: null,
        photos: [{ id: "p1", phase: "before", category: "problem_area", storage_bucket: "portal-service-photos", storage_path: "x", caption: null, uploaded_by: null, uploaded_at: "2026-05-01T00:00:00.000Z" }],
      }],
    } as ServiceJobWithRelations;

    const gate = evaluateH5CloseGate(job, true);
    expect(gate.ok).toBe(false);
    expect(gate.missing.some((item) => item.includes("Service Advisor"))).toBe(true);
    expect(gate.missing.some((item) => item.includes("during photo"))).toBe(true);
    expect(shouldBlockStageTransition(job, "invoice_ready")?.code).toBe("h5_documentation_incomplete");
  });
});

function missingMilesFixture(machine: Parameters<typeof validateH2IntakeDraft>[0]["machine"]): Parameters<typeof validateH2IntakeDraft>[0] {
  return {
    machine,
    machineId: "machine-1",
    sourceType: "field_request",
    requestType: "field_service",
    priority: "emergency",
    hourMeter: "20.1",
    odometerMiles: "",
    promisedAt: "2026-06-01T14:00",
    complaint: "Customer says boom will not lift",
    cause: "Hydraulic pressure issue suspected",
    correction: "Diagnose and repair hydraulic lift circuit",
    shopOrField: "field",
    fieldSiteLocation: "Farm lane 2",
    fieldSiteContactName: "Jamie",
    fieldSiteContactPhone: "555-0100",
    fieldSiteConditionsAccessNotes: "Gate code required",
  };
}
