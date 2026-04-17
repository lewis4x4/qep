/**
 * QEP Program Engine — Public API (Slice 03)
 *
 * Import from here; don't import sub-modules directly outside this directory.
 */

export type {
  QuoteContext,
  EligibilityResult,
  ProgramRecommendation,
  QuoteScenario,
  RebateDeadline,
  StackingResult,
} from "./types.ts";

export { isEligible } from "./eligibility.ts";
export { recommendPrograms } from "./recommender.ts";
export { buildScenarios } from "./scenarios.ts";
export { validateStackingFromDB } from "./stacking-db.ts";
export { getUpcomingRebateDeadlines, enrichWithProgramDetails } from "./rebate-tracker.ts";
