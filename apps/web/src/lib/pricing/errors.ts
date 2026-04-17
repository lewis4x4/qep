/**
 * QEP Pricing Engine — Typed error classes
 *
 * Every error includes a machine-readable `code` and a human-readable
 * message written in Rylee's voice (see CLAUDE.md: "Human-sounding copy").
 */
export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

export type PricingErrorCode =
  | "MODEL_NOT_FOUND"
  | "BRAND_NOT_FOUND"
  | "DISCOUNT_NOT_CONFIGURED"   // brand.discount_configured = false — Angela hasn't set the rate yet
  | "FREIGHT_NOT_CONFIGURED"    // no freight zone for this brand + state combo
  | "TAX_LOOKUP_FAILED"
  | "PROGRAM_NOT_ACTIVE"
  | "PROGRAM_NOT_FOUND"
  | "STACKING_VIOLATION"
  | "MARKUP_INVALID"            // override < 0 or > 1
  | "GMU_DETAILS_REQUIRED"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_INCOMPATIBLE";
