import { describe, expect, test } from "bun:test";
import {
  normalizeComplianceRows,
  normalizeGlRules,
  normalizeIntakeCardRows,
  normalizePdiIntakeRecord,
  normalizeRentalReturnRows,
  normalizeTrafficTicketRows,
  normalizeValidationResult,
} from "./ops-row-normalizers";

describe("ops row normalizers", () => {
  test("normalizes traffic tickets and filters rows without required fields", () => {
    expect(normalizeTrafficTicketRows([
      {
        id: "ticket-1",
        created_at: "2026-05-01T00:00:00Z",
        shipping_date: "2026-05-04",
        stock_number: "STK-1",
        delivery_lat: "35.7",
        locked: true,
        from_location: "",
        to_location: "Customer",
      },
      { id: "missing-stock", created_at: "2026-05-01T00:00:00Z", shipping_date: "2026-05-04" },
    ])).toMatchObject([{
      id: "ticket-1",
      delivery_lat: 35.7,
      locked: true,
      from_location: "Unknown origin",
      to_location: "Customer",
      status: "haul_pending",
    }]);
  });

  test("normalizes intake cards and joined equipment", () => {
    expect(normalizeIntakeCardRows([
      {
        id: "intake-1",
        current_stage: "3",
        stock_number: "STK-2",
        pdi_completed: true,
        crm_equipment: [{ name: "Loader" }],
      },
    ])).toEqual([{
      id: "intake-1",
      current_stage: 3,
      stock_number: "STK-2",
      ship_to_branch: null,
      arrival_photos: null,
      pdi_checklist: null,
      pdi_completed: true,
      photo_ready: null,
      listing_photos: null,
      crm_equipment: [{ name: "Loader" }],
    }]);
  });

  test("normalizes PDI intake records and checklist entries", () => {
    expect(normalizePdiIntakeRecord({
      id: "intake-1",
      current_stage: "3",
      pdi_completed: true,
      pdi_checklist: [
        { id: "oil", status: "pass", checked_at: "2026-05-01T00:00:00Z", note: "ok" },
        { id: "bad", status: "pending", checked_at: "2026-05-01T00:00:00Z" },
      ],
    })).toMatchObject({
      id: "intake-1",
      current_stage: 3,
      pdi_completed: true,
      pdi_checklist: [{ id: "oil", status: "pass", checked_at: "2026-05-01T00:00:00Z", note: "ok" }],
    });
  });

  test("normalizes rental returns and GL rules", () => {
    expect(normalizeRentalReturnRows([
      {
        id: "return-1",
        created_at: "2026-05-01T00:00:00Z",
        charge_amount: "1200.5",
        has_charges: true,
      },
    ])).toMatchObject([{ id: "return-1", charge_amount: 1200.5, has_charges: true, status: "inspection_pending" }]);

    expect(normalizeGlRules([
      { gl_code: "RENT001", gl_name: "Rental Damage", requires_ownership_approval: true, truck_numbers: ["T1", 7] },
      { gl_code: "BAD" },
    ])).toEqual([{
      gl_code: "RENT001",
      gl_name: "Rental Damage",
      gl_number: null,
      description: null,
      equipment_status: null,
      ticket_type: null,
      is_customer_damage: null,
      has_ldw: null,
      is_sales_truck: null,
      is_event_related: null,
      requires_ownership_approval: true,
      truck_numbers: ["T1"],
      usage_examples: null,
    }]);
  });

  test("normalizes SOP compliance rows from view payloads", () => {
    expect(normalizeComplianceRows([
      {
        template_id: "tmpl-1",
        template_title: "Delivery SOP",
        department: "ops",
        version: "2",
        total_executions: "10",
        completed_executions: "8",
        step_id: "step-1",
        step_title: "Photo proof",
        sort_order: "4",
        skips: "3",
        step_compliance_pct: "30",
      },
      {
        template_id: "tmpl-1",
        template_title: "Delivery SOP",
        step_id: "step-2",
        step_title: "Signature",
        sort_order: "5",
        skips: "1",
        step_compliance_pct: "10",
      },
    ])).toMatchObject([{
      template_id: "tmpl-1",
      version: 2,
      total_executions: 10,
      step_analysis: [
        { step_id: "step-1", sort_order: 4, skips: 3, skip_rate_pct: 30 },
        { step_id: "step-2", sort_order: 5, skips: 1, skip_rate_pct: 10 },
      ],
    }]);
  });

  test("normalizes payment validation RPC output", () => {
    expect(normalizeValidationResult({ passed: true, rule_applied: "", reason: "", daily_check_total: "4000" })).toEqual({
      passed: true,
      rule_applied: null,
      reason: null,
      daily_check_total: 4000,
    });
    expect(normalizeValidationResult(null)).toEqual({
      passed: false,
      rule_applied: null,
      reason: "Validation failed.",
    });
  });
});
