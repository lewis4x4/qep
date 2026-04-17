/**
 * QEP Program Engine — Eligibility Checker (Slice 03)
 *
 * isEligible(program, context) checks a single qb_programs row against
 * the quote context and returns a human-readable EligibilityResult.
 *
 * Rules by program_type:
 *   cash_in_lieu        — active date window + model has a rebate entry
 *   low_rate_financing  — active date window (any model qualifies; rep picks term)
 *   gmu_rebate          — customer must be GMU + pre-approval number present
 *   aged_inventory      — active window + model has entry + modelYear in eligible set
 *   bridge_rent_to_sales — active window + model has entry + isRentalFleetPurchase = true
 *
 * No DB calls here — program rows are pre-fetched by the recommender.
 * This keeps the function pure and fast to unit-test.
 */

import type { QuoteContext, EligibilityResult } from "./types.ts";
import type { QbProgram } from "./types.ts";

interface CilDetails {
  rebates: Array<{ model_code: string; amount_cents: number }>;
}
interface FinancingDetails {
  terms: Array<{ months: number; rate_pct: number; dealer_participation_pct: number }>;
  lenders: Array<{ name: string; customer_type: string; contact?: string }>;
}
interface GmuDetails {
  discount_off_list_pct: number;
  requires_preapproval: boolean;
  preapproval_instructions?: string;
}
interface AgedInventoryDetails {
  eligible_model_years: number[];
  rebates: Array<{ model_code: string; amount_cents: number }>;
}
interface BridgeDetails {
  rebates: Array<{ model_code: string; amount_cents: number }>;
}

export function isEligible(program: QbProgram, context: QuoteContext): EligibilityResult {
  // ── Date window ─────────────────────────────────────────────────────────────
  const from = new Date(program.effective_from);
  if (context.dealDate < from) {
    return {
      eligible: false,
      reasons: [
        `This program doesn't start until ${program.effective_from} — it's not active on ` +
        `${context.dealDate.toISOString().split("T")[0]}. Ask Angela about the current quarter's programs.`,
      ],
    };
  }
  // effective_to null = open-ended program; skip end-date check
  if (program.effective_to !== null) {
    const to = new Date(program.effective_to);
    // effective_to is inclusive — set time to end of day for comparison
    to.setUTCHours(23, 59, 59, 999);
    if (context.dealDate > to) {
      return {
        eligible: false,
        reasons: [
          `This program ran from ${program.effective_from} to ${program.effective_to} — it's not active on ` +
          `${context.dealDate.toISOString().split("T")[0]}. Ask Angela about the current quarter's programs.`,
        ],
      };
    }
  }

  // ── Brand match ─────────────────────────────────────────────────────────────
  if (program.brand_id !== context.brandId) {
    return {
      eligible: false,
      reasons: ["This program is for a different brand."],
    };
  }

  // ── Type-specific checks ─────────────────────────────────────────────────────
  switch (program.program_type as string) {

    case "cash_in_lieu": {
      const details = program.details as unknown as CilDetails;
      const rebate = details?.rebates?.find((r) => r.model_code === context.modelCode);
      if (!rebate) {
        return {
          eligible: false,
          reasons: [
            `No CIL rebate amount for ${context.modelCode} in this program. ` +
            `Check the rebate schedule with Angela — it may be in a different tier.`,
          ],
        };
      }
      return {
        eligible: true,
        reasons: [
          `${program.name} gives the customer $${(rebate.amount_cents / 100).toLocaleString()} back.`,
        ],
        amountCents: rebate.amount_cents,
      };
    }

    case "low_rate_financing": {
      const details = program.details as unknown as FinancingDetails;
      const terms = details?.terms ?? [];
      const bestTerm = terms.find((t) => t.rate_pct === 0 && t.dealer_participation_pct === 0);
      if (bestTerm) {
        return {
          eligible: true,
          reasons: [
            `${bestTerm.months}-month 0% financing available at no dealer cost — ` +
            `pick a term and the payment calculates automatically.`,
          ],
          metadata: { terms, lenders: details?.lenders ?? [] },
        };
      }
      const lowestRate = terms.reduce(
        (min, t) => (t.rate_pct < min ? t.rate_pct : min),
        Infinity,
      );
      return {
        eligible: true,
        reasons: [
          `Financing available from ${(lowestRate * 100).toFixed(2)}% — pick a term.`,
        ],
        metadata: { terms, lenders: details?.lenders ?? [] },
      };
    }

    case "gmu_rebate": {
      if (context.customerType !== "gmu") {
        return {
          eligible: false,
          reasons: ["Customer isn't GMU — this program is for government, municipality, or utility buyers only."],
        };
      }
      const details = program.details as unknown as GmuDetails;
      if (details?.requires_preapproval && !context.gmuDetails?.preApprovalNumber) {
        return {
          eligible: false,
          reasons: [
            "GMU pre-approval number is required before closing this deal.",
          ],
          requirements: [
            details.preapproval_instructions ??
              "Submit GMU Request in YCENA Machine Order App and attach the approval number.",
          ],
        };
      }
      const discountPct = details?.discount_off_list_pct ?? 0.08;
      const discountCents = Math.round(context.listPriceCents * discountPct);
      return {
        eligible: true,
        reasons: [
          `GMU pricing: ${(discountPct * 100).toFixed(0)}% off list — ` +
          `saves the customer $${(discountCents / 100).toLocaleString()}.`,
        ],
        amountCents: discountCents,
        metadata: { discountPct },
      };
    }

    case "aged_inventory": {
      const details = program.details as unknown as AgedInventoryDetails;
      const rebate = details?.rebates?.find((r) => r.model_code === context.modelCode);
      if (!rebate) {
        return {
          eligible: false,
          reasons: [
            `No aged inventory rebate for ${context.modelCode}. ` +
            `This unit may not be in the aged inventory schedule.`,
          ],
        };
      }
      const eligibleYears: number[] = details?.eligible_model_years ?? [];
      if (context.modelYear === null || !eligibleYears.includes(context.modelYear)) {
        const yearsStr = eligibleYears.join(", ");
        return {
          eligible: false,
          reasons: [
            `Aged Inventory requires a ${yearsStr} model year unit — ` +
            `this one is ${context.modelYear ?? "unknown year"}.`,
          ],
        };
      }
      return {
        eligible: true,
        reasons: [
          `This MY${context.modelYear} ${context.modelCode} qualifies for the Aged Inventory program — ` +
          `$${(rebate.amount_cents / 100).toLocaleString()} back to the customer. ` +
          `This can stack with CIL or financing.`,
        ],
        amountCents: rebate.amount_cents,
      };
    }

    case "bridge_rent_to_sales": {
      const details = program.details as unknown as BridgeDetails;
      const rebate = details?.rebates?.find((r) => r.model_code === context.modelCode);
      if (!rebate) {
        return {
          eligible: false,
          reasons: [
            `No bridge rebate for ${context.modelCode} — check the bridge schedule with Angela.`,
          ],
        };
      }
      if (!context.isRentalFleetPurchase) {
        return {
          eligible: false,
          reasons: [
            "Bridge Rent-to-Sales is only for units going into the rental fleet, not a direct customer sale.",
          ],
        };
      }
      return {
        eligible: true,
        reasons: [
          `Bridge program applies — $${(rebate.amount_cents / 100).toLocaleString()} rebate ` +
          `for placing this unit in the rental fleet. This program stands alone — ` +
          `no other programs can combine with it.`,
        ],
        amountCents: rebate.amount_cents,
      };
    }

    default:
      return {
        eligible: false,
        reasons: [`Unknown program type: ${program.program_type}`],
      };
  }
}
