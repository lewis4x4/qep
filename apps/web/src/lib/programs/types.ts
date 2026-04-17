/**
 * QEP Program Engine — Type Definitions (Slice 03)
 *
 * These types extend the Slice 02 pricing types. The eligibility engine works
 * against live qb_programs rows (not injected fixtures like Slice 02).
 *
 * Corrections vs. greenfield spec:
 *  - All IDs are string UUIDs (not number).
 *  - Table is qb_programs (not programs).
 *  - stacking reads qb_program_stacking_rules from DB (not hardcoded).
 *  - dealDate is a Date object; program.effective_from / effective_to are date strings.
 */

import type { QbProgram, QbProgramType } from "@/types/quote-builder.ts";

// ── Context passed to every eligibility / recommender call ───────────────────

export interface QuoteContext {
  /** UUID — qb_brands.id */
  brandId: string;
  /** UUID — qb_equipment_models.id */
  equipmentModelId: string;
  /** The model_code string on qb_equipment_models */
  modelCode: string;
  /** model_year of the specific unit — used for aged inventory eligibility */
  modelYear: number | null;
  customerType: "standard" | "gmu";
  gmuDetails?: {
    agencyType:
      | "federal"
      | "state"
      | "local_gov"
      | "municipality"
      | "military"
      | "university"
      | "utility_coop";
    preApprovalNumber?: string;
  };
  /** True when unit goes into rental fleet (Bridge eligibility gate) */
  isRentalFleetPurchase?: boolean;
  /** Date of the deal — drives program date-window eligibility */
  dealDate: Date;
  listPriceCents: number;
}

// ── Eligibility result for a single program ───────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  /** Human-readable explanation — both why eligible and why not. Rylee reads these. */
  reasons: string[];
  /** Dollar amount the customer receives back, if applicable */
  amountCents?: number;
  /** Things the rep must collect before closing (e.g. GMU pre-approval number) */
  requirements?: string[];
  metadata?: Record<string, unknown>;
}

// ── Program recommendation — one row per program in the response ──────────────

export interface ProgramRecommendation {
  programId: string;
  programCode: string;
  name: string;
  programType: QbProgramType;
  eligibility: EligibilityResult;
  /** Customer-facing benefit in cents (CIL rebate, etc.) */
  estimatedCustomerBenefitCents?: number;
  /** Dealer cost in cents (financing buy-down participation, etc.) */
  estimatedDealerCostCents?: number;
  notes: string[];
}

// ── Scenario — a complete deal option the rep can present ─────────────────────

export interface QuoteScenario {
  /** Human-readable label the rep reads to the customer */
  label: string;
  /** One-sentence description */
  description: string;
  /** Program IDs used in this scenario */
  programIds: string[];
  /** What the customer pays out of pocket today */
  customerOutOfPocketCents: number;
  /** Monthly payment if financing (undefined for cash deals) */
  monthlyPaymentCents?: number;
  termMonths?: number;
  /** Total lifetime cost to customer */
  totalPaidByCustomerCents: number;
  /** QEP gross margin dollars */
  dealerMarginCents: number;
  dealerMarginPct: number;
  commissionCents: number;
  /** Pros for the customer — human-sounding, not AI-speak */
  pros: string[];
  /** Cons — honest tradeoffs */
  cons: string[];
}

// ── Rebate deadline (for the dashboard + cron) ────────────────────────────────

export interface RebateDeadline {
  dealId: string;
  dealNumber: string;
  companyName: string;
  salesmanName: string;
  programs: Array<{
    name: string;
    programType: string;
    programCode: string;
  }>;
  warrantyRegistrationDate: string; // ISO date string
  filingDueDate: string;            // ISO date string
  daysRemaining: number;
  /** Green ≥ 14 days, yellow 7–13, red 1–6, overdue ≤ 0 */
  urgency: "green" | "yellow" | "red" | "overdue";
  /** Sum of all program rebate amounts on this deal */
  totalRebateAmountCents: number;
}

// ── Stacking result — also used in pricing engine ────────────────────────────

export interface StackingResult {
  valid: boolean;
  validProgramIds: string[];
  violations: string[];
  warnings: string[];
}

// Re-export the DB row type so callers import from one place
export type { QbProgram };
