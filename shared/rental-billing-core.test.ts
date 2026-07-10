import { describe, expect, it } from "bun:test";
import {
  aggregateReturnCharges,
  planNextInvoice,
  type BillingContractSnapshot,
  type RentalReturnAssessmentSnapshot,
} from "./rental-billing-core";

const BASE_CONTRACT: BillingContractSnapshot = {
  id: "c-1",
  contract_number: "RC-2026-00099",
  contract_type: "rental",
  lifecycle_state: "on_rent",
  on_rent_at: "2026-06-01T08:00:00Z",
  off_rent_at: null,
  returned_at: null,
  agreed_daily_rate: 100,   // → 10000c
  agreed_weekly_rate: 300,  // → 30000c
  agreed_monthly_rate: 900, // → 90000c
  delivery_fee_cents: 25000,
  pickup_fee_cents: 15000,
  damage_waiver_accepted: true,
  damage_waiver_rate_pct: 0.1,
};

function returnAssessment(
  overrides: Partial<RentalReturnAssessmentSnapshot> = {},
): RentalReturnAssessmentSnapshot {
  return {
    id: "return-1",
    workspace_id: "default",
    rental_contract_id: BASE_CONTRACT.id,
    equipment_id: "equipment-1",
    created_at: "2026-06-20T10:00:00Z",
    updated_at: "2026-06-20T10:00:00Z",
    fuel_charge_cents: null,
    cleaning_charge_cents: null,
    damage_charge_cents: null,
    environmental_fee_cents: null,
    damage_disposition: "pending",
    ...overrides,
  };
}

describe("rental return charge aggregation", () => {
  it("sums every distinct equipment return and produces cent-level source evidence", () => {
    const aggregation = aggregateReturnCharges([
      returnAssessment({
        id: "return-equipment-1",
        equipment_id: "equipment-1",
        fuel_charge_cents: 8_000,
        cleaning_charge_cents: 5_000,
        damage_charge_cents: 40_000,
        environmental_fee_cents: 2_500,
        damage_disposition: "customer_billable",
      }),
      returnAssessment({
        id: "return-equipment-2",
        equipment_id: "equipment-2",
        fuel_charge_cents: 3_000,
        cleaning_charge_cents: 2_000,
        damage_charge_cents: 10_000,
        environmental_fee_cents: 500,
        damage_disposition: "customer_billable",
      }),
    ], { contract_id: BASE_CONTRACT.id, workspace_id: "default" });

    expect(aggregation.charges).toEqual({
      fuel_charge_cents: 11_000,
      cleaning_charge_cents: 7_000,
      damage_charge_cents: 50_000,
      environmental_fee_cents: 3_000,
      damage_disposition: "customer_billable",
    });
    expect(aggregation.billed_return_ids).toEqual([
      "return-equipment-1",
      "return-equipment-2",
    ]);
    expect(aggregation.sources).toEqual([
      {
        return_id: "return-equipment-1",
        equipment_id: "equipment-1",
        legacy_null_equipment_fallback: false,
        damage_disposition: "customer_billable",
        fuel_charge_cents: 8_000,
        cleaning_charge_cents: 5_000,
        damage_charge_cents: 40_000,
        environmental_fee_cents: 2_500,
      },
      {
        return_id: "return-equipment-2",
        equipment_id: "equipment-2",
        legacy_null_equipment_fallback: false,
        damage_disposition: "customer_billable",
        fuel_charge_cents: 3_000,
        cleaning_charge_cents: 2_000,
        damage_charge_cents: 10_000,
        environmental_fee_cents: 500,
      },
    ]);

    const plan = planNextInvoice(
      {
        ...BASE_CONTRACT,
        lifecycle_state: "returned",
        returned_at: "2026-06-20T08:00:00Z",
      },
      [],
      {
        count: 1,
        last_period_end: "2026-06-10",
        rental_charge_cents_total: 90_000,
      },
      aggregation.charges,
      "2026-06-21",
    );
    expect(plan?.kind).toBe("final");
    expect(plan?.charges.rental_charge_cents).toBe(0);
    expect(plan?.charges.fuel_charge_cents).toBe(11_000);
    expect(plan?.charges.cleaning_charge_cents).toBe(7_000);
    expect(plan?.charges.damage_charge_cents).toBe(50_000);
    expect(plan?.charges.other_charge_cents).toBe(3_000);
    expect(plan?.charges.subtotal_cents).toBe(86_000); // 71k returns + 15k pickup
  });

  it("excludes pending damage per unit while preserving its other charges", () => {
    const aggregation = aggregateReturnCharges([
      returnAssessment({
        id: "pending-damage",
        equipment_id: "equipment-1",
        fuel_charge_cents: 8_000,
        cleaning_charge_cents: 1_000,
        damage_charge_cents: 40_000,
        damage_disposition: "pending",
      }),
      returnAssessment({
        id: "billable-damage",
        equipment_id: "equipment-2",
        cleaning_charge_cents: 2_000,
        damage_charge_cents: 10_000,
        environmental_fee_cents: 500,
        damage_disposition: "customer_billable",
      }),
    ], { contract_id: BASE_CONTRACT.id, workspace_id: "default" });

    expect(aggregation.charges?.fuel_charge_cents).toBe(8_000);
    expect(aggregation.charges?.cleaning_charge_cents).toBe(3_000);
    expect(aggregation.charges?.damage_charge_cents).toBe(10_000);
    expect(aggregation.charges?.environmental_fee_cents).toBe(500);
    expect(aggregation.sources.find((source) => source.return_id === "pending-damage")
      ?.damage_charge_cents).toBe(0);
  });

  it("keeps aggregated return charges off interim invoices", () => {
    const aggregation = aggregateReturnCharges([
      returnAssessment({
        fuel_charge_cents: 8_000,
        cleaning_charge_cents: 5_000,
        damage_charge_cents: 40_000,
        environmental_fee_cents: 2_500,
        damage_disposition: "customer_billable",
      }),
    ], { contract_id: BASE_CONTRACT.id, workspace_id: "default" });

    const plan = planNextInvoice(
      BASE_CONTRACT,
      [],
      { count: 0, last_period_end: null, rental_charge_cents_total: 0 },
      aggregation.charges,
      "2026-06-30",
    );
    expect(plan?.kind).toBe("interim");
    expect(plan?.charges.fuel_charge_cents).toBe(0);
    expect(plan?.charges.cleaning_charge_cents).toBe(0);
    expect(plan?.charges.damage_charge_cents).toBe(0);
    expect(plan?.charges.other_charge_cents).toBe(0);
  });

  it("lets the latest corrected assessment supersede an older row for the same equipment", () => {
    const aggregation = aggregateReturnCharges([
      returnAssessment({
        id: "original-assessment",
        equipment_id: "equipment-1",
        created_at: "2026-06-20T10:00:00Z",
        updated_at: "2026-06-20T10:00:00Z",
        fuel_charge_cents: 8_000,
        cleaning_charge_cents: 5_000,
        damage_charge_cents: 40_000,
        damage_disposition: "customer_billable",
      }),
      returnAssessment({
        id: "corrected-assessment",
        equipment_id: "equipment-1",
        created_at: "2026-06-20T10:05:00Z",
        updated_at: "2026-06-20T10:05:00Z",
        fuel_charge_cents: 6_000,
        cleaning_charge_cents: 2_000,
        damage_charge_cents: 15_000,
        damage_disposition: "customer_billable",
      }),
    ], { contract_id: BASE_CONTRACT.id, workspace_id: "default" });

    expect(aggregation.charges?.fuel_charge_cents).toBe(6_000);
    expect(aggregation.charges?.cleaning_charge_cents).toBe(2_000);
    expect(aggregation.charges?.damage_charge_cents).toBe(15_000);
    expect(aggregation.selected_return_ids).toEqual(["corrected-assessment"]);
    expect(aggregation.superseded_return_ids).toEqual(["original-assessment"]);
  });

  it("uses one latest-only fallback bucket for legacy NULL-equipment rows", () => {
    const aggregation = aggregateReturnCharges([
      returnAssessment({
        id: "identified-unit",
        equipment_id: "equipment-1",
        fuel_charge_cents: 1_000,
      }),
      returnAssessment({
        id: "legacy-original",
        equipment_id: null,
        created_at: "2026-06-20T09:00:00Z",
        updated_at: "2026-06-20T09:00:00Z",
        fuel_charge_cents: 7_000,
      }),
      returnAssessment({
        id: "legacy-correction",
        equipment_id: null,
        created_at: "2026-06-20T11:00:00Z",
        updated_at: "2026-06-20T11:00:00Z",
        fuel_charge_cents: 4_000,
      }),
    ], { contract_id: BASE_CONTRACT.id, workspace_id: "default" });

    // The identified unit plus ONE legacy bucket are billable; ambiguous
    // legacy rows never stack as if they proved multiple physical units.
    expect(aggregation.charges?.fuel_charge_cents).toBe(5_000);
    expect(aggregation.legacy_null_equipment_return_id).toBe("legacy-correction");
    expect(aggregation.selected_return_ids).toEqual([
      "identified-unit",
      "legacy-correction",
    ]);
    expect(aggregation.superseded_return_ids).toEqual(["legacy-original"]);
  });

  it("rejects cross-contract, cross-workspace, and soft-deleted assessments", () => {
    const valid = returnAssessment({ id: "valid", fuel_charge_cents: 1_000 });
    const rows = [
      valid,
      returnAssessment({ id: "other-contract", rental_contract_id: "c-2", fuel_charge_cents: 20_000 }),
      returnAssessment({ id: "other-workspace", workspace_id: "other", fuel_charge_cents: 30_000 }),
      returnAssessment({ id: "soft-deleted", deleted_at: "2026-06-21T00:00:00Z", fuel_charge_cents: 40_000 }),
    ];

    const forward = aggregateReturnCharges(rows, {
      contract_id: BASE_CONTRACT.id,
      workspace_id: "default",
    });
    const reversed = aggregateReturnCharges([...rows].reverse(), {
      contract_id: BASE_CONTRACT.id,
      workspace_id: "default",
    });

    expect(forward.charges?.fuel_charge_cents).toBe(1_000);
    expect(forward.selected_return_ids).toEqual(["valid"]);
    expect(reversed).toEqual(forward); // query order cannot change money/evidence
  });
});

describe("rental-billing-core planner (blueprint §3)", () => {
  it("bills the first 28-day cycle in arrears with delivery fee and waiver on base only", () => {
    const plan = planNextInvoice(BASE_CONTRACT, [], { count: 0, last_period_end: null, rental_charge_cents_total: 0 }, null, "2026-06-30");
    expect(plan?.kind).toBe("interim");
    expect(plan?.period_start).toBe("2026-06-01");
    expect(plan?.period_end).toBe("2026-06-28");
    expect(plan?.charges.rental_charge_cents).toBe(90000);         // 28d = 1 month
    expect(plan?.charges.delivery_charge_cents).toBe(25000);       // first invoice only
    expect(plan?.charges.damage_waiver_charge_cents).toBe(9000);   // 10% of base, excl. delivery
    expect(plan?.charges.subtotal_cents).toBe(90000 + 25000 + 9000);
  });

  it("returns null while the cycle has not fully elapsed", () => {
    const plan = planNextInvoice(BASE_CONTRACT, [], { count: 0, last_period_end: null, rental_charge_cents_total: 0 }, null, "2026-06-15");
    expect(plan).toBeNull();
  });

  it("second cycle drops the delivery fee and advances the period", () => {
    const plan = planNextInvoice(BASE_CONTRACT, [], { count: 1, last_period_end: "2026-06-28", rental_charge_cents_total: 90000 }, null, "2026-07-28");
    expect(plan?.kind).toBe("interim");
    expect(plan?.period_start).toBe("2026-06-29");
    expect(plan?.charges.delivery_charge_cents).toBe(0);
  });

  it("off-rent stops interim billing and waits for the final", () => {
    const plan = planNextInvoice(
      { ...BASE_CONTRACT, lifecycle_state: "off_rent", off_rent_at: "2026-07-10T08:00:00Z" },
      [], { count: 1, last_period_end: "2026-06-28", rental_charge_cents_total: 90000 }, null, "2026-08-15",
    );
    expect(plan).toBeNull();
  });

  it("final invoice reconciles to the GLOBAL optimum minus already invoiced (stub never overbills)", () => {
    // 53 billable days total (off-rent stopped the clock), one cycle (90000)
    // already invoiced → optimum(53) = 2 months = 180000 → final rental 90000.
    const plan = planNextInvoice(
      {
        ...BASE_CONTRACT,
        lifecycle_state: "returned",
        off_rent_at: "2026-07-24T08:00:00Z", // 53 days after 06-01 08:00
        returned_at: "2026-07-30T12:00:00Z",
      },
      [{ included_hours: 100, outbound_meter_hours: 1000, return_meter_hours: 1120, overage_hourly_rate_cents: 4500 }],
      { count: 1, last_period_end: "2026-06-28", rental_charge_cents_total: 90000 },
      { fuel_charge_cents: 8000, cleaning_charge_cents: 5000, damage_charge_cents: 40000, environmental_fee_cents: 2500, damage_disposition: "customer_billable" },
      "2026-07-31",
    );
    expect(plan?.kind).toBe("final");
    expect(plan?.billable_days).toBe(53);
    expect(plan?.charges.rental_charge_cents).toBe(90000);          // 180000 − 90000
    expect(plan?.charges.pickup_charge_cents).toBe(15000);
    expect(plan?.charges.delivery_charge_cents).toBe(0);            // not the first invoice
    expect(plan?.charges.fuel_charge_cents).toBe(8000);
    expect(plan?.charges.damage_charge_cents).toBe(40000);          // customer_billable
    expect(plan?.charges.other_charge_cents).toBe(2500);            // environmental
    expect(plan?.charges.overage_charge_cents).toBe(90000);         // (120 − 100)h × 4500
    expect(plan?.charges.damage_waiver_charge_cents).toBe(9000);    // 10% of final rental base only
    expect(plan?.period_end).toBe("2026-07-24");                    // clock end, not return date
  });

  it("pending damage disposition never reaches the invoice (mig 772 pin)", () => {
    const plan = planNextInvoice(
      { ...BASE_CONTRACT, lifecycle_state: "returned", returned_at: "2026-06-20T08:00:00Z" },
      [], { count: 0, last_period_end: null, rental_charge_cents_total: 0 },
      { fuel_charge_cents: 8000, cleaning_charge_cents: null, damage_charge_cents: 40000, environmental_fee_cents: null, damage_disposition: "pending" },
      "2026-06-21",
    );
    expect(plan?.charges.damage_charge_cents).toBe(0);
    expect(plan?.charges.fuel_charge_cents).toBe(8000);
  });

  it("a returned contract with a final invoice already issued is not re-billed (idempotent, no inverted period)", () => {
    // Regression: after the final invoice writes, a re-run recomputed
    // period_start from the final's own period_end (last_period_end + 1),
    // landing past the clock end and inverting the range (period_end <
    // period_start) — which fails the rental_invoices period check every run.
    const returnedContract: BillingContractSnapshot = {
      ...BASE_CONTRACT,
      lifecycle_state: "returned",
      off_rent_at: "2026-06-28T08:00:00Z", // 27 days after 06-01 — sub-cycle
      returned_at: "2026-06-29T12:00:00Z",
    };
    const returnCharges = { fuel_charge_cents: 0, cleaning_charge_cents: 0, damage_charge_cents: null, environmental_fee_cents: null, damage_disposition: null };

    // First pass: no priors → a final invoice is planned, period not inverted.
    const first = planNextInvoice(returnedContract, [], { count: 0, last_period_end: null, rental_charge_cents_total: 0 }, returnCharges, "2026-06-30");
    expect(first?.kind).toBe("final");
    expect(first!.period_end >= first!.period_start).toBe(true);

    // Second pass: the final invoice now exists → nothing further is due.
    const second = planNextInvoice(
      returnedContract, [],
      { count: 1, last_period_end: first!.period_end, rental_charge_cents_total: first!.charges.rental_charge_cents, has_final_invoice: true },
      returnCharges, "2026-07-05",
    );
    expect(second).toBeNull();
  });

  it("clamps the final period_start to the clock end even without the final-invoice flag", () => {
    // Belt-and-suspenders for the inversion: a prior period_end at/after the
    // clock end must never produce period_end < period_start.
    const plan = planNextInvoice(
      { ...BASE_CONTRACT, lifecycle_state: "returned", off_rent_at: "2026-06-28T08:00:00Z", returned_at: "2026-06-29T12:00:00Z" },
      [],
      { count: 1, last_period_end: "2026-06-28", rental_charge_cents_total: 90000 }, // last interim ran to the clock end
      { fuel_charge_cents: 0, cleaning_charge_cents: 0, damage_charge_cents: null, environmental_fee_cents: null, damage_disposition: null },
      "2026-06-30",
    );
    expect(plan?.kind).toBe("final");
    expect(plan!.period_end >= plan!.period_start).toBe(true);
  });

  it("loaners bill zero base but still carry final return charges", () => {
    const plan = planNextInvoice(
      {
        ...BASE_CONTRACT,
        contract_type: "loaner",
        lifecycle_state: "returned",
        returned_at: "2026-06-20T08:00:00Z",
        agreed_daily_rate: null, agreed_weekly_rate: null, agreed_monthly_rate: null,
        delivery_fee_cents: null, pickup_fee_cents: null, damage_waiver_accepted: false,
      },
      [], { count: 0, last_period_end: null, rental_charge_cents_total: 0 },
      { fuel_charge_cents: 6000, cleaning_charge_cents: 4000, damage_charge_cents: null, environmental_fee_cents: null, damage_disposition: "pending" },
      "2026-06-21",
    );
    expect(plan?.kind).toBe("final");
    expect(plan?.charges.rental_charge_cents).toBe(0);
    expect(plan?.charges.subtotal_cents).toBe(10000);
  });
});
