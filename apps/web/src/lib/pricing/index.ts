/**
 * QEP Pricing Engine — Public API surface
 *
 * Consumers import from here, not from submodules directly.
 * The internal pipeline modules (equipment.ts, attachments.ts, etc.) are
 * implementation details; only the types and top-level entry point are public.
 */

export { calculateQuote, ENGINE_VERSION } from "./calculator";

export type {
  PriceQuoteRequest,
  PricedQuote,
  PricedBrand,
  PricedModel,
  EquipmentBreakdown,
  PricedAttachment,
  AttachmentsSubtotal,
  AppliedProgram,
  FinancingScenario,
  TradeInResult,
  TaxResult,
  MarginResult,
  QuoteContext,
  ProgramFixture,
} from "./types";

export { PricingError } from "./errors";
export type { PricingErrorCode } from "./errors";
