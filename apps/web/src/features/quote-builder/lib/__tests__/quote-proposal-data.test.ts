import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { QEP_WEBSITE_QR_LABEL, QuotePDFDocument } from "../../components/QuotePDFDocument";
import { buildPrintableQuoteHtml } from "../quote-print-html";
import { buildQuoteProposalData } from "../quote-proposal-data";
import { computeQuoteWorkspace } from "../quote-workspace";
import type { QuoteFinanceScenario, QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function resolvePublicRoot(): string {
  const cwdPublic = resolve(process.cwd(), "public");
  if (existsSync(cwdPublic)) return cwdPublic;
  return resolve(process.cwd(), "apps/web/public");
}

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

function build(
  overrides: Partial<QuoteWorkspaceDraft> = {},
  financeScenarios: QuoteFinanceScenario[] = [],
  proposalOverrides: Partial<Parameters<typeof buildQuoteProposalData>[0]> = {},
) {
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
    ...proposalOverrides,
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

  test("does not expose inbound freight when visibility metadata marks it internal", () => {
    const data = build({
      pricingLines: [
        {
          kind: "freight",
          title: "Inbound freight",
          quantity: 1,
          unitPrice: 1_500,
          metadata: { pricing_field_key: "inbound_freight", freight_direction: "inbound" },
        },
        {
          kind: "freight",
          title: "Outbound delivery",
          quantity: 1,
          unitPrice: 2_200,
          metadata: { pricing_field_key: "outbound_delivery", freight_direction: "outbound" },
        },
      ],
    });

    expect(data.lineItems.map((line) => line.description)).not.toContain("Inbound freight");
    expect(data.lineItems.map((line) => line.description)).toContain("Outbound delivery");
  });


  test("projects only customer-safe media and spec metadata into proposal lines", () => {
    const data = build({
      equipment: [{
        kind: "equipment",
        title: "RT-135F",
        make: "ASV",
        model: "RT-135F",
        year: 2026,
        quantity: 1,
        unitPrice: 148_950,
        metadata: {
          stock_number: "Q003403",
          serial_number: "ASVRT135LTDF01723",
          condition: "new",
          warranty_text: "2 Year/ 2000 Hour Full Machine Warranty",
          long_description: "Forestry track loader",
          spec_bullets: ["132 HP", "50 GPM High Flow", "4060 PSI", "Guarding", "Cab", "Track", "Fan", "Display", "Unsafe ninth spec"],
          photo_url: "/storage/quote/asv.jpg",
          photo_urls: ["https://cdn.qep.example/asv-side.jpg", "javascript:alert(1)", "file:///tmp/local.jpg", "https://cdn.qep.example/asv-cab.jpg"],
          vendor_logo_url: "https://cdn.qep.example/asv-logo.png",
          dealer_cost: 100_000,
          margin: 0.21,
          source_id: "internal-catalog-row",
          ai_trigger_excerpt: "private transcript excerpt",
        },
      }],
    });

    const line = data.lineItems[0];
    expect(line?.stockNumber).toBe("Q003403");
    expect(line?.serialNumber).toBe("ASVRT135LTDF01723");
    expect(line?.condition).toBe("new");
    expect(line?.warrantyText).toBe("2 Year/ 2000 Hour Full Machine Warranty");
    expect(line?.specBullets).toHaveLength(8);
    expect(line?.media?.primaryPhoto?.src).toBe("/storage/quote/asv.jpg");
    expect(line?.media?.gallery?.map((asset) => asset.src)).toEqual(["https://cdn.qep.example/asv-side.jpg", "https://cdn.qep.example/asv-cab.jpg"]);
    expect(line?.vendorLogo?.src).toBe("https://cdn.qep.example/asv-logo.png");
    expect(JSON.stringify(line)).not.toContain("dealer_cost");
    expect(JSON.stringify(line)).not.toContain("internal-catalog-row");
    expect(JSON.stringify(line)).not.toContain("private transcript excerpt");
  });

  test("rejects unsafe customer media URLs from metadata", () => {
    const data = build({
      equipment: [{
        kind: "equipment",
        title: "Unsafe media",
        make: "ASV",
        model: "RT-75",
        year: 2026,
        quantity: 1,
        unitPrice: 80_000,
        metadata: {
          photo_url: "file:///Users/brianlewis/private.jpg",
          photo_urls: ["data:image/png;base64,abc", "//evil.example/x.png", "http://localhost/private.jpg", "http://192.168.1.10/private.jpg", "https://cdn.qep.example/safe.jpg"],
          vendor_logo_url: "javascript:alert(1)",
        },
      }],
    });

    const line = data.lineItems[0];
    expect(line?.media?.primaryPhoto?.src).toBe("https://cdn.qep.example/safe.jpg");
    expect(line?.vendorLogo).toBeNull();
    expect(JSON.stringify(line)).not.toContain("file://");
    expect(JSON.stringify(line)).not.toContain("data:image");
    expect(JSON.stringify(line)).not.toContain("javascript:");
    expect(JSON.stringify(line)).not.toContain("localhost");
    expect(JSON.stringify(line)).not.toContain("192.168");
  });

  test("enriches the trade allowance line from durable trade valuation media", () => {
    const data = build({
      tradeAllowance: 40_200,
      tradeValuationId: "trade-123",
    }, [], {
      tradeValuation: {
        id: "trade-123",
        make: "Deere",
        model: "333G",
        year: 2021,
        serialNumber: "SN123",
        hours: 2400,
        photos: [
          { type: "point_shoot", url: "https://cdn.qep.example/trade-front.jpg" },
          { type: "hour_meter", url: "javascript:alert(1)" },
          { type: "right", url: "https://cdn.qep.example/trade-right.jpg" },
        ],
        marketComps: [{ source: "IronPlanet", price: 43000 }, { source: "_aggregate", price: 45000 }],
        auctionValue: 45_000,
        discountedValue: 41_400,
        reconditioningEstimate: 1_200,
        preliminaryValue: 40_200,
        conditionalLanguage: "Traded machine must match evaluated condition",
        aiConditionNotes: "Clean undercarriage.",
        operationalStatus: "daily_use",
      },
    });

    const tradeLine = data.lineItems.find((line) => line.lineType === "trade_allowance");
    expect(tradeLine?.description).toBe("Trade-in allowance");
    expect(tradeLine?.make).toBe("Deere");
    expect(tradeLine?.model).toBe("333G");
    expect(tradeLine?.year).toBe(2021);
    expect(tradeLine?.serialNumber).toBe("SN123");
    expect(tradeLine?.media?.primaryPhoto?.src).toBe("https://cdn.qep.example/trade-front.jpg");
    expect(tradeLine?.media?.primaryPhoto?.mediaKind).toBe("trade_in");
    expect(tradeLine?.media?.gallery.map((asset) => asset.src)).toEqual(["https://cdn.qep.example/trade-right.jpg"]);
    expect(tradeLine?.specBullets).toEqual(expect.arrayContaining([
      "Hours: 2,400",
      "Preliminary value: $40,200",
      "Market midpoint: $45,000",
      "Market context: IronPlanet $43,000",
    ]));
    expect(JSON.stringify(tradeLine)).not.toContain("trade-123");
    expect(JSON.stringify(tradeLine)).not.toContain("javascript:");
  });

  test("manual trade allowance remains safe with no trade valuation media", () => {
    const data = build({ tradeAllowance: 5_000, tradeValuationId: null });
    const tradeLine = data.lineItems.find((line) => line.lineType === "trade_allowance");
    expect(tradeLine?.media).toBeUndefined();
    expect(tradeLine?.make).toBeNull();
    expect(tradeLine?.specBullets).toEqual([]);
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
    expect(html).toContain("EQUIPMENT ESTIMATE - NOT AN INVOICE");
    expect(html).toContain("/brand/qep/quote/qep-its-in-the-name-logo.png");
    expect(html).toContain("/brand/qep/quote/qep-qr.png");
    expect(html).toContain("Scan to visit QEP online");
    expect(html).not.toContain("Scan for quote feedback");
    expect(html).not.toContain("Scan for proposal feedback");
    expect(html).toContain("Truth in Lending Act");
    expect(html).toContain("#F28A07");
    expect(html).toContain("QEP-2026-0001");
    expect(html).toContain("FMV lease");
  });

  test("printable HTML renders trade-in photo evidence without changing website QR wording", () => {
    const data = build({ tradeAllowance: 35_000, tradeValuationId: "trade-456" }, [], {
      tradeValuation: {
        id: "trade-456",
        make: "Cat",
        model: "299D3",
        year: 2019,
        serialNumber: null,
        hours: 1800,
        photos: [{ type: "point_shoot", url: "https://cdn.qep.example/cat-trade.jpg" }],
        marketComps: [],
        auctionValue: null,
        discountedValue: null,
        reconditioningEstimate: null,
        preliminaryValue: 35_000,
        conditionalLanguage: null,
        aiConditionNotes: null,
        operationalStatus: "operational",
      },
    });
    const html = buildPrintableQuoteHtml(data);

    expect(html).toContain("https://cdn.qep.example/cat-trade.jpg");
    expect(html).toContain("trade-line-photo");
    expect(html).toContain("2019 Cat 299D3");
    expect(html).toContain("Scan to visit QEP online");
    expect(html).not.toContain("Scan to review this proposal");
  });


  test("production quote brand assets exist at public paths", () => {
    const data = build();
    const publicRoot = resolvePublicRoot();
    const assetPaths = [
      data.brandAssets.qepLogo?.src,
      ...data.brandAssets.vendorLogos.map((asset) => asset.src),
      data.brandAssets.qrCode?.src,
    ].filter((src): src is string => Boolean(src));

    expect(assetPaths.length).toBe(7);
    for (const src of assetPaths) {
      expect(src.startsWith("/brand/qep/quote/")).toBe(true);
      expect(existsSync(resolve(publicRoot, src.replace(/^\//, "")))).toBe(true);
    }
  });

  test("React-PDF component accepts the canonical proposal data shape", () => {
    const data = build({
      whyThisMachine: "Confirmed story.",
      whyThisMachineConfirmed: true,
      equipment: [{
        kind: "equipment",
        title: "ASV RT-135F",
        make: "ASV",
        model: "RT-135F",
        year: 2026,
        quantity: 1,
        unitPrice: 148_950,
        metadata: {
          stock_number: "Q003403",
          serial_number: "ASVRT135LTDF01723",
          photo_url: "https://cdn.qep.example/asv-front.jpg",
          photo_urls: ["https://cdn.qep.example/asv-side.jpg"],
          media_kind: "actual",
        },
      }],
    });
    const document = QuotePDFDocument({ data });
    const rendered = JSON.stringify(document);

    expect(document).toBeTruthy();
    expect(rendered).toContain("https://cdn.qep.example/asv-front.jpg");
    expect(rendered).toContain("Q003403");
    expect(rendered).toContain("/brand/qep/quote/qep-qr.png");
    expect(QEP_WEBSITE_QR_LABEL).toBe("Scan to visit QEP online");
    expect(rendered).not.toContain("Scan to review this proposal");
  });
});
