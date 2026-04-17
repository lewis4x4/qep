/**
 * QEP Pricing Engine — Calculator unit tests
 *
 * Slice 02: 6 fixtures covering the full pricing matrix.
 * Run: bun test src/lib/pricing/__tests__/calculator.test.ts
 *
 * Fixture 1: Yanmar ViO55 Cab — 48mo 0% financing (standard, no override)
 * Fixture 2: ASV RT-135       — GMU customer pricing tier (8% off list)
 * Fixture 3: Develon DX225    — Cash-In-Lieu $7,500 (markup below floor → approval)
 * Fixture 4: Bandit chipper   — 14% override below 15% forestry floor (2 approvals)
 * Fixture 5: Yanmar ViO55     — non-OEM attachment financing cap exceeded
 * Fixture 6: Yanmar ViO55     — 7% override below 10% floor (2 approvals)
 */

import { describe, expect, it } from "bun:test";
import { calculateQuote } from "../calculator";
import {
  REQUEST as REQ1,
  CTX as CTX1,
  EXPECTED as EXP1,
} from "./fixtures/yanmar_vio55_48mo_0pct";
import {
  REQUEST as REQ2,
  CTX as CTX2,
  EXPECTED as EXP2,
} from "./fixtures/asv_rt135_gmu";
import {
  REQUEST as REQ3,
  CTX as CTX3,
  EXPECTED as EXP3,
} from "./fixtures/develon_dx225_cil";
import {
  REQUEST as REQ4,
  CTX as CTX4,
  EXPECTED as EXP4,
} from "./fixtures/forestry_bandit_no_programs";
import {
  REQUEST as REQ5,
  CTX as CTX5,
  EXPECTED as EXP5,
} from "./fixtures/third_party_attachment_roll_in";
import {
  REQUEST as REQ6,
  CTX as CTX6,
  EXPECTED as EXP6,
} from "./fixtures/markup_override_approval";

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURE 1: Yanmar ViO55 Cab — 48mo 0% financing
// ═════════════════════════════════════════════════════════════════════════════

describe("Fixture 1 — Yanmar ViO55 Cab: 48mo 0% financing", () => {
  const result = calculateQuote(REQ1, CTX1);

  describe("equipment breakdown", () => {
    it("list price", () => {
      expect(result.breakdown.listPriceCents).toBe(EXP1.breakdown.listPriceCents);
    });
    it("dealer discount (30%)", () => {
      expect(result.breakdown.dealerDiscountCents).toBe(EXP1.breakdown.dealerDiscountCents);
      expect(result.breakdown.dealerDiscountPct).toBe(EXP1.breakdown.dealerDiscountPct);
    });
    it("discounted price", () => {
      expect(result.breakdown.discountedPriceCents).toBe(EXP1.breakdown.discountedPriceCents);
    });
    it("PDI ($500)", () => {
      expect(result.breakdown.pdiCents).toBe(EXP1.breakdown.pdiCents);
    });
    it("good faith (1% of discounted)", () => {
      expect(result.breakdown.goodFaithCents).toBe(EXP1.breakdown.goodFaithCents);
      expect(result.breakdown.goodFaithPct).toBe(EXP1.breakdown.goodFaithPct);
    });
    it("freight (FL large)", () => {
      expect(result.breakdown.freightCents).toBe(EXP1.breakdown.freightCents);
      expect(result.breakdown.freightZone).toBe(EXP1.breakdown.freightZone);
    });
    it("tariff (5% of list)", () => {
      expect(result.breakdown.tariffCents).toBe(EXP1.breakdown.tariffCents);
      expect(result.breakdown.tariffPct).toBe(EXP1.breakdown.tariffPct);
    });
    it("equipment cost total", () => {
      expect(result.breakdown.equipmentCostCents).toBe(EXP1.breakdown.equipmentCostCents);
    });
    it("markup (12%)", () => {
      expect(result.breakdown.markupPct).toBe(EXP1.breakdown.markupPct);
      expect(result.breakdown.markupCents).toBe(EXP1.breakdown.markupCents);
    });
    it("baseline sales price", () => {
      expect(result.breakdown.baselineSalesPriceCents).toBe(EXP1.breakdown.baselineSalesPriceCents);
    });
  });

  describe("attachments", () => {
    it("produces exactly 3 attachments", () => {
      expect(result.attachments).toHaveLength(3);
    });

    for (const [i, exp] of EXP1.attachments.entries()) {
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
      expect(result.attachmentsSubtotal.totalListCents).toBe(EXP1.attachmentsSubtotal.totalListCents);
      expect(result.attachmentsSubtotal.totalCostCents).toBe(EXP1.attachmentsSubtotal.totalCostCents);
      expect(result.attachmentsSubtotal.totalSalesPriceCents).toBe(EXP1.attachmentsSubtotal.totalSalesPriceCents);
    });
  });

  describe("financing scenario (0% / 48mo)", () => {
    it("scenario exists", () => expect(result.financingScenario).toBeDefined());
    it("program id", () => expect(result.financingScenario!.programId).toBe(EXP1.financingScenario.programId));
    it("lender name", () => expect(result.financingScenario!.lenderName).toBe(EXP1.financingScenario.lenderName));
    it("term months", () => expect(result.financingScenario!.termMonths).toBe(EXP1.financingScenario.termMonths));
    it("rate 0%", () => expect(result.financingScenario!.ratePct).toBe(EXP1.financingScenario.ratePct));
    it("monthly payment", () => expect(result.financingScenario!.paymentCents).toBe(EXP1.financingScenario.paymentCents));
    it("total financed", () => expect(result.financingScenario!.totalFinancedCents).toBe(EXP1.financingScenario.totalFinancedCents));
    it("dealer participation 0", () => expect(result.financingScenario!.dealerParticipationCostCents).toBe(EXP1.financingScenario.dealerParticipationCostCents));
  });

  describe("customer totals", () => {
    it("customerSubtotalCents", () => expect(result.customerSubtotalCents).toBe(EXP1.customerSubtotalCents));
    it("no rebates", () => expect(result.customerRebatesCents).toBe(EXP1.customerRebatesCents));
    it("customerPriceAfterRebatesCents", () => expect(result.customerPriceAfterRebatesCents).toBe(EXP1.customerPriceAfterRebatesCents));
    it("no trade-in", () => expect(result.customerTradeInAllowanceCents).toBe(EXP1.customerTradeInAllowanceCents));
    it("tax (7% FL)", () => {
      expect(result.taxRatePct).toBe(EXP1.taxRatePct);
      expect(result.taxCents).toBe(EXP1.taxCents);
    });
    it("doc fee $400", () => expect(result.docFeeCents).toBe(EXP1.docFeeCents));
    it("customerTotalCents", () => expect(result.customerTotalCents).toBe(EXP1.customerTotalCents));
  });

  describe("margin", () => {
    it("dealerCostTotalCents", () => expect(result.dealerCostTotalCents).toBe(EXP1.dealerCostTotalCents));
    it("dealerRevenueCents", () => expect(result.dealerRevenueCents).toBe(EXP1.dealerRevenueCents));
    it("grossMarginCents", () => expect(result.grossMarginCents).toBe(EXP1.grossMarginCents));
    it("grossMarginPct (approx)", () => expect(result.grossMarginPct).toBeCloseTo(EXP1.grossMarginPctApprox, 3));
    it("markupAchievedPct (approx)", () => expect(result.markupAchievedPct).toBeCloseTo(EXP1.markupAchievedPctApprox, 3));
    it("commissionCents", () => expect(result.commissionCents).toBe(EXP1.commissionCents));
    it("commission invariant: Math.floor(grossMargin × 0.15)", () => {
      expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15));
    });
  });

  describe("approval", () => {
    it("no approval required", () => expect(result.requiresApproval).toBe(EXP1.requiresApproval));
    it("empty approval reasons", () => expect(result.approvalReasons).toEqual(EXP1.approvalReasons));
    it("no stacking warnings", () => expect(result.programStackingWarnings).toEqual(EXP1.programStackingWarnings));
  });

  describe("engine invariants", () => {
    it("all pricing fields are integers", () => {
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
    it("engineVersion is set", () => expect(result.engineVersion).toBe("qep-pricing-engine@1.0.0"));
    it("computedAt is an ISO timestamp", () => {
      expect(() => new Date(result.computedAt)).not.toThrow();
      expect(new Date(result.computedAt).toISOString()).toBe(result.computedAt);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURE 2: ASV RT-135 — GMU customer (8% off list)
// ═════════════════════════════════════════════════════════════════════════════

describe("Fixture 2 — ASV RT-135: GMU customer pricing", () => {
  const result = calculateQuote(REQ2, CTX2);

  describe("equipment breakdown (GMU path)", () => {
    it("list price", () => expect(result.breakdown.listPriceCents).toBe(EXP2.breakdown.listPriceCents));
    it("dealer discount (30%)", () => {
      expect(result.breakdown.dealerDiscountCents).toBe(EXP2.breakdown.dealerDiscountCents);
    });
    it("equipment cost (cost chain runs normally)", () => {
      expect(result.breakdown.equipmentCostCents).toBe(EXP2.breakdown.equipmentCostCents);
    });
    it("GMU baseline = list × 0.92 = 7_820_000", () => {
      expect(result.breakdown.baselineSalesPriceCents).toBe(EXP2.breakdown.baselineSalesPriceCents);
    });
    it("GMU implied markup cents = gmuPrice − equipmentCost", () => {
      expect(result.breakdown.markupCents).toBe(EXP2.breakdown.markupCents);
    });
    it("GMU implied markupPct ≈ 17.09%", () => {
      // 1_141_300 / 6_678_700 — float, not a round number
      expect(result.breakdown.markupPct).toBeCloseTo(EXP2.breakdown.markupCents / EXP2.breakdown.equipmentCostCents, 4);
    });
  });

  describe("customer totals", () => {
    it("customerSubtotalCents = GMU price", () => expect(result.customerSubtotalCents).toBe(EXP2.customerSubtotalCents));
    it("no rebates", () => expect(result.customerRebatesCents).toBe(EXP2.customerRebatesCents));
    it("tax (7% of GMU price)", () => expect(result.taxCents).toBe(EXP2.taxCents));
    it("customerTotalCents", () => expect(result.customerTotalCents).toBe(EXP2.customerTotalCents));
  });

  describe("margin", () => {
    it("dealerCostTotalCents", () => expect(result.dealerCostTotalCents).toBe(EXP2.dealerCostTotalCents));
    it("grossMarginCents", () => expect(result.grossMarginCents).toBe(EXP2.grossMarginCents));
    it("grossMarginPct (approx)", () => expect(result.grossMarginPct).toBeCloseTo(EXP2.grossMarginPctApprox, 3));
    it("markupAchievedPct (approx) ≈ 17.09%", () => expect(result.markupAchievedPct).toBeCloseTo(EXP2.markupAchievedPctApprox, 3));
    it("commissionCents", () => expect(result.commissionCents).toBe(EXP2.commissionCents));
    it("commission invariant", () => expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15)));
  });

  describe("approval", () => {
    it("no approval (GMU implied markup > 10% floor)", () => expect(result.requiresApproval).toBe(EXP2.requiresApproval));
    it("no stacking warnings", () => expect(result.programStackingWarnings).toEqual(EXP2.programStackingWarnings));
    it("GMU eligibility note present", () => {
      expect(result.programEligibilityNotes.length).toBeGreaterThanOrEqual(EXP2.programEligibilityNotesMinLength);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURE 3: Develon DX225 — CIL $7,500 (markup below floor → approval)
// ═════════════════════════════════════════════════════════════════════════════

describe("Fixture 3 — Develon DX225: CIL $7,500 (approval required)", () => {
  const result = calculateQuote(REQ3, CTX3);

  describe("equipment breakdown", () => {
    it("list price", () => expect(result.breakdown.listPriceCents).toBe(EXP3.breakdown.listPriceCents));
    it("equipment cost", () => expect(result.breakdown.equipmentCostCents).toBe(EXP3.breakdown.equipmentCostCents));
    it("markup (12% target)", () => {
      expect(result.breakdown.markupPct).toBe(EXP3.breakdown.markupPct);
      expect(result.breakdown.markupCents).toBe(EXP3.breakdown.markupCents);
    });
    it("baseline sales price", () => expect(result.breakdown.baselineSalesPriceCents).toBe(EXP3.breakdown.baselineSalesPriceCents));
  });

  describe("CIL program", () => {
    it("exactly 1 program applied", () => expect(result.programs).toHaveLength(1));
    it("program type is cash_in_lieu", () => expect(result.programs[0]!.programType).toBe("cash_in_lieu"));
    it("rebate amount = $7,500", () => expect(result.programs[0]!.amountCents).toBe(EXP3.customerRebatesCents));
  });

  describe("customer totals", () => {
    it("CIL rebate applied", () => expect(result.customerRebatesCents).toBe(EXP3.customerRebatesCents));
    it("customerPriceAfterRebatesCents", () => expect(result.customerPriceAfterRebatesCents).toBe(EXP3.customerPriceAfterRebatesCents));
    it("tax applied on post-rebate price", () => expect(result.taxCents).toBe(EXP3.taxCents));
    it("customerTotalCents", () => expect(result.customerTotalCents).toBe(EXP3.customerTotalCents));
  });

  describe("margin and approval", () => {
    it("grossMarginCents", () => expect(result.grossMarginCents).toBe(EXP3.grossMarginCents));
    it("markupAchievedPct ≈ 9.19% (below 10% floor)", () => {
      expect(result.markupAchievedPct).toBeCloseTo(EXP3.markupAchievedPctApprox, 3);
    });
    it("commissionCents", () => expect(result.commissionCents).toBe(EXP3.commissionCents));
    it("commission invariant", () => expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15)));
    it("requiresApproval = true (CIL erodes markup below floor)", () => {
      expect(result.requiresApproval).toBe(EXP3.requiresApproval);
    });
    it("exactly 1 approval reason (below floor)", () => {
      expect(result.approvalReasons).toHaveLength(EXP3.approvalReasonsLength);
    });
    it("approval reason mentions markup", () => {
      expect(result.approvalReasons[0]).toMatch(/[Mm]arkup/);
    });
    it("no stacking warnings (CIL only)", () => {
      expect(result.programStackingWarnings).toEqual(EXP3.programStackingWarnings);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURE 4: Bandit chipper — 14% override, 15% forestry floor (2 approvals)
// ═════════════════════════════════════════════════════════════════════════════

describe("Fixture 4 — Bandit chipper: markup override below forestry floor", () => {
  const result = calculateQuote(REQ4, CTX4);

  describe("equipment breakdown", () => {
    it("equipment cost", () => expect(result.breakdown.equipmentCostCents).toBe(EXP4.breakdown.equipmentCostCents));
    it("markup override applied (14%)", () => {
      expect(result.breakdown.markupPct).toBe(EXP4.breakdown.markupPct);
      expect(result.breakdown.markupCents).toBe(EXP4.breakdown.markupCents);
    });
    it("baseline sales price", () => expect(result.breakdown.baselineSalesPriceCents).toBe(EXP4.breakdown.baselineSalesPriceCents));
  });

  describe("customer totals", () => {
    it("no programs — subtotal = baseline", () => expect(result.customerSubtotalCents).toBe(EXP4.customerSubtotalCents));
    it("taxCents", () => expect(result.taxCents).toBe(EXP4.taxCents));
    it("customerTotalCents", () => expect(result.customerTotalCents).toBe(EXP4.customerTotalCents));
  });

  describe("margin and dual approval", () => {
    it("grossMarginCents", () => expect(result.grossMarginCents).toBe(EXP4.grossMarginCents));
    it("markupAchievedPct = 14.0%", () => expect(result.markupAchievedPct).toBeCloseTo(EXP4.markupAchievedPctApprox, 3));
    it("commissionCents", () => expect(result.commissionCents).toBe(EXP4.commissionCents));
    it("commission invariant", () => expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15)));
    it("requiresApproval = true", () => expect(result.requiresApproval).toBe(EXP4.requiresApproval));
    it("exactly 2 approval reasons", () => expect(result.approvalReasons).toHaveLength(EXP4.approvalReasonsLength));
    it("reason 1: below forestry floor (15%)", () => {
      expect(result.approvalReasons[0]).toMatch(/15%.*floor/i);
    });
    it("reason 2: override present", () => {
      expect(result.approvalReasons[1]).toMatch(/overrode/i);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURE 5: Yanmar ViO55 — non-OEM attachment cap exceeded
// ═════════════════════════════════════════════════════════════════════════════

describe("Fixture 5 — Yanmar ViO55: non-OEM attachment financing cap exceeded", () => {
  const result = calculateQuote(REQ5, CTX5);

  describe("equipment breakdown", () => {
    it("equipment cost (same as Fixture 1)", () => {
      expect(result.breakdown.equipmentCostCents).toBe(EXP5.breakdown.equipmentCostCents);
    });
    it("baseline sales price (same as Fixture 1)", () => {
      expect(result.breakdown.baselineSalesPriceCents).toBe(EXP5.breakdown.baselineSalesPriceCents);
    });
  });

  describe("non-OEM attachment", () => {
    it("exactly 1 attachment (custom non-OEM)", () => expect(result.attachments).toHaveLength(1));
    it("attachmentId is null (custom)", () => expect(result.attachments[0]!.attachmentId).toBeNull());
    it("cost = 1_500_000", () => expect(result.attachments[0]!.costCents).toBe(EXP5.attachments[0]!.costCents));
    it("markup 20%", () => expect(result.attachments[0]!.markupPct).toBe(EXP5.attachments[0]!.markupPct));
    it("sales = 1_800_000", () => expect(result.attachments[0]!.salesPriceCents).toBe(EXP5.attachments[0]!.salesPriceCents));
    it("oemBranded = false", () => expect(result.attachments[0]!.oemBranded).toBe(false));
    it("attachment subtotals", () => {
      expect(result.attachmentsSubtotal.totalCostCents).toBe(EXP5.attachmentsSubtotal.totalCostCents);
      expect(result.attachmentsSubtotal.totalSalesPriceCents).toBe(EXP5.attachmentsSubtotal.totalSalesPriceCents);
    });
  });

  describe("financing (capped at machine list)", () => {
    it("scenario exists", () => expect(result.financingScenario).toBeDefined());
    it("totalFinancedCents = 9_500_000 (machine list, capped)", () => {
      expect(result.financingScenario!.totalFinancedCents).toBe(EXP5.financingScenario.totalFinancedCents);
    });
    it("paymentCents = Math.round(9_500_000 / 48) = 197_917", () => {
      expect(result.financingScenario!.paymentCents).toBe(EXP5.financingScenario.paymentCents);
    });
  });

  describe("customer totals", () => {
    it("customerSubtotalCents includes non-OEM sales", () => {
      expect(result.customerSubtotalCents).toBe(EXP5.customerSubtotalCents);
    });
    it("taxCents", () => expect(result.taxCents).toBe(EXP5.taxCents));
    it("customerTotalCents", () => expect(result.customerTotalCents).toBe(EXP5.customerTotalCents));
  });

  describe("margin", () => {
    it("dealerCostTotalCents includes non-OEM cost", () => {
      expect(result.dealerCostTotalCents).toBe(EXP5.dealerCostTotalCents);
    });
    it("grossMarginCents", () => expect(result.grossMarginCents).toBe(EXP5.grossMarginCents));
    it("commissionCents", () => expect(result.commissionCents).toBe(EXP5.commissionCents));
    it("commission invariant", () => expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15)));
    it("requiresApproval = false (13.3% > 10% floor)", () => expect(result.requiresApproval).toBe(EXP5.requiresApproval));
  });

  describe("cap warning", () => {
    it("programStackingWarnings has cap-exceeded message", () => {
      expect(result.programStackingWarnings.length).toBe(EXP5.programStackingWarningsLength);
    });
    it("warning mentions cap", () => {
      expect(result.programStackingWarnings[0]).toMatch(/cap/i);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURE 6: Yanmar ViO55 — 7% markup override, 2 approval reasons
// ═════════════════════════════════════════════════════════════════════════════

describe("Fixture 6 — Yanmar ViO55: 7% markup override below 10% floor", () => {
  const result = calculateQuote(REQ6, CTX6);

  describe("equipment breakdown", () => {
    it("equipment cost (same as Fixture 1 — same machine/freight)", () => {
      expect(result.breakdown.equipmentCostCents).toBe(EXP6.breakdown.equipmentCostCents);
    });
    it("markup override 7%", () => {
      expect(result.breakdown.markupPct).toBe(EXP6.breakdown.markupPct);
      expect(result.breakdown.markupCents).toBe(EXP6.breakdown.markupCents);
    });
    it("baseline sales price", () => {
      expect(result.breakdown.baselineSalesPriceCents).toBe(EXP6.breakdown.baselineSalesPriceCents);
    });
  });

  describe("customer totals", () => {
    it("no attachments, no programs", () => {
      expect(result.attachments).toHaveLength(0);
      expect(result.programs).toHaveLength(0);
    });
    it("taxCents", () => expect(result.taxCents).toBe(EXP6.taxCents));
    it("customerTotalCents", () => expect(result.customerTotalCents).toBe(EXP6.customerTotalCents));
  });

  describe("margin and dual approval", () => {
    it("grossMarginCents", () => expect(result.grossMarginCents).toBe(EXP6.grossMarginCents));
    it("markupAchievedPct ≈ 7.00%", () => {
      expect(result.markupAchievedPct).toBeCloseTo(EXP6.markupAchievedPctApprox, 3);
    });
    it("commissionCents", () => expect(result.commissionCents).toBe(EXP6.commissionCents));
    it("commission invariant", () => expect(result.commissionCents).toBe(Math.floor(result.grossMarginCents * 0.15)));
    it("requiresApproval = true", () => expect(result.requiresApproval).toBe(EXP6.requiresApproval));
    it("exactly 2 approval reasons", () => expect(result.approvalReasons).toHaveLength(EXP6.approvalReasonsLength));
    it("reason 1: below 10% floor for Yanmar", () => {
      expect(result.approvalReasons[0]).toMatch(/7\.0%.*10%.*floor.*Yanmar/i);
    });
    it("reason 2: override present", () => {
      expect(result.approvalReasons[1]).toMatch(/overrode/i);
    });
    it("no stacking warnings (no programs)", () => {
      expect(result.programStackingWarnings).toEqual(EXP6.programStackingWarnings);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F6 REGRESSION: commissionCents must never be negative
// ═════════════════════════════════════════════════════════════════════════════

describe("F6 regression — commission is 0 when gross margin is negative", () => {
  // Construct a degenerate context where equipment cost > sales price:
  // GMU pricing (8% off list) with a very high freight that pushes cost above price.
  // list = $10,000 → GMU price = $9,200; inflate freight to $5,000 → cost > $9,200.
  const ctx: import("../types.ts").QuoteContext = {
    model: {
      id: "model-neg",
      model_code: "NEG-TEST",
      name_display: "Negative Margin Test Unit",
      list_price_cents: 1_000_000,
      frame_size: "large",
      workspace_id: "default",
      brand: {
        id: "brand-neg",
        code: "NEG",
        name: "Negative Brand",
        discount_configured: true,
        dealer_discount_pct: 0.10,   // small discount
        markup_target_pct: 0.12,
        markup_floor_pct: 0.10,
        tariff_pct: 0.05,
        pdi_default_cents: 50_000,
        good_faith_pct: 0.01,
        attachment_markup_pct: 0.20,
      },
    },
    freightCents: 500_000,  // $5,000 freight — pushes cost well above GMU price
    freightZone: "FAR_ZONE",
    taxRatePct: 0.07,
    programs: [],
    catalogAttachments: [],
  };

  const req: import("../types.ts").PriceQuoteRequest = {
    equipmentModelId: "model-neg",
    customerType: "gmu",
    gmuDetails: { agencyType: "state" },
    deliveryState: "FL",
    taxExempt: true,
  };

  const result = calculateQuote(req, ctx);

  it("grossMarginCents is negative in this scenario", () => {
    expect(result.grossMarginCents).toBeLessThan(0);
  });

  it("commissionCents is 0, not negative (F6 fix)", () => {
    expect(result.commissionCents).toBe(0);
  });

  it("requiresApproval is true (markup below floor)", () => {
    expect(result.requiresApproval).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F11: DISCOUNT_NOT_CONFIGURED guard — must throw PricingError for unconfigured brands
// ═════════════════════════════════════════════════════════════════════════════

describe("F11 — DISCOUNT_NOT_CONFIGURED guard", () => {
  // Forestry brands ship with discount_configured = false until Angela sets rates.
  // The Bandit CTX4 fixture overrides to true for pricing tests; here we flip it back.
  const unconfiguredCtx: import("../types").QuoteContext = {
    ...CTX4,
    model: {
      ...CTX4.model,
      brand: {
        ...CTX4.model.brand,
        discount_configured: false,
      },
    },
  };

  it("throws a PricingError with code DISCOUNT_NOT_CONFIGURED", () => {
    expect(() => calculateQuote(REQ4, unconfiguredCtx)).toThrow();
  });

  it("error code is exactly DISCOUNT_NOT_CONFIGURED", () => {
    try {
      calculateQuote(REQ4, unconfiguredCtx);
      throw new Error("Expected calculateQuote to throw");
    } catch (err: unknown) {
      // PricingError exposes .code as a property
      expect((err as { code?: string }).code).toBe("DISCOUNT_NOT_CONFIGURED");
    }
  });

  it("error message mentions the brand name", () => {
    try {
      calculateQuote(REQ4, unconfiguredCtx);
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/Bandit/);
    }
  });
});
