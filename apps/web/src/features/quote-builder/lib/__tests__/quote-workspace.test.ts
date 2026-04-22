import { describe, expect, test } from "bun:test";
import {
  computeCommercialDiscountTotal,
  computeQuoteWorkspace,
  hasQuoteCustomerIdentity,
  isTaxProfileExempt,
} from "../quote-workspace";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function makeDraft(overrides: Partial<QuoteWorkspaceDraft> = {}): QuoteWorkspaceDraft {
  return {
    entryMode: "manual",
    branchSlug: "",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 0,
    selectedFinanceScenario: null,
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    ...overrides,
  };
}

describe("computeCommercialDiscountTotal", () => {
  test("flat discounts clamp to subtotal", () => {
    expect(
      computeCommercialDiscountTotal({
        subtotal: 10_000,
        discountType: "flat",
        discountValue: 12_500,
      }),
    ).toBe(10_000);
  });

  test("percent discounts clamp to 100%", () => {
    expect(
      computeCommercialDiscountTotal({
        subtotal: 10_000,
        discountType: "percent",
        discountValue: 125,
      }),
    ).toBe(10_000);
  });

  test("percent discounts compute against subtotal", () => {
    expect(
      computeCommercialDiscountTotal({
        subtotal: 10_000,
        discountType: "percent",
        discountValue: 7.5,
      }),
    ).toBe(750);
  });
});

describe("hasQuoteCustomerIdentity", () => {
  test("accepts a typed prospect name", () => {
    expect(hasQuoteCustomerIdentity(makeDraft({ customerName: "Walk-in prospect" }))).toBe(true);
  });

  test("accepts CRM ids", () => {
    expect(hasQuoteCustomerIdentity(makeDraft({ companyId: "co-1" }))).toBe(true);
  });

  test("rejects empty identity", () => {
    expect(hasQuoteCustomerIdentity(makeDraft())).toBe(false);
  });
});

describe("isTaxProfileExempt", () => {
  test("standard is taxable", () => {
    expect(isTaxProfileExempt("standard")).toBe(false);
  });

  test("non-standard profiles are exempt intents", () => {
    expect(isTaxProfileExempt("agriculture_exempt")).toBe(true);
    expect(isTaxProfileExempt("fire_mitigation_exempt")).toBe(true);
  });
});

describe("computeQuoteWorkspace", () => {
  test("computes commercial totals from discount, trade, tax, and cash down", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 105_000 }],
      attachments: [{ kind: "attachment", title: "Mulcher", quantity: 1, unitPrice: 10_000 }],
      commercialDiscountType: "percent",
      commercialDiscountValue: 10,
      tradeAllowance: 12_500,
      taxTotal: 4_500,
      cashDown: 20_000,
    }));

    expect(result.subtotal).toBe(115_000);
    expect(result.discountTotal).toBe(11_500);
    expect(result.discountedSubtotal).toBe(103_500);
    expect(result.netTotal).toBe(91_000);
    expect(result.customerTotal).toBe(95_500);
    expect(result.amountFinanced).toBe(75_500);
    expect(result.packetReadiness.canSave).toBe(true);
    expect(result.packetReadiness.canSend).toBe(false);
    expect(result.packetReadiness.send.missing).toContain("manager approval (margin below 10%)");
  });

  test("save readiness no longer requires branch or linked deal", () => {
    const result = computeQuoteWorkspace(makeDraft({
      customerName: "Walk-in prospect",
      equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 105_000 }],
    }));

    expect(result.packetReadiness.canSave).toBe(true);
    expect(result.packetReadiness.draft.ready).toBe(true);
    expect(result.packetReadiness.send.ready).toBe(false);
    expect(result.packetReadiness.send.missing).toContain("quoting branch");
    expect(result.packetReadiness.send.missing).toContain("customer email");
  });
});
