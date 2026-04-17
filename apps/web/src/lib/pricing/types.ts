/**
 * QEP Pricing Engine — Type Definitions
 *
 * Corrections applied vs. the pre-Slice-01 spec:
 *  - All IDs are `string` (UUID), not `number` — matches the qb_* schema.
 *  - Table refs use `qb_*` prefix (`qb_equipment_models`, `qb_brands`, etc.).
 *  - Programs for Slice 02 use fixture-injected objects; live DB reads in Slice 03.
 *  - `brand.discountConfigured` must be `true` or the engine throws DISCOUNT_NOT_CONFIGURED.
 *  - Edge Function is `qb-calculate`, not `calculate-quote`.
 *  - Auth uses `requireServiceUser()` from `_shared/service-auth.ts`.
 */

// ── Input ─────────────────────────────────────────────────────────────────────

export interface PriceQuoteRequest {
  /** UUID — references qb_equipment_models.id */
  equipmentModelId: string;
  quantity?: number; // default 1
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
    poNumber?: string;
  };
  deliveryState: string; // e.g. 'FL'
  deliveryZip?: string; // for tax lookup
  attachments?: Array<{
    /** UUID — references qb_attachments.id */
    attachmentId: string;
    quantity?: number;
  }>;
  customAttachments?: Array<{
    description: string;
    costCents: number;
    salesPriceCents?: number;
    oemBranded: boolean; // non-OEM cannot be financed unless rolled into machine price
  }>;
  tradeIn?: {
    make: string;
    model: string;
    year?: number;
    serial?: string;
    hours?: number;
    allowanceCents: number;
    bookValueCents?: number;
  };
  markupOverride?: {
    markupPct: number;
    reason: string; // required when overriding
    requestedBy: string; // profile UUID
  };
  financing?: {
    /** UUID — references qb_programs.id (optional; rep may leave unset) */
    programId?: string;
    termMonths?: number; // 24 | 36 | 48 | 60 | 72
    ratePctOverride?: number;
  };
  /** UUID — references qb_programs.id */
  cashInLieuProgramId?: string;
  /** UUIDs — references qb_programs.id[] */
  additionalProgramIds?: string[];
  taxExempt?: boolean;
  docFeeCents?: number; // default 40_000 ($400 per Yanmar pattern)
  notes?: string;
}

// ── Brand / Model echoed in output ────────────────────────────────────────────

export interface PricedBrand {
  /** UUID */
  id: string;
  code: string;
  name: string;
  dealerDiscountPct: number;
  markupTargetPct: number;
  markupFloorPct: number;
  tariffPct: number;
  pdiDefaultCents: number;
  goodFaithPct: number;
  attachmentMarkupPct: number;
  discountConfigured: boolean;
}

export interface PricedModel {
  /** UUID */
  id: string;
  modelCode: string;
  nameDisplay: string;
  listPriceCents: number;
}

// ── Step-by-step breakdown ────────────────────────────────────────────────────

export interface EquipmentBreakdown {
  listPriceCents: number;
  dealerDiscountCents: number;
  dealerDiscountPct: number;
  discountedPriceCents: number;
  pdiCents: number;
  goodFaithCents: number;
  goodFaithPct: number;
  freightCents: number;
  freightZone: string;
  tariffCents: number;
  tariffPct: number;
  equipmentCostCents: number;
  markupPct: number;
  markupCents: number;
  baselineSalesPriceCents: number;
}

// ── Attachment line ────────────────────────────────────────────────────────────

export interface PricedAttachment {
  /** UUID or null for custom attachments */
  attachmentId: string | null;
  description: string;
  quantity: number;
  listPriceCents: number;
  discountCents: number;
  costCents: number;
  markupPct: number;
  markupCents: number;
  salesPriceCents: number;
  oemBranded: boolean;
}

export interface AttachmentsSubtotal {
  totalListCents: number;
  totalCostCents: number;
  totalSalesPriceCents: number;
}

// ── Programs ──────────────────────────────────────────────────────────────────

export interface AppliedProgram {
  /** UUID */
  programId: string;
  programType: string;
  name: string;
  effectOnPrice: "customer_discount" | "dealer_cost" | "neutral";
  amountCents: number;
  details: Record<string, unknown>;
}

// ── Financing scenario ────────────────────────────────────────────────────────

export interface FinancingScenario {
  /** UUID */
  programId: string;
  lenderName: string;
  termMonths: number;
  ratePct: number;
  paymentCents: number; // monthly — floor(financed / term) at 0%; amortized otherwise
  totalFinancedCents: number;
  dealerParticipationPct: number;
  dealerParticipationCostCents: number; // dealer cost; reduces margin
}

// ── Trade-in ──────────────────────────────────────────────────────────────────

export interface TradeInResult {
  allowanceCents: number;
  bookValueCents: number | null;
  overUnderCents: number | null; // allowance - book (positive = over allowance)
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface PricedQuote {
  // Echo the request for full traceability
  request: PriceQuoteRequest;

  // Brand and model context
  brand: PricedBrand;
  model: PricedModel;

  // "Show your work" — the equipment cost chain (Steps 1–7)
  breakdown: EquipmentBreakdown;

  // Attachments, itemized
  attachments: PricedAttachment[];
  attachmentsSubtotal: AttachmentsSubtotal;

  // Trade-in
  tradeIn?: TradeInResult;

  // Programs applied (Step 9)
  programs: AppliedProgram[];
  programStackingWarnings: string[]; // e.g. "CIL and financing are mutually exclusive — using CIL"
  programEligibilityNotes: string[]; // e.g. "GMU program requires pre-approval number (not provided)"

  // Financing (Step 9, if applicable)
  financingScenario?: FinancingScenario;

  // Tax & fees (Step 10)
  taxRatePct: number;
  taxCents: number;
  docFeeCents: number;

  // Customer-facing totals
  customerSubtotalCents: number; // machine + attachments (before rebates)
  customerRebatesCents: number; // CIL + aged inventory stacked
  customerPriceAfterRebatesCents: number;
  customerTradeInAllowanceCents: number;
  customerNetOfTradeCents: number;
  customerTaxCents: number;
  customerDocFeeCents: number;
  customerTotalCents: number;

  // Dealer-facing margin analysis (Step 11)
  dealerCostTotalCents: number; // equipment cost + attachment cost + dealer participation
  dealerRevenueCents: number; // customer subtotal after rebates (tax/doc are pass-through)
  grossMarginCents: number;
  grossMarginPct: number;
  markupAchievedPct: number;
  commissionCents: number; // Math.floor(grossMarginCents * 0.15)

  // Approval flags (Step 12)
  requiresApproval: boolean;
  approvalReasons: string[]; // human-readable, e.g. "Markup 7.3% is below the 10% floor for Yanmar"

  // Metadata
  computedAt: string; // ISO timestamp
  engineVersion: string; // 'qep-pricing-engine@1.0.0'
}

// ── Internal pipeline result shapes ──────────────────────────────────────────
// Used to pass intermediate results between submodule functions.

export interface EquipmentResult {
  breakdown: EquipmentBreakdown;
  brand: PricedBrand;
  model: PricedModel;
  baselineSalesPriceCents: number;
}

export interface AttachmentsResult {
  attachments: PricedAttachment[];
  subtotal: AttachmentsSubtotal;
}

export interface StackingResult {
  /** Program IDs that passed stacking validation */
  validPrograms: string[];
  warnings: string[];
  eligibilityNotes: string[];
}

export interface ProgramsResult {
  programs: AppliedProgram[];
  financingScenario?: FinancingScenario;
  customerRebatesCents: number;
  dealerParticipationCostCents: number;
  warnings: string[];
  eligibilityNotes: string[];
}

export interface TaxResult {
  ratePct: number;
  cents: number;
}

export interface MarginResult {
  dealerCostTotalCents: number;
  dealerRevenueCents: number;
  grossMarginCents: number;
  grossMarginPct: number;
  markupAchievedPct: number;
  commissionCents: number;
  requiresApproval: boolean;
  approvalReasons: string[];
}

// ── Program fixture type (Slice 02 only — replaced by DB reads in Slice 03) ──

export interface ProgramFixture {
  id: string;
  programType:
    | "cash_in_lieu"
    | "low_rate_financing"
    | "gmu_rebate"
    | "aged_inventory"
    | "bridge_rent_to_sales"
    | "additional_rebate"
    | "other";
  name: string;
  /** UUID — matches qb_brands.id */
  brandId: string;
  isActive: boolean;
  startDate: string;
  endDate: string | null;
  details: Record<string, unknown>;
}

// ── Quote context — injected by Edge Function (DB rows) or test fixture ───────

/**
 * Everything the calculator needs beyond the PriceQuoteRequest.
 * The Edge Function fetches this from the DB; test fixtures inject it directly.
 * Keeping I/O separate from math makes every step unit-testable without mocking.
 */
export interface QuoteContext {
  /** Full qb_equipment_models row with brand nested */
  model: {
    id: string;
    model_code: string;
    name_display: string;
    list_price_cents: number;
    frame_size: string | null;
    workspace_id: string;
    brand: {
      id: string;
      code: string;
      name: string;
      discount_configured: boolean;
      dealer_discount_pct: number;
      markup_target_pct: number;
      markup_floor_pct: number;
      tariff_pct: number;
      pdi_default_cents: number;
      good_faith_pct: number;
      attachment_markup_pct: number;
    };
  };
  /** Freight cents for the delivery state (from qb_freight_zones lookup) */
  freightCents: number;
  freightZone: string;
  /**
   * Tax rate for the delivery location (from tax-calculator fn or stub).
   * Slice 02: hardcoded 7% FL. Slice 03+: fetched from tax-calculator edge fn.
   */
  taxRatePct: number;
  /**
   * Available programs — Slice 02: injected fixtures.
   * Slice 03+: fetched from qb_programs where is_active = true.
   */
  programs: ProgramFixture[];
  /** Catalog attachments the request references */
  catalogAttachments: Array<{
    id: string;
    name: string;
    list_price_cents: number;
    oem_branded: boolean;
    compatible_model_ids: string[] | null;
    universal: boolean;
  }>;
}
