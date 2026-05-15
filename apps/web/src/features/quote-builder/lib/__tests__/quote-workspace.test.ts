import { describe, expect, test } from "bun:test";
import {
  computeCommercialDiscountTotal,
  computeQuoteSendActionReadiness,
  computeQuoteWorkspace,
  hasQuoteCustomerIdentity,
  isQuoteWhyThisMachineConfirmationRequired,
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

describe("computeQuoteSendActionReadiness", () => {
  test("keeps customer-facing email blocked until approval, document, follow-up, and email are present", () => {
    const result = computeQuoteSendActionReadiness({
      channel: "email",
      quotePackageId: "quote-1",
      approvalCaseCanSend: false,
      documentReady: false,
      followUpAt: null,
      customerEmail: "",
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      "clean owner approval",
      "document preview/generation",
      "follow-up date",
      "customer email",
    ]);
  });

  test("allows preview logging after clean approval and document fallback are ready without requiring follow-up", () => {
    const result = computeQuoteSendActionReadiness({
      channel: "preview",
      quotePackageId: "quote-1",
      approvalCaseCanSend: true,
      documentReady: true,
      followUpAt: null,
    });

    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test("requires rep-confirmed Why this machine narrative when present", () => {
    const result = computeQuoteSendActionReadiness({
      channel: "preview",
      quotePackageId: "quote-1",
      approvalCaseCanSend: true,
      documentReady: true,
      whyThisMachineRequired: true,
      whyThisMachineConfirmed: false,
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["rep-confirmed Why this machine narrative"]);
  });

  test("blocks customer-facing actions while tax preview is unresolved", () => {
    const result = computeQuoteSendActionReadiness({
      channel: "preview",
      quotePackageId: "quote-1",
      approvalCaseCanSend: true,
      documentReady: true,
      taxResolved: false,
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["resolved tax preview or override reason"]);
  });

  test("requires phone and follow-up before text quote send/log", () => {
    const result = computeQuoteSendActionReadiness({
      channel: "text",
      quotePackageId: "quote-1",
      approvalCaseCanSend: true,
      documentReady: true,
      followUpAt: "",
      customerPhone: "",
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["follow-up date", "customer phone"]);
  });
});

describe("isQuoteWhyThisMachineConfirmationRequired", () => {
  test("requires confirmation when AI reasoning or narrative text exists", () => {
    expect(isQuoteWhyThisMachineConfirmationRequired(makeDraft({ whyThisMachine: "Fits the job." }))).toBe(true);
    expect(isQuoteWhyThisMachineConfirmationRequired(makeDraft({
      recommendation: { machine: "CTL", attachments: [], reasoning: "AI suggested fit." },
    }))).toBe(true);
    expect(isQuoteWhyThisMachineConfirmationRequired(makeDraft())).toBe(false);
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
    expect(result.internalCostLoadTotal).toBe(0);
    expect(result.discountTotal).toBe(11_500);
    expect(result.discountedSubtotal).toBe(103_500);
    expect(result.netTotal).toBe(91_000);
    expect(result.customerTotal).toBe(95_500);
    expect(result.amountFinanced).toBe(75_500);
    expect(result.packetReadiness.canSave).toBe(true);
    expect(result.packetReadiness.canSend).toBe(false);
    expect(result.packetReadiness.send.missing).toContain("manager approval (margin below 10%)");
  });

  test("includes wizard pricing adders and rebate lines in taxable workspace totals", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 100_000 }],
      attachments: [
        { kind: "option", title: "Hydraulic coupler", quantity: 1, unitPrice: 4_000 },
        { kind: "accessory", title: "Beacon kit", quantity: 1, unitPrice: 1_000 },
      ],
      pricingLines: [
        { kind: "freight", title: "Freight", quantity: 1, unitPrice: 1_500 },
        { kind: "pdi", title: "PDI", quantity: 1, unitPrice: 750 },
        { kind: "rebate_mfg", title: "Manufacturer rebate", quantity: 1, unitPrice: 2_000 },
      ],
      commercialDiscountType: "flat",
      commercialDiscountValue: 1_000,
      tradeAllowance: 10_000,
      taxTotal: 5_595,
    }));

    expect(result.equipmentTotal).toBe(100_000);
    expect(result.attachmentTotal).toBe(5_000);
    expect(result.internalCostLoadTotal).toBe(750);
    expect(result.pricingLineTotal).toBe(1_500);
    expect(result.subtotal).toBe(106_500);
    expect(result.discountTotal).toBe(3_000);
    expect(result.taxableBasis).toBe(93_500);
    expect(result.customerTotal).toBe(99_095);
  });

  test("keeps inbound freight internal while outbound delivery remains customer-facing", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [{ kind: "equipment", title: "Kubota U55", quantity: 1, unitPrice: 80_000 }],
      attachments: [{ kind: "attachment", title: "Hydraulic thumb", quantity: 1, unitPrice: 4_000 }],
      pricingLines: [
        {
          kind: "freight",
          title: "Inbound freight to yard",
          quantity: 1,
          unitPrice: 1_800,
          costVisibility: "internal",
          metadata: { pricing_field_key: "inbound_freight", freight_direction: "inbound" },
        },
        {
          kind: "freight",
          title: "Outbound delivery",
          quantity: 1,
          unitPrice: 2_400,
          costVisibility: "customer",
          metadata: { pricing_field_key: "outbound_delivery", freight_direction: "outbound" },
        },
      ],
      taxTotal: 4_000,
    }));

    expect(result.subtotal).toBe(86_400);
    expect(result.internalCostLoadTotal).toBe(1_800);
    expect(result.pricingLineTotal).toBe(2_400);
    expect(result.taxableBasis).toBe(86_400);
    expect(result.customerTotal).toBe(90_400);
  });

  test("excludes internal-visibility config attachments from customer attachment totals", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [{ kind: "equipment", title: "Kubota U55", quantity: 1, unitPrice: 80_000 }],
      attachments: [
        { kind: "attachment", title: "Customer bucket", quantity: 1, unitPrice: 3_000, costVisibility: "customer" },
        { kind: "accessory", title: "Internal shop prep", quantity: 1, unitPrice: 900, costVisibility: "internal" },
      ],
      taxTotal: 0,
    }));

    expect(result.attachmentTotal).toBe(3_000);
    expect(result.internalCostLoadTotal).toBe(900);
    expect(result.subtotal).toBe(83_000);
  });

  test("excludes internal-visibility equipment from customer subtotal and rolls it into internal cost load", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [
        { kind: "equipment", title: "Customer machine", quantity: 1, unitPrice: 90_000, costVisibility: "customer" },
        { kind: "equipment", title: "Internal package line", quantity: 1, unitPrice: 5_000, costVisibility: "internal" },
      ],
      attachments: [],
      taxTotal: 0,
    }));

    expect(result.equipmentTotal).toBe(90_000);
    expect(result.internalCostLoadTotal).toBe(5_000);
    expect(result.subtotal).toBe(90_000);
  });

  test("blocks save when every equipment line is internal-only (no customer-facing machine)", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [
        { kind: "equipment", title: "Internal only A", quantity: 1, unitPrice: 5_000, costVisibility: "internal" },
        { kind: "equipment", title: "Internal only B", quantity: 1, unitPrice: 2_000, costVisibility: "internal" },
      ],
      taxTotal: 0,
    }));

    expect(result.packetReadiness.canSave).toBe(false);
    expect(result.packetReadiness.draft.missing).toContain(
      "customer-facing equipment (at least one machine line must not be internal-only)",
    );
  });

  test("treats metadata-tagged inbound freight as internal when costVisibility is missing", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [{ kind: "equipment", title: "Kubota U55", quantity: 1, unitPrice: 80_000 }],
      pricingLines: [
        {
          kind: "freight",
          title: "Inbound freight to yard",
          quantity: 1,
          unitPrice: 1_800,
          metadata: { pricing_field_key: "inbound_freight", freight_direction: "inbound" },
        },
      ],
      taxTotal: 3_000,
    }));

    expect(result.pricingLineTotal).toBe(0);
    expect(result.internalCostLoadTotal).toBe(1_800);
    expect(result.subtotal).toBe(80_000);
    expect(result.customerTotal).toBe(83_000);
  });

  test("legacy custom and financing attachment rows still contribute to totals", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 100_000 }],
      attachments: [
        { kind: "custom", title: "Legacy custom setup", quantity: 1, unitPrice: 2_000 },
        { kind: "financing", title: "Legacy finance fee", quantity: 1, unitPrice: 750 },
      ],
      taxTotal: 6_000,
    }));

    expect(result.attachmentTotal).toBe(0);
    expect(result.pricingLineTotal).toBe(2_750);
    expect(result.subtotal).toBe(102_750);
    expect(result.taxableBasis).toBe(102_750);
    expect(result.customerTotal).toBe(108_750);
  });

  test("approved low-margin quotes become send-ready", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      quoteStatus: "approved",
      equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 105_000 }],
      attachments: [{ kind: "attachment", title: "Mulcher", quantity: 1, unitPrice: 10_000 }],
      commercialDiscountType: "percent",
      commercialDiscountValue: 10,
      tradeAllowance: 12_500,
      taxTotal: 4_500,
      cashDown: 20_000,
    }));

    expect(result.approvalState.requiresManagerApproval).toBe(true);
    expect(result.packetReadiness.send.ready).toBe(true);
    expect(result.packetReadiness.canSend).toBe(true);
    expect(result.packetReadiness.send.missing).not.toContain("manager approval (margin below 10%)");
  });

  test("pending approval keeps the send gate closed with explicit status", () => {
    const result = computeQuoteWorkspace(makeDraft({
      branchSlug: "lake-city",
      customerName: "Anderson",
      customerEmail: "buyer@example.com",
      quoteStatus: "pending_approval",
      equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 105_000 }],
      attachments: [{ kind: "attachment", title: "Mulcher", quantity: 1, unitPrice: 10_000 }],
      commercialDiscountType: "percent",
      commercialDiscountValue: 10,
      tradeAllowance: 12_500,
      taxTotal: 4_500,
      cashDown: 20_000,
    }));

    expect(result.packetReadiness.canSend).toBe(false);
    expect(result.packetReadiness.send.missing).toContain("manager approval pending");
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
