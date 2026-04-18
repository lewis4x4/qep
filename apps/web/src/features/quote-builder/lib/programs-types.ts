/**
 * Re-exports from the programs type library for use in the quote-builder feature.
 *
 * The canonical types live in apps/web/src/lib/programs/types.ts (which uses
 * explicit .ts extensions for Deno edge function compatibility). This shim
 * re-exports them under the @/ alias path so React components can import
 * without the Deno-required .ts suffix.
 */
export type {
  QuoteScenario,
  QuoteContext,
  ProgramRecommendation,
  EligibilityResult,
  QbProgramType,
  QbProgram,
  RebateDeadline,
  StackingResult,
} from "@/lib/programs/types";
