import { describe, expect, it } from "bun:test";
import { planNextInvoice, type BillingContractSnapshot } from "./rental-billing-core";

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
