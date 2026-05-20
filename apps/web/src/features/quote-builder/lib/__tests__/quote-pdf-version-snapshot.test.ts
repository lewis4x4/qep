import { describe, expect, test } from "bun:test";

import type { QuotePDFData } from "../../components/QuotePDFDocument";
import { buildQuotePdfVersionSnapshot } from "../quote-pdf-version-snapshot";
import { diffQuotePdfVersionSnapshots } from "../../../../../../../shared/qep-moonshot-contracts";

function makePdfData(overrides: Partial<QuotePDFData> = {}): QuotePDFData {
  const base: QuotePDFData = {
    dealName: "Anderson Farms T770",
    customerName: "Anderson Farms",
    quoteNumber: "QEP-2026-0001",
    preparedBy: "QEP Sales Team",
    preparedDate: "5/20/2026",
    aiRecommendationSummary: null,
    equipment: [{ make: "Bobcat", model: "T770", year: 2026, price: 100_000, quantity: 1 }],
    attachments: [{ name: "Forestry mulcher", price: 10_000, quantity: 1 }],
    lineItems: [
      {
        diffKey: "internal-source-id-r2-key-dealer-cost-margin-123",
        lineType: "equipment",
        description: "2026 Bobcat T770",
        make: "Bobcat",
        model: "T770",
        year: 2026,
        quantity: 1,
        unitPrice: 100_000,
        extendedPrice: 100_000,
        displayAmount: 100_000,
        tone: "charge",
        stockNumber: "STK-100",
        serialNumber: "SN-100",
        media: {
          primaryPhoto: {
            src: "https://r2.example/private-bucket/workspaces/ws/quotes/qep/key.jpg",
            alt: "Private R2 photo",
          },
          gallery: [],
        },
        vendorLogo: {
          src: "https://r2.example/private-bucket/vendor-logo.png",
          alt: "Vendor logo",
        },
      },
      {
        diffKey: "attachment-line",
        lineType: "attachment",
        description: "Forestry mulcher",
        quantity: 1,
        unitPrice: 10_000,
        extendedPrice: 10_000,
        displayAmount: 10_000,
        tone: "charge",
      },
    ],
    coverGalleryUnits: [
      {
        title: "2026 Bobcat T770",
        meta: "Stock #: STK-100",
        photos: [{ src: "https://r2.example/private-bucket/cover.jpg", alt: "Cover" }],
      },
    ],
    brandAssets: {
      qepLogo: { src: "/brand/qep/logo.png", alt: "QEP" },
      vendorLogos: [{ src: "/brand/qep/vendor.png", alt: "Vendor" }],
      qrCode: { src: "/brand/qep/qr.png", alt: "QR" },
    },
    narrative: {
      text: "The T770 package matches your forestry cleanup plan.",
      confirmed: true,
      facts: [{ label: "Application", value: "Forestry cleanup" }],
      highlights: [{ quote: "", supports: "High-flow attachment fit" }],
      considerations: ["Delivery window"],
      alternative: null,
    },
    equipmentTotal: 100_000,
    attachmentTotal: 10_000,
    pricingLineTotal: 0,
    subtotal: 110_000,
    discountTotal: 0,
    tradeAllowance: 0,
    taxTotal: 6_600,
    customerTotal: 116_600,
    cashDown: 10_000,
    amountFinanced: 106_600,
    netTotal: 116_600,
    financing: [
      {
        type: "finance",
        kind: "finance",
        label: "60 months",
        termMonths: 60,
        rate: 5.9,
        monthlyPayment: 2059.22,
        totalCost: 123_553.20,
        lender: "QEP Finance",
        downPayment: 10_000,
        residualAmount: null,
        aprSource: {
          kind: "manufacturer_program",
          label: "Internal program label",
          provider: "OEM",
          programId: "program-source-id-123",
          disclosure: "Customer-safe disclosure",
        },
        isDefault: true,
      },
      {
        type: "cash",
        kind: "cash",
        label: "Hidden empty cash scenario",
        termMonths: null,
        rate: null,
        monthlyPayment: null,
        totalCost: 0,
        lender: null,
        downPayment: null,
        residualAmount: null,
        isDefault: false,
      },
      {
        type: "lease",
        kind: "lease_fmv",
        label: "FMV lease",
        termMonths: 48,
        rate: 7.1,
        monthlyPayment: 1890,
        totalCost: 90_720,
        lender: "QEP Leasing",
        downPayment: 5_000,
        residualAmount: 30_000,
        isDefault: false,
      },
      {
        type: "finance",
        kind: "finance",
        label: "72 months",
        termMonths: 72,
        rate: 6.3,
        monthlyPayment: 1810,
        totalCost: 130_320,
        lender: "QEP Finance",
        downPayment: 10_000,
        residualAmount: null,
        isDefault: false,
      },
      {
        type: "finance",
        kind: "finance",
        label: "84 months not rendered",
        termMonths: 84,
        rate: 6.8,
        monthlyPayment: 1650,
        totalCost: 138_600,
        lender: "QEP Finance",
        downPayment: 10_000,
        residualAmount: null,
        isDefault: false,
      },
    ],
    financeComparisonEnabled: true,
    selectedFinancingLabel: "60 months",
    primaryMachineTitle: "2026 Bobcat T770",
    deliveryEta: "2 weeks",
    depositRequiredAmount: 5_000,
    specialTerms: "Subject to final availability.",
    validUntil: "6/20/2026",
    compliance: {
      validUntil: "6/20/2026",
      specialTerms: "Subject to final availability.",
      taxLabel: "Estimated sales tax",
      taxDetail: "Standard taxable",
      financingDisclaimer: "Financing estimate only.",
      proposalDisclaimer: "Proposal estimate only.",
      selectedPaymentKind: "finance",
      primaryTotalLabel: "Customer total",
    },
    branch: {
      name: "Quality Equipment & Parts",
      address: "123 Main St",
      city: "Lake City",
      state: "FL",
      postalCode: "32025",
      phone: "386-555-0100",
      email: "sales@qep.example",
      website: "https://qep.example",
      footerText: "Valid 30 days.",
    },
  };

  return {
    ...base,
    ...overrides,
  };
}

describe("buildQuotePdfVersionSnapshot", () => {
  test("keeps only customer-safe semantic fields for PDF versioning", () => {
    const snapshot = buildQuotePdfVersionSnapshot(makePdfData(), {
      quotePackageId: "quote-package-1",
      quotePackageVersionId: "quote-version-1",
    });
    const json = JSON.stringify(snapshot);

    expect(snapshot.quotePackageId).toBe("quote-package-1");
    expect(snapshot.lineItems).toHaveLength(2);
    expect(snapshot.lineItems[0]).toMatchObject({
      lineType: "equipment",
      description: "2026 Bobcat T770",
      quantity: 1,
      unitPrice: 100_000,
    });
    expect(snapshot.financing[0]).toMatchObject({
      label: "60 months",
      monthlyPayment: 2059.22,
      lender: "QEP Finance",
    });
    expect(snapshot.financing.map((scenario) => scenario.label)).toEqual([
      "60 months",
      "FMV lease",
      "72 months",
    ]);

    expect(json).not.toContain("internal-source-id-r2-key-dealer-cost-margin-123");
    expect(json).not.toContain("program-source-id-123");
    expect(json).not.toContain("r2.example");
    expect(json).not.toContain("private-bucket");
    expect(json).not.toContain("primaryPhoto");
    expect(json).not.toContain("vendorLogo");
    expect(json).not.toContain("coverGalleryUnits");
    expect(json).not.toContain("brandAssets");
    expect(json).not.toContain("aprSource");
    expect(json).not.toContain("Hidden empty cash scenario");
    expect(json).not.toContain("84 months not rendered");
    expect(json).not.toContain("dealerCost");
    expect(json).not.toContain("margin");
    expect(json).not.toContain("sourceId");
  });

  test("guarantees unique persisted diff keys without leaking raw line identifiers", () => {
    const snapshot = buildQuotePdfVersionSnapshot(makePdfData({
      lineItems: [
        {
          diffKey: "same-source-line-id",
          lineType: "equipment",
          description: "2026 Bobcat T770",
          quantity: 1,
          unitPrice: 100_000,
          extendedPrice: 100_000,
          displayAmount: 100_000,
          tone: "charge",
        },
        {
          diffKey: "same-source-line-id",
          lineType: "equipment",
          description: "2026 Bobcat T770",
          quantity: 1,
          unitPrice: 100_000,
          extendedPrice: 100_000,
          displayAmount: 100_000,
          tone: "charge",
        },
      ],
    }));

    const keys = snapshot.lineItems.map((line) => line.diffKey);
    expect(new Set(keys).size).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("same-source-line-id");
  });

  test("semantic diff reports line, total, financing, terms, and narrative changes", () => {
    const before = buildQuotePdfVersionSnapshot(makePdfData());
    const after = buildQuotePdfVersionSnapshot(makePdfData({
      lineItems: [
        {
          diffKey: "internal-source-id-r2-key-dealer-cost-margin-123",
          lineType: "equipment",
          description: "2026 Bobcat T770",
          quantity: 1,
          unitPrice: 102_000,
          extendedPrice: 102_000,
          displayAmount: 102_000,
          tone: "charge",
        },
        {
          diffKey: "doc-fee",
          lineType: "doc_fee",
          description: "Documentation fee",
          quantity: 1,
          unitPrice: 199,
          extendedPrice: 199,
          displayAmount: 199,
          tone: "charge",
        },
      ],
      equipmentTotal: 102_000,
      attachmentTotal: 0,
      pricingLineTotal: 199,
      subtotal: 102_199,
      taxTotal: 6_731.94,
      customerTotal: 108_930.94,
      amountFinanced: 98_930.94,
      netTotal: 108_930.94,
      financing: [
        {
          type: "finance",
          kind: "finance",
          label: "60 months",
          termMonths: 60,
          rate: 6.4,
          monthlyPayment: 2119.5,
          totalCost: 127_170,
          lender: "QEP Finance",
          downPayment: 10_000,
          residualAmount: null,
          isDefault: true,
        },
      ],
      specialTerms: "Subject to manager-confirmed availability.",
      narrative: {
        ...makePdfData().narrative,
        text: "The T770 package matches your forestry cleanup and delivery window.",
      },
    }));

    const diff = diffQuotePdfVersionSnapshots(before, after, {
      fromVersionNumber: 1,
      toVersionNumber: 2,
    });

    expect(diff.fromVersionNumber).toBe(1);
    expect(diff.toVersionNumber).toBe(2);
    expect(diff.lineDiffs.map((item) => item.status).sort()).toEqual(["added", "changed", "removed"]);
    expect(diff.lineDiffs.find((item) => item.status === "changed")?.changedFields).toEqual([
      "unitPrice",
      "extendedPrice",
      "displayAmount",
    ]);
    expect(diff.totalDiffs.map((item) => item.field)).toContain("customerTotal");
    expect(diff.financingDiffs[0]).toMatchObject({
      label: "60 months",
      status: "changed",
      changedFields: ["rate", "monthlyPayment", "totalCost"],
    });
    expect(diff.termDiffs).toContainEqual({
      field: "specialTerms",
      before: "Subject to final availability.",
      after: "Subject to manager-confirmed availability.",
    });
    expect(diff.narrativeChanged).toBe(true);
  });
});
