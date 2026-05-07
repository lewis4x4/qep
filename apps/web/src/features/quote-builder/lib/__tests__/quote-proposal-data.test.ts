import { describe, expect, test } from "bun:test";

import { QuotePDFDocument } from "../../components/QuotePDFDocument";
import { buildPrintableQuoteHtml } from "../quote-print-html";
import { buildQuoteProposalData } from "../quote-proposal-data";
import { computeQuoteWorkspace } from "../quote-workspace";
import type { QuoteFinanceScenario, QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function makeDraft(overrides: Partial<QuoteWorkspaceDraft> = {}): QuoteWorkspaceDraft {
  return {
    entryMode: "manual",
    branchSlug: "lake-city",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    pricingLines: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 0,
    selectedFinanceScenario: null,
    customerName: "Anderson Farms",
    customerCompany: "Anderson Farms LLC",
    customerPhone: "919-555-0100",
    customerEmail: "buyer@example.com",
    customerSignals: null,
    customerWarmth: null,
    ...overrides,
  };
}

function branch() {
  return {
    name: "Quality Equipment & Parts",
    address: "123 Main St",
    city: "Lake City",
    state: "FL",
    postalCode: "32025",
    phone: "386-555-0100",
    email: "sales@qep.example",
    website: "https://qep.example",
    footerText: "Valid 30 days.",
  };
}

function build(overrides: Partial<QuoteWorkspaceDraft> = {}, financeScenarios: QuoteFinanceScenario[] = []) {
  const draft = makeDraft({
    equipment: [{ kind: "equipment", title: "T770", make: "Bobcat", model: "T770", year: 2026, quantity: 1, unitPrice: 100_000 }],
    attachments: [{ kind: "attachment", title: "Forestry mulcher", quantity: 1, unitPrice: 10_000 }],
    taxTotal: 6_000,
    ...overrides,
  });
  const computed = computeQuoteWorkspace(draft);
  return buildQuoteProposalData({
    draft,
    computed,
    financeScenarios,
    quoteNumber: "QEP-2026-0001",
    preparedBy: "QEP Sales Team",
    preparedDate: "5/7/2026",
    branch: branch(),
  });
}

describe("buildQuoteProposalData", () => {
  test("uses confirmed Why This Machine as the only customer narrative", () => {
    const data = build({
      whyThisMachine: "The T770 is sized for your forestry rows and hydraulic attachment plan.",
      whyThisMachineConfirmed: true,
      recommendation: {
        machine: "Bobcat T770",
        attachments: ["Forestry mulcher"],
        reasoning: "RAW AI reasoning should not be shown as narrative.",
        jobFacts: [{ label: "Acres", value: "80" }],
        transcriptHighlights: [{ quote: "Need forestry cleanup", supports: "Mulcher package" }],
      },
    });

    expect(data.aiRecommendationSummary).toBeNull();
    expect(data.narrative.text).toBe("The T770 is sized for your forestry rows and hydraulic attachment plan.");
    expect(data.narrative.facts).toEqual([{ label: "Acres", value: "80" }]);
    expect(data.narrative.highlights).toEqual([{ quote: "", supports: "Mulcher package" }]);
    expect(JSON.stringify(data)).not.toContain("RAW AI reasoning should not be shown as narrative");
    expect(JSON.stringify(data)).not.toContain("Need forestry cleanup");
  });

  test("does not fall back to AI recommendation when narrative is unconfirmed", () => {
    const data = build({
      whyThisMachine: "Rep draft not confirmed.",
      whyThisMachineConfirmed: false,
      recommendation: { machine: "Bobcat T770", attachments: [], reasoning: "AI fallback unsafe." },
    });

    expect(data.narrative.text).toBeNull();
    expect(data.narrative.facts).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("AI fallback unsafe");
  });

  test("builds a customer-visible line-item waterfall with credits", () => {
    const data = build({
      pricingLines: [
        { kind: "freight", title: "Inbound freight", quantity: 1, unitPrice: 1_500 },
        { kind: "rebate_mfg", title: "Manufacturer rebate", quantity: 1, unitPrice: 2_000, reasonCode: "aged_inventory" },
      ],
      commercialDiscountType: "flat",
      commercialDiscountValue: 1_000,
      tradeAllowance: 5_000,
    });

    expect(data.lineItems.map((line) => line.description)).toEqual([
      "2026 Bobcat T770",
      "Forestry mulcher",
      "Inbound freight",
      "Manufacturer rebate",
      "Commercial discount",
      "Trade-in allowance",
    ]);
    expect(data.lineItems.find((line) => line.description === "Manufacturer rebate")?.tone).toBe("credit");
    expect(data.lineItems.find((line) => line.description === "Commercial discount")?.displayAmount).toBe(1_000);
    expect(data.lineItems.every((line) => !("dealerCost" in line) && !("metadata" in line))).toBe(true);
  });

  test("labels cash proposal totals as customer total and preserves nullable finance fields", () => {
    const data = build({
      selectedFinanceScenario: "Cash",
      cashDown: 0,
    }, [
      { type: "cash", kind: "cash", label: "Cash", totalCost: 116_000, termMonths: null, monthlyPayment: null, rate: null },
    ]);

    expect(data.compliance.selectedPaymentKind).toBe("cash");
    expect(data.compliance.primaryTotalLabel).toBe("Customer total");
    expect(data.financing[0]?.monthlyPayment).toBeNull();
    expect(data.financing[0]?.termMonths).toBeNull();
  });

  test("labels finance proposals as amount financed and includes TILA-aware copy", () => {
    const data = build({
      selectedFinanceScenario: "60 months",
      cashDown: 10_000,
      taxOverrideAmount: 4_250,
      taxOverrideReason: "County cap confirmed by manager",
      specialTerms: "Subject to final freight confirmation.",
      expiresAt: "2026-06-06",
    }, [
      { type: "finance", kind: "finance", label: "60 months", monthlyPayment: 2_050, termMonths: 60, rate: 7.25, totalCost: 123_000, lender: "Preferred lender" },
      { type: "lease", kind: "lease_fmv", label: "FMV lease", monthlyPayment: 1_850, termMonths: 48, rate: 6.9, totalCost: 118_000, lender: "Lease partner" },
    ]);

    expect(data.compliance.selectedPaymentKind).toBe("finance");
    expect(data.compliance.primaryTotalLabel).toBe("Amount financed");
    expect(data.compliance.financingDisclaimer).toContain("Truth in Lending Act");
    expect(data.compliance.taxLabel).toBe("Tax override applied");
    expect(data.compliance.taxDetail).toContain("County cap confirmed by manager");
    expect(data.specialTerms).toBe("Subject to final freight confirmation.");
    expect(data.validUntil).toMatch(/2026|6/);
  });

  test("printable HTML renders the same safe proposal elements", () => {
    const data = build({
      whyThisMachine: "Confirmed customer-safe story.",
      whyThisMachineConfirmed: true,
      recommendation: { machine: "Bobcat T770", attachments: [], reasoning: "Unsafe AI reasoning." },
      selectedFinanceScenario: "60 months",
    }, [
      { type: "finance", kind: "finance", label: "60 months", monthlyPayment: 2_050, termMonths: 60, rate: 7.25, totalCost: 123_000, lender: "Preferred lender" },
      { type: "lease", kind: "lease_fmv", label: "FMV lease", monthlyPayment: 1_850, termMonths: 48, rate: 6.9, totalCost: 118_000, lender: "Lease partner" },
    ]);
    const html = buildPrintableQuoteHtml(data);

    expect(html).toContain("Why this machine");
    expect(html).toContain("Confirmed customer-safe story.");
    expect(html).not.toContain("Unsafe AI reasoning.");
    expect(html).not.toContain("Deposit placeholder");
    expect(html).toContain("Deposit required");
    expect(html).toContain("Configuration waterfall");
    expect(html).toContain("Truth in Lending Act");
    expect(html).toContain("#F28A07");
    expect(html).toContain("QEP-2026-0001");
    expect(html).toContain("FMV lease");
  });

  test("React-PDF component accepts the canonical proposal data shape", () => {
    const data = build({ whyThisMachine: "Confirmed story.", whyThisMachineConfirmed: true });

    expect(QuotePDFDocument({ data })).toBeTruthy();
  });
});
