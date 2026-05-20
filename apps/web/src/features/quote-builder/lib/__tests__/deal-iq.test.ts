import { describe, expect, test } from "bun:test";

import { computeDealIqSummary, type DealIqComputedInput, type DealIqPolicyInput } from "../deal-iq";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function draft(overrides: Partial<QuoteWorkspaceDraft> = {}): Partial<QuoteWorkspaceDraft> & Pick<QuoteWorkspaceDraft, "tradeAllowance"> {
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
    customerSignals: {
      openDeals: 2,
      openDealValueCents: 150_000_00,
      lastContactDaysAgo: 10,
      pastQuoteCount: 3,
      pastQuoteValueCents: 300_000_00,
    },
    customerWarmth: "warm",
    ...overrides,
  };
}

function computed(overrides: Partial<DealIqComputedInput> = {}): DealIqComputedInput {
  return {
    subtotal: 100_000,
    discountTotal: 5_000,
    netTotal: 90_000,
    marginAmount: 20_000,
    marginPct: 20,
    ...overrides,
  };
}

function policy(overrides: Partial<DealIqPolicyInput> = {}): DealIqPolicyInput {
  return {
    standardMarginFloorPct: 15,
    tradeCreditMax: 30_000,
    repDiscountMaxPct: 7,
    ...overrides,
  };
}

describe("computeDealIqSummary", () => {
  test("flags margin below floor with commission review status", () => {
    const summary = computeDealIqSummary({
      draft: draft(),
      computed: computed({ marginPct: 9.5, marginAmount: 9_500 }),
      policy: policy({ standardMarginFloorPct: 12 }),
      maxRisks: 3,
    });

    expect(summary.marginPctLabel).toBe("9.5%");
    expect(summary.marginAmountLabel).toBe("$9,500");
    expect(summary.floorPct).toBe(12);
    expect(summary.risks[0]).toMatchObject({
      id: "margin_below_floor",
      severity: "critical",
      source: "governance",
    });
    expect(summary.commissionStatus.status).toBe("review_required");
  });

  test("flags trade allowance above policy cap", () => {
    const summary = computeDealIqSummary({
      draft: draft({ tradeAllowance: 42_000 }),
      computed: computed(),
      policy: policy({ tradeCreditMax: 35_000 }),
    });

    expect(summary.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "trade_above_max", label: "Trade above max" }),
    ]));
  });

  test("flags discount above rep cap", () => {
    const summary = computeDealIqSummary({
      draft: draft(),
      computed: computed({ subtotal: 100_000, discountTotal: 12_500 }),
      policy: policy({ repDiscountMaxPct: 10 }),
    });

    expect(summary.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "discount_above_cap", label: "Discount above cap" }),
    ]));
  });

  test("does not divide discount cap when subtotal is zero", () => {
    const summary = computeDealIqSummary({
      draft: draft(),
      computed: computed({ subtotal: 0, discountTotal: 1_000, netTotal: 0, marginAmount: 0, marginPct: 0 }),
      policy: policy({ standardMarginFloorPct: 0, repDiscountMaxPct: 0 }),
    });

    expect(summary.floorPct).toBe(10);
    expect(summary.risks.some((risk) => risk.id === "discount_above_cap")).toBe(false);
    expect(summary.commissionStatus.status).toBe("not_ready");
  });

  test("keeps commission honest and status-only when no plan feed exists", () => {
    const summary = computeDealIqSummary({
      draft: draft(),
      computed: computed({ marginPct: 22, marginAmount: 22_000 }),
      policy: policy({ standardMarginFloorPct: 12 }),
    });

    expect(summary.commissionStatus).toMatchObject({
      status: "ready",
      label: "Status only",
    });
    expect(summary.commissionStatus.detail).toContain("No commission-dollar plan feed");
  });

  test("blocks commission status for zero or negative margin", () => {
    const summary = computeDealIqSummary({
      draft: draft(),
      computed: computed({ marginPct: -2, marginAmount: -2_000 }),
      policy: policy({ standardMarginFloorPct: 0 }),
    });

    expect(summary.commissionStatus.status).toBe("blocked");
  });

  test("includes win probability score and assumption risks after governance risks", () => {
    const summary = computeDealIqSummary({
      draft: draft({ tradeAllowance: 20_000 }),
      computed: computed({ marginPct: 25, marginAmount: 25_000 }),
      policy: policy({ standardMarginFloorPct: 10 }),
      marginBaselineMedianPct: 15,
    });

    expect(summary.winProbabilityScore).toBeGreaterThan(0);
    expect(["strong", "healthy", "mixed", "at_risk"]).toContain(summary.winProbabilityBand);
    expect(summary.winProbabilityHeadline).toBeTruthy();
    expect(summary.risks.some((risk) => risk.source === "win_probability")).toBe(true);
  });

  test("falls back to the default margin floor when policy is unavailable", () => {
    const summary = computeDealIqSummary({
      draft: draft(),
      computed: computed({ marginPct: 9, marginAmount: 9_000 }),
      policy: null,
    });

    expect(summary.policyCapsAvailable).toBe(false);
    expect(summary.floorPct).toBe(10);
    expect(summary.risks[0]?.id).toBe("margin_below_floor");
  });
});
