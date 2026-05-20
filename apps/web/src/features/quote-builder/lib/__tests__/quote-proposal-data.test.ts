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

const FORBIDDEN_CUSTOMER_TRADE_INTERNALS = [
  "IronPlanet",
  "Ritchie Bros",
  "_aggregate",
  "COMPARABLE MARKET RANGE",
  "NOT A GUARANTEED OFFER",
  "Trade Range",
  "auctionValue",
  "discountedValue",
  "preliminaryValue",
  "finalValue",
  "marketComps",
];

function expectNoCustomerTradeInternals(rendered: string, valuationId = "trade-123") {
  for (const term of [...FORBIDDEN_CUSTOMER_TRADE_INTERNALS, valuationId]) {
    expect(rendered).not.toContain(term);
  }
}

const FORBIDDEN_DEAL_IQ_INTERNALS = [
  "Deal IQ says",
  "win probability is",
  "commission projection",
  "flagged risk",
  "marginPct",
  "marginAmount",
  "dealerCost",
  "dealer_cost",
  "gross margin",
  "approval policy",
  "approval_policy",
  "discount cap",
  "discount_cap",
  "rep discount max",
  "standard margin floor",
  "margin_pct",
  "win_probability",
  "commission_projection",
];

function expectNoDealIqInternals(rendered: string) {
  const normalized = rendered.toLowerCase();
  for (const term of FORBIDDEN_DEAL_IQ_INTERNALS) {
    expect(normalized).not.toContain(term.toLowerCase());
  }
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

  test("filters Deal IQ and internal economics from customer proposal, printable HTML, and PDF data", () => {
    const data = build({
      whyThisMachine: "Deal IQ says win probability is 82 and commission projection is ready.",
      whyThisMachineConfirmed: true,
      specialTerms: "Approval policy says discount cap exception was approved.",
      taxOverrideAmount: 250,
      taxOverrideReason: "Commission projection marginAmount review.",
      recommendation: {
        machine: "Bobcat T770",
        attachments: ["Forestry mulcher", "dealerCost worksheet"],
        reasoning: "RAW AI reasoning should not render.",
        jobFacts: [
          { label: "Application", value: "Forestry cleanup" },
          { label: "Dealer cost", value: "dealerCost 70000" },
        ],
        transcriptHighlights: [
          { quote: "", supports: "Customer wants high-flow hydraulics" },
          { quote: "", supports: "flagged risk: rep discount max exceeded" },
        ],
        jobConsiderations: ["Customer needs high-flow hydraulics", "gross margin needs review"],
        alternative: {
          machine: "Alternative CTL",
          attachments: ["Safe bucket", "standard margin floor worksheet"],
          reasoning: "marginPct 22 with approval policy path",
          whyNotChosen: "standard margin floor risk",
        },
      },
      equipment: [{
        kind: "equipment",
        title: "T770",
        make: "Bobcat",
        model: "T770",
        year: 2026,
        quantity: 1,
        unitPrice: 100_000,
        metadata: {
          condition: "win_probability high",
          long_description: "dealer cost and marginAmount should stay internal",
          spec_bullets: ["High-flow hydraulics", "commission projection ready"],
        },
      }],
      attachments: [
        { kind: "attachment", title: "Safe bucket", quantity: 1, unitPrice: 1_000 },
        { kind: "attachment", title: "commission_projection kit", quantity: 1, unitPrice: 500 },
      ],
      pricingLines: [{
        kind: "custom",
        title: "dealer_cost worksheet",
        quantity: 1,
        unitPrice: 100,
        reasonCode: "approval_policy discount_cap",
      }],
    });
    const json = JSON.stringify(data);
    const html = buildPrintableQuoteHtml(data);
    const pdfRendered = JSON.stringify(QuotePDFDocument({ data }));

    expect(data.narrative.text).toBeNull();
    expect(data.narrative.facts).toEqual([{ label: "Application", value: "Forestry cleanup" }]);
    expect(data.narrative.highlights).toEqual([{ quote: "", supports: "Customer wants high-flow hydraulics" }]);
    expect(data.narrative.considerations).toEqual(["Customer needs high-flow hydraulics"]);
    expect(data.narrative.alternative).toMatchObject({
      machine: "Alternative CTL",
      attachments: ["Safe bucket"],
      reasoning: "",
      whyNotChosen: null,
    });
    expect(data.lineItems[0]?.condition).toBeNull();
    expect(data.lineItems[0]?.longDescription).toBeNull();
    expect(data.lineItems[0]?.specBullets).toEqual(["High-flow hydraulics"]);
    expect(data.attachments.map((item) => item.name)).toEqual(["Safe bucket", "Attachment"]);
    expect(data.lineItems.some((item) => item.reasonCode === "approval_policy discount_cap")).toBe(false);
    expect(data.specialTerms).toBeNull();
    expect(data.compliance.specialTerms).toBeNull();
    expect(data.compliance.taxDetail).toBe("Manual tax override recorded. Reason pending.");
    expectNoDealIqInternals(json);
    expectNoDealIqInternals(html);
    expectNoDealIqInternals(pdfRendered);
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

  test("drops internal-visibility attachments from proposal attachment summary", () => {
    const data = build({
      attachments: [
        { kind: "attachment", title: "Customer-facing add-on", quantity: 1, unitPrice: 2_500, costVisibility: "customer" },
        { kind: "accessory", title: "Internal labor bundle", quantity: 1, unitPrice: 400, costVisibility: "internal" },
      ],
    });

    expect(data.attachments.map((row) => row.name)).toEqual(["Customer-facing add-on"]);
    expect(data.lineItems.map((line) => line.description)).toContain("Customer-facing add-on");
    expect(data.lineItems.map((line) => line.description)).not.toContain("Internal labor bundle");
    expect(data.attachmentTotal).toBe(2_500);
  });

  test("drops internal-visibility equipment from proposal equipment summary and line waterfall", () => {
    const data = build({
      equipment: [
        {
          kind: "equipment",
          title: "Customer CTL",
          make: "Bobcat",
          model: "T66",
          year: 2026,
          quantity: 1,
          unitPrice: 85_000,
          costVisibility: "customer",
        },
        {
          kind: "equipment",
          title: "Internal bundle row",
          make: "Bobcat",
          model: "Bundle",
          year: 2026,
          quantity: 1,
          unitPrice: 3_000,
          costVisibility: "internal",
        },
      ],
    });

    expect(data.equipment.map((row) => row.model)).toEqual(["T66"]);
    expect(data.lineItems.map((line) => line.description)).toContain("2026 Bobcat T66");
    expect(data.lineItems.map((line) => line.description)).not.toContain("2026 Bobcat Bundle");
    expect(data.equipmentTotal).toBe(85_000);
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
    expect(data.coverGalleryUnits[0]?.photos.map((asset) => asset.src)).toEqual(["/storage/quote/asv.jpg", "https://cdn.qep.example/asv-side.jpg", "https://cdn.qep.example/asv-cab.jpg"]);
    expect(line?.vendorLogo?.src).toBe("https://cdn.qep.example/asv-logo.png");
    expect(JSON.stringify(line)).not.toContain("dealer_cost");
    expect(JSON.stringify(line)).not.toContain("internal-catalog-row");
    expect(JSON.stringify(line)).not.toContain("private transcript excerpt");
  });

  test("builds customer-facing cover gallery units from equipment media only", () => {
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
          photo_url: "https://cdn.qep.example/asv-front.jpg",
          photo_urls: [
            "https://cdn.qep.example/asv-front.jpg",
            "https://cdn.qep.example/asv-side.jpg",
            "https://cdn.qep.example/asv-cab.jpg",
            "https://cdn.qep.example/asv-rear.jpg",
            "https://cdn.qep.example/asv-left.jpg",
            "https://cdn.qep.example/asv-right.jpg",
            "http://localhost/private.jpg",
          ],
          media_kind: "actual",
        },
      }, {
        kind: "equipment",
        title: "T770",
        make: "Bobcat",
        model: "T770",
        year: 2026,
        quantity: 1,
        unitPrice: 100_000,
        metadata: {
          photo_urls: ["https://cdn.qep.example/t770-front.jpg", "https://cdn.qep.example/t770-side.jpg"],
          media_kind: "model_generic",
        },
      }],
      attachments: [{
        kind: "attachment",
        title: "Forestry mulcher",
        quantity: 1,
        unitPrice: 10_000,
        metadata: { photo_url: "https://cdn.qep.example/mulcher.jpg" },
      }],
      tradeAllowance: 40_000,
      tradeValuationId: "trade-hero-gallery",
    }, [], {
      tradeValuation: {
        id: "trade-hero-gallery",
        make: "Deere",
        model: "333G",
        year: 2021,
        serialNumber: "SN123",
        hours: 2400,
        photos: [{ type: "point_shoot", url: "https://cdn.qep.example/trade-front.jpg" }],
        marketComps: [],
        auctionValue: null,
        discountedValue: null,
        reconditioningEstimate: null,
        preliminaryValue: 40_000,
        conditionalLanguage: null,
        aiConditionNotes: null,
        operationalStatus: "daily_use",
      },
    });

    expect(data.coverGalleryUnits).toHaveLength(2);
    expect(data.coverGalleryUnits[0]).toMatchObject({
      title: "2026 ASV RT-135F",
      meta: "Stock #: Q003403 · Serial #: ASVRT135LTDF01723 · new",
    });
    expect(data.coverGalleryUnits[0]?.photos.map((asset) => asset.src)).toEqual([
      "https://cdn.qep.example/asv-front.jpg",
      "https://cdn.qep.example/asv-side.jpg",
      "https://cdn.qep.example/asv-cab.jpg",
      "https://cdn.qep.example/asv-rear.jpg",
      "https://cdn.qep.example/asv-left.jpg",
    ]);
    expect(data.coverGalleryUnits[1]?.photos.map((asset) => asset.src)).toEqual([
      "https://cdn.qep.example/t770-front.jpg",
      "https://cdn.qep.example/t770-side.jpg",
    ]);
    const coverJson = JSON.stringify(data.coverGalleryUnits);
    expect(coverJson).not.toContain("asv-right.jpg");
    expect(coverJson).not.toContain("localhost");
    expect(coverJson).not.toContain("mulcher.jpg");
    expect(coverJson).not.toContain("trade-front.jpg");
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
        marketComps: [
          { source: "IronPlanet", price: 43000, low: 40000, high: 46000 },
          { source: "Ritchie Bros", price: 44500, detail: "COMPARABLE MARKET RANGE" },
          { source: "_aggregate", price: 45000, low: 38000, high: 52000, is_synthetic: true },
        ],
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
      "Condition note: Traded machine must match evaluated condition",
    ]));
    expect(JSON.stringify(tradeLine)).not.toContain("Preliminary value");
    expect(JSON.stringify(tradeLine)).not.toContain("Market midpoint");
    expect(JSON.stringify(tradeLine)).not.toContain("javascript:");
    expectNoCustomerTradeInternals(JSON.stringify(tradeLine));
    expectNoCustomerTradeInternals(JSON.stringify(data));
    expectNoCustomerTradeInternals(buildPrintableQuoteHtml(data));
  });

  test("filters internal trade valuation prose from customer copy", () => {
    const data = build({
      tradeAllowance: 40_200,
      tradeValuationId: "trade-789",
    }, [], {
      tradeValuation: {
        id: "trade-789",
        make: "Deere",
        model: "333G",
        year: 2021,
        serialNumber: "SN789",
        hours: 2400,
        photos: [{ type: "point_shoot", url: "https://cdn.qep.example/trade-front.jpg" }],
        marketComps: [{ source: "IronPlanet", price: 43000 }, { source: "_aggregate", price: 45000 }],
        auctionValue: 45_000,
        discountedValue: 41_400,
        reconditioningEstimate: null,
        preliminaryValue: 40_200,
        finalValue: null,
        conditionalLanguage: "NOT A GUARANTEED OFFER - Trade Range uses IronPlanet comps.",
        aiConditionNotes: "COMPARABLE MARKET RANGE from Ritchie Bros auction data.",
        operationalStatus: "daily_use",
      },
    });
    const tradeLine = data.lineItems.find((line) => line.lineType === "trade_allowance");
    const html = buildPrintableQuoteHtml(data);

    expect(tradeLine?.specBullets).toEqual(["Hours: 2,400"]);
    expect(tradeLine?.longDescription).toBe("Trade evidence captured for 2021 Deere 333G");
    expectNoCustomerTradeInternals(JSON.stringify(data), "trade-789");
    expectNoCustomerTradeInternals(html, "trade-789");
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
      {
        type: "finance",
        kind: "finance",
        label: "60 months",
        monthlyPayment: 2_050,
        termMonths: 60,
        rate: 7.25,
        totalCost: 123_000,
        lender: "Preferred lender",
        aprSource: { kind: "manufacturer_program", label: "Yanmar Spring APR", provider: "Yanmar", effectiveFrom: "2026-04-01" },
      },
      { type: "lease", kind: "lease_fmv", label: "FMV lease", monthlyPayment: 1_850, termMonths: 48, rate: 6.9, totalCost: 118_000, lender: "Lease partner" },
    ]);

    expect(data.compliance.selectedPaymentKind).toBe("finance");
    expect(data.compliance.primaryTotalLabel).toBe("Amount financed");
    expect(data.compliance.financingDisclaimer).toContain("Truth in Lending Act");
    expect(data.compliance.taxLabel).toBe("Tax override applied");
    expect(data.compliance.taxDetail).toContain("County cap confirmed by manager");
    expect(data.specialTerms).toBe("Subject to final freight confirmation.");
    expect(data.validUntil).toMatch(/2026|6/);
    expect(data.financing.find((scenario) => scenario.label === "60 months")?.aprSource?.label).toBe("Yanmar Spring APR");
  });

  test("filters disabled lease scenarios from customer proposal output", () => {
    const data = build({
      selectedFinanceScenario: "FMV lease",
    }, [
      { type: "cash", kind: "cash", label: "Cash", totalCost: 116_000 },
      { type: "finance", kind: "finance", label: "60 months", monthlyPayment: 2_050, termMonths: 60, rate: 7.25, totalCost: 123_000 },
      { type: "lease", kind: "lease_fmv", label: "FMV lease", monthlyPayment: 1_850, termMonths: 48, rate: 6.9, totalCost: 118_000 },
    ], { includeLeaseScenarios: false });

    expect(data.financing.map((scenario) => scenario.label)).toEqual(["Cash", "60 months"]);
    expect(data.selectedFinancingLabel).toBeNull();
    expect(data.compliance.selectedPaymentKind).toBe("unknown");
  });

  test("customer comparison toggle off renders only the selected scenario", () => {
    const data = build({
      selectedFinanceScenario: "60 months",
      showFinanceComparisonOnCustomerCopy: false,
    }, [
      { type: "cash", kind: "cash", label: "Cash", totalCost: 116_000 },
      { type: "finance", kind: "finance", label: "60 months", monthlyPayment: 2_050, termMonths: 60, rate: 7.25, totalCost: 123_000 },
      { type: "lease", kind: "lease_fmv", label: "FMV lease", monthlyPayment: 1_850, termMonths: 48, rate: 6.9, totalCost: 118_000 },
    ], { includeLeaseScenarios: true });

    expect(data.financeComparisonEnabled).toBe(false);
    expect(data.financing.map((scenario) => scenario.label)).toEqual(["60 months"]);
  });

  test("printable HTML renders the same safe proposal elements", () => {
    const data = build({
      whyThisMachine: "Confirmed customer-safe story.",
      whyThisMachineConfirmed: true,
      recommendation: { machine: "Bobcat T770", attachments: [], reasoning: "Unsafe AI reasoning." },
      selectedFinanceScenario: "60 months",
    }, [
      {
        type: "finance",
        kind: "finance",
        label: "60 months",
        monthlyPayment: 2_050,
        termMonths: 60,
        rate: 7.25,
        totalCost: 123_000,
        lender: "Preferred lender",
        aprSource: { kind: "manufacturer_program", label: "Yanmar Spring APR", provider: "Yanmar", effectiveFrom: "2026-04-01" },
      },
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
    expect(html).toContain("APR source: Yanmar Spring APR");
    expect(html).toContain("Cash / finance / lease comparison");
    expect(html).toContain("#F28A07");
    expect(html).toContain("QEP-2026-0001");
    expect(html).toContain("FMV lease");
  });

  test("printable HTML renders the cover equipment gallery when media is available", () => {
    const data = build({
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
          photo_url: "https://cdn.qep.example/asv-front.jpg",
          photo_urls: ["https://cdn.qep.example/asv-side.jpg", "https://cdn.qep.example/asv-cab.jpg"],
        },
      }],
    });
    const html = buildPrintableQuoteHtml(data);

    expect(html).toContain("cover-gallery");
    expect(html).toContain("cover-gallery-main");
    expect(html).toContain("cover-gallery-thumb");
    expect(html).toContain("https://cdn.qep.example/asv-front.jpg");
    expect(html).toContain("https://cdn.qep.example/asv-side.jpg");
    expect(html).toContain("https://cdn.qep.example/asv-cab.jpg");
    expect(html).toContain("Q003403");
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
    expectNoCustomerTradeInternals(JSON.stringify(data), "trade-456");
    expectNoCustomerTradeInternals(html, "trade-456");
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
      selectedFinanceScenario: "60 months",
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
    }, [
      {
        type: "finance",
        kind: "finance",
        label: "60 months",
        monthlyPayment: 2_050,
        termMonths: 60,
        rate: 7.25,
        totalCost: 123_000,
        lender: "Preferred lender",
        aprSource: { kind: "manufacturer_program", label: "Yanmar Spring APR", provider: "Yanmar", effectiveFrom: "2026-04-01" },
      },
    ]);
    const document = QuotePDFDocument({ data });
    const rendered = JSON.stringify(document);

    expect(document).toBeTruthy();
    expect(rendered).toContain("https://cdn.qep.example/asv-front.jpg");
    expect(rendered).toContain("https://cdn.qep.example/asv-side.jpg");
    expect(rendered).toContain("coverGalleryUnits");
    expect(rendered).toContain("Q003403");
    expect(rendered).toContain("Yanmar Spring APR");
    expect(rendered).toContain("financeComparisonEnabled");
    expect(rendered).toContain("/brand/qep/quote/qep-qr.png");
    expect(QEP_WEBSITE_QR_LABEL).toBe("Scan to visit QEP online");
    expect(rendered).not.toContain("Scan to review this proposal");
  });
});
