/**
 * QEP Pricing Engine — Calculator unit tests
 *
 * Slice 02: one fixture (Yanmar ViO55 48mo 0%). Others added in Slice 02 Checkpoint C.
 * Run: bun test src/lib/pricing/__tests__/calculator.test.ts
 */

import { describe, expect, it } from "bun:test";
import { calculateQuote } from "../calculator";
import {
  REQUEST,
  CTX,
  EXPECTED,
} from "./fixtures/yanmar_vio55_48mo_0pct";

describe("Yanmar ViO55 Cab — 48mo 0% financing (Fixture 1)", () => {
  const result = calculateQuote(REQUEST, CTX);

  // ── Equipment breakdown ────────────────────────────────────────────────────
  describe("equipment breakdown", () => {
    it("list price", () => {
      expect(result.breakdown.listPriceCents).toBe(EXPECTED.breakdown.listPriceCents);
    });
    it("dealer discount (30%)", () => {
      expect(result.breakdown.dealerDiscountCents).toBe(EXPECTED.breakdown.dealerDiscountCents);
      expect(result.breakdown.dealerDiscountPct).toBe(EXPECTED.breakdown.dealerDiscountPct);
    });
    it("discounted price", () => {
      expect(result.breakdown.discountedPriceCents).toBe(EXPECTED.breakdown.discountedPriceCents);
    });
    it("PDI ($500)", () => {
      expect(result.breakdown.pdiCents).toBe(EXPECTED.breakdown.pdiCents);
    });
    it("good faith (1% of discounted)", () => {
      expect(result.breakdown.goodFaithCents).toBe(EXPECTED.breakdown.goodFaithCents);
      expect(result.breakdown.goodFaithPct).toBe(EXPECTED.breakdown.goodFaithPct);
    });
    it("freight (FL large)", () => {
      expect(result.breakdown.freightCents).toBe(EXPECTED.breakdown.freightCents);
      expect(result.breakdown.freightZone).toBe(EXPECTED.breakdown.freightZone);
    });
    it("tariff (5% of list)", () => {
      expect(result.breakdown.tariffCents).toBe(EXPECTED.breakdown.tariffCents);
      expect(result.breakdown.tariffPct).toBe(EXPECTED.breakdown.tariffPct);
    });
    it("equipment cost total", () => {
      expect(result.breakdown.equipmentCostCents).toBe(EXPECTED.breakdown.equipmentCostCents);
    });
    it("markup (12%)", () => {
      expect(result.breakdown.markupPct).toBe(EXPECTED.breakdown.markupPct);
      expect(result.breakdown.markupCents).toBe(EXPECTED.breakdown.markupCents);
    });
    it("baseline sales price", () => {
      expect(result.breakdown.baselineSalesPriceCents).toBe(EXPECTED.breakdown.baselineSalesPriceCents);
    });
  });

  // ── Attachments ────────────────────────────────────────────────────────────
  describe("attachments", () => {
    it("produces exactly 3 attachments", () => {
      expect(result.attachments).toHaveLength(3);
    });

    for (const [i, exp] of EXPECTED.attachments.entries()) {
      it(`attachment[${i}] (${exp.attachmentId}) — cost, markup, sales`, () => {
        const att = result.attachments[i];
        expect(att.attachmentId).toBe(exp.attachmentId);
        expect(att.listPriceCents).toBe(exp.listPriceCents);
        expect(att.discountCents).toBe(exp.discountCents);
        expect(att.costCents).toBe(exp.costCents);
        expect(att.markupPct).toBe(exp.markupPct);
        expect(att.markupCents).toBe(exp.markupCents);
        expect(att.salesPriceCents).toBe(exp.salesPriceCents);
        expect(att.oemBranded).toBe(exp.oemBranded);
      });
    }

    it("attachment subtotals", () => {
      expect(result.attachmentsSubtotal.totalListCents).toBe(EXPECTED.attachmentsSubtotal.totalListCents);
      expect(result.attachmentsSubtotal.totalCostCents).toBe(EXPECTED.attachmentsSubtotal.totalCostCents);
      expect(result.attachmentsSubtotal.totalSalesPriceCents).toBe(EXPECTED.attachmentsSubtotal.totalSalesPriceCents);
    });
  });

  // ── Financing ──────────────────────────────────────────────────────────────
  describe("financing scenario (0% / 48mo)", () => {
    it("scenario exists", () => {
      expect(result.financingScenario).toBeDefined();
    });
    it("program id", () => {
      expect(result.financingScenario!.programId).toBe(EXPECTED.financingScenario.programId);
    });
    it("lender name", () => {
      expect(result.financingScenario!.lenderName).toBe(EXPECTED.financingScenario.lenderName);
    });
    it("term months", () => {
      expect(result.financingScenario!.termMonths).toBe(EXPECTED.financingScenario.termMonths);
    });
    it("rate 0%", () => {
      expect(result.financingScenario!.ratePct).toBe(EXPECTED.financingScenario.ratePct);
    });
    it("monthly payment (Math.round(9_016_784/48) = 187_850)", () => {
      expect(result.financingScenario!.paymentCents).toBe(EXPECTED.financingScenario.paymentCents);
    });
    it("total financed", () => {
      expect(result.financingScenario!.totalFinancedCents).toBe(EXPECTED.financingScenario.totalFinancedCents);
    });
    it("dealer participation 0", () => {
      expect(result.financingScenario!.dealerParticipationCostCents).toBe(
        EXPECTED.financingScenario.dealerParticipationCostCents,
      );
    });
  });

  // ── Customer totals ────────────────────────────────────────────────────────
  describe("customer totals", () => {
    it("customerSubtotalCents", () => {
      expect(result.customerSubtotalCents).toBe(EXPECTED.customerSubtotalCents);
    });
    it("no rebates (no CIL)", () => {
      expect(result.customerRebatesCents).toBe(EXPECTED.customerRebatesCents);
    });
    it("customerPriceAfterRebatesCents", () => {
      expect(result.customerPriceAfterRebatesCents).toBe(EXPECTED.customerPriceAfterRebatesCents);
    });
    it("no trade-in", () => {
      expect(result.customerTradeInAllowanceCents).toBe(EXPECTED.customerTradeInAllowanceCents);
    });
    it("tax (7% FL)", () => {
      expect(result.taxRatePct).toBe(EXPECTED.taxRatePct);
      expect(result.taxCents).toBe(EXPECTED.taxCents);
    });
    it("doc fee $400", () => {
      expect(result.docFeeCents).toBe(EXPECTED.docFeeCents);
    });
    it("customerTotalCents", () => {
      expect(result.customerTotalCents).toBe(EXPECTED.customerTotalCents);
    });
  });

  // ── Margin ─────────────────────────────────────────────────────────────────
  describe("margin", () => {
    it("dealerCostTotalCents", () => {
      expect(result.dealerCostTotalCents).toBe(EXPECTED.dealerCostTotalCents);
    });
    it("dealerRevenueCents", () => {
      expect(result.dealerRevenueCents).toBe(EXPECTED.dealerRevenueCents);
    });
    it("grossMarginCents", () => {
      expect(result.grossMarginCents).toBe(EXPECTED.grossMarginCents);
    });
    it("grossMarginPct (approx)", () => {
      expect(result.grossMarginPct).toBeCloseTo(EXPECTED.grossMarginPctApprox, 3);
    });
    it("markupAchievedPct (approx)", () => {
      expect(result.markupAchievedPct).toBeCloseTo(EXPECTED.markupAchievedPctApprox, 3);
    });
    it("commission = Math.floor(grossMargin * 0.15)", () => {
      expect(result.commissionCents).toBe(EXPECTED.commissionCents);
    });
    it("commission invariant: equals Math.floor(grossMargin * 0.15)", () => {
      expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15));
    });
  });

  // ── Approval ───────────────────────────────────────────────────────────────
  describe("approval", () => {
    it("no approval required (12.57% > 10% floor)", () => {
      expect(result.requiresApproval).toBe(EXPECTED.requiresApproval);
    });
    it("empty approval reasons", () => {
      expect(result.approvalReasons).toEqual(EXPECTED.approvalReasons);
    });
    it("no stacking warnings", () => {
      expect(result.programStackingWarnings).toEqual(EXPECTED.programStackingWarnings);
    });
  });

  // ── Invariants ─────────────────────────────────────────────────────────────
  describe("engine invariants", () => {
    it("no floats anywhere in pricing path (all values integer cents)", () => {
      const intFields = [
        result.breakdown.listPriceCents,
        result.breakdown.dealerDiscountCents,
        result.breakdown.discountedPriceCents,
        result.breakdown.pdiCents,
        result.breakdown.goodFaithCents,
        result.breakdown.freightCents,
        result.breakdown.tariffCents,
        result.breakdown.equipmentCostCents,
        result.breakdown.markupCents,
        result.breakdown.baselineSalesPriceCents,
        result.customerTotalCents,
        result.dealerCostTotalCents,
        result.grossMarginCents,
        result.commissionCents,
      ];
      for (const v of intFields) {
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it("customerTotal >= dealerCost (no approval-free underwater deal)", () => {
      if (!result.requiresApproval) {
        expect(result.customerTotalCents).toBeGreaterThanOrEqual(result.dealerCostTotalCents);
      }
    });

    it("engineVersion is set", () => {
      expect(result.engineVersion).toBe("qep-pricing-engine@1.0.0");
    });

    it("computedAt is an ISO timestamp", () => {
      expect(() => new Date(result.computedAt)).not.toThrow();
      expect(new Date(result.computedAt).toISOString()).toBe(result.computedAt);
    });
  });
});
