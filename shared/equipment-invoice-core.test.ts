import { describe, expect, test } from "bun:test";
import {
  equipmentEntriesFromQuote,
  planEquipmentInvoice,
  type EquipmentInvoicePlanInput,
} from "./equipment-invoice-core.ts";

function baseInput(overrides: Partial<EquipmentInvoicePlanInput> = {}): EquipmentInvoicePlanInput {
  return {
    quotePackage: {
      id: "qp-1",
      subtotal: 100_000,
      equipment_total: 100_000,
      attachment_total: 0,
      trade_allowance: 0,
      trade_credit: 0,
      tax_profile: "standard",
      fet_total: 0,
      fet_rate: null,
      fet_taxable_amount: null,
      fet_exemption_certificate_id: null,
      equipment: [{ year: 2024, make: "Deere", model: "333G", price: 100_000 }],
    },
    deposits: [],
    salesTax: {
      total_tax: 6_375,
      state_tax: 6_000,
      county_tax: 375,
      taxable_basis: 100_000,
      tax_lines: [],
      manual_override_applied: false,
    },
    jurisdiction: {
      state_code: "FL",
      county_name: "Polk",
      state_rate: 0.06,
      county_surtax_rate: 0.01,
      surtax_cap_amount: 5_000,
    },
    invoiceDate: "2026-07-08",
    ...overrides,
  };
}

describe("equipmentEntriesFromQuote", () => {
  test("parses jsonb entries into descriptions and prices", () => {
    const entries = equipmentEntriesFromQuote([
      { year: 2024, make: "Deere", model: "333G", price: "98500.50", quantity: 1 },
      { description: "Pallet forks", price: 1200 },
    ]);
    expect(entries).toEqual([
      { description: "2024 Deere 333G", quantity: 1, unitPrice: 98500.5 },
      { description: "Pallet forks", quantity: 1, unitPrice: 1200 },
    ]);
  });

  test("tolerates non-array and junk entries", () => {
    expect(equipmentEntriesFromQuote(null)).toEqual([]);
    expect(equipmentEntriesFromQuote({ not: "an array" })).toEqual([]);
    expect(equipmentEntriesFromQuote([null, "junk", { price: 5 }])).toHaveLength(1);
  });
});

describe("planEquipmentInvoice", () => {
  test("plain sale: amount = subtotal, total = amount + tax", () => {
    const plan = planEquipmentInvoice(baseInput());
    expect(plan.amount).toBe(100_000);
    expect(plan.tax).toBe(6_375);
    expect(plan.total).toBe(106_375);
    expect(plan.amountPaid).toBe(0);
    expect(plan.status).toBe("pending");
    expect(plan.dueDate).toBe("2026-08-07");
    expect(plan.taxFailed).toBe(false);
    expect(plan.lines).toEqual([
      { description: "2024 Deere 333G", quantity: 1, unit_price: 100_000 },
    ]);
  });

  test("trade allowance nets the amount and adds a negative line", () => {
    const input = baseInput();
    input.quotePackage.trade_allowance = 25_000;
    const plan = planEquipmentInvoice(input);
    expect(plan.tradeValue).toBe(25_000);
    expect(plan.amount).toBe(75_000);
    expect(plan.lines).toContainEqual({
      description: "Trade-in allowance",
      quantity: 1,
      unit_price: -25_000,
    });
  });

  test("trade_credit is used when trade_allowance is absent", () => {
    const input = baseInput();
    input.quotePackage.trade_allowance = null;
    input.quotePackage.trade_credit = "10000";
    const plan = planEquipmentInvoice(input);
    expect(plan.tradeValue).toBe(10_000);
    expect(plan.amount).toBe(90_000);
  });

  test("FET adds a line, rides amount, and marks liability estimated", () => {
    const input = baseInput();
    input.quotePackage.fet_total = 12_000;
    const plan = planEquipmentInvoice(input);
    expect(plan.fetAmount).toBe(12_000);
    expect(plan.fetLiabilityStatus).toBe("estimated");
    expect(plan.amount).toBe(112_000);
    expect(plan.lines).toContainEqual({
      description: "Federal excise tax",
      quantity: 1,
      unit_price: 12_000,
    });
  });

  test("FET exemption certificate with zero FET marks exempt", () => {
    const input = baseInput();
    input.quotePackage.fet_exemption_certificate_id = "cert-1";
    const plan = planEquipmentInvoice(input);
    expect(plan.fetLiabilityStatus).toBe("exempt");
  });

  test("verified deposits apply to amount_paid; pending ones do not", () => {
    const input = baseInput();
    input.deposits = [
      { id: "d-1", status: "verified", required_amount: 5_000 },
      { id: "d-2", status: "received", required_amount: "2500" },
      { id: "d-3", status: "pending", required_amount: 99_999 },
    ];
    const plan = planEquipmentInvoice(input);
    expect(plan.amountPaid).toBe(7_500);
    expect(plan.status).toBe("partial");
    expect(plan.appliedDepositIds).toEqual(["d-1", "d-2"]);
  });

  test("deposit application is capped at total and flips status to paid", () => {
    const input = baseInput();
    input.deposits = [{ id: "d-1", status: "verified", required_amount: 500_000 }];
    const plan = planEquipmentInvoice(input);
    expect(plan.amountPaid).toBe(plan.total);
    expect(plan.status).toBe("paid");
  });

  test("tax failure degrades to zero tax and a flagged breakdown, never blocks", () => {
    const input = baseInput({ salesTax: null, taxFailureReason: "no_county_jurisdiction" });
    const plan = planEquipmentInvoice(input);
    expect(plan.taxFailed).toBe(true);
    expect(plan.tax).toBe(0);
    expect(plan.total).toBe(plan.amount);
    expect(plan.taxBreakdown.tax_failed).toBe(true);
    expect(plan.taxBreakdown.tax_failure_reason).toBe("no_county_jurisdiction");
  });

  test("subtotal drift from line entries is reconciled with an adjustment line", () => {
    const input = baseInput();
    input.quotePackage.subtotal = 101_500; // freight/doc fees on top of the unit
    const plan = planEquipmentInvoice(input);
    expect(plan.lines).toContainEqual({
      description: "Attachments, fees & adjustments",
      quantity: 1,
      unit_price: 1_500,
    });
    expect(plan.amount).toBe(101_500);
    const linesSum = plan.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
    expect(Math.round(linesSum * 100) / 100).toBe(plan.amount);
  });

  test("missing equipment jsonb falls back to a single sale line", () => {
    const input = baseInput();
    input.quotePackage.equipment = null;
    const plan = planEquipmentInvoice(input);
    expect(plan.lines[0]).toEqual({ description: "Equipment sale", quantity: 1, unit_price: 100_000 });
  });

  test("DR-15 breakdown carries county fields from the jurisdiction", () => {
    const plan = planEquipmentInvoice(baseInput());
    expect(plan.taxBreakdown.county_name).toBe("Polk");
    expect(plan.taxBreakdown.state_rate).toBe(0.06);
    expect(plan.taxBreakdown.county_surtax_rate).toBe(0.01);
    expect(plan.taxBreakdown.surtax_cap_amount).toBe(5_000);
    expect(plan.taxCode1).toBe("FL");
    expect(plan.taxCode2).toBe("Polk");
  });

  test("lines always sum to invoice amount (GL journal parity)", () => {
    const input = baseInput();
    input.quotePackage.trade_allowance = 25_000;
    input.quotePackage.fet_total = 9_000;
    input.quotePackage.subtotal = 102_350.75;
    const plan = planEquipmentInvoice(input);
    const linesSum = plan.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
    expect(Math.round(linesSum * 100) / 100).toBe(plan.amount);
  });
});
