/**
 * Deal Coach rule registry — Slice 13.
 *
 * Add a new rule by (1) implementing the `RuleEvaluator` signature in a
 * sibling file and (2) pushing it into the array below. No sidebar or
 * service-layer changes needed.
 *
 * Intentionally small today. Future rules (bid window, competitor
 * pressure, similar-deal retrospective) drop in the same way.
 */

import { marginBaselineRule } from "./margin-baseline";
import { activeProgramsRule } from "./active-programs";
import { similarDealsRule } from "./similar-deals";
import type {
  DealCoachContext,
  RuleEvaluator,
  RuleResult,
} from "./types";
import { SEVERITY_RANK } from "./types";

export * from "./types";

const RULES: RuleEvaluator[] = [
  marginBaselineRule,
  activeProgramsRule,
  similarDealsRule,
];

/** Maximum suggestions shown at once — prevents Clippy-feel. */
export const MAX_VISIBLE_SUGGESTIONS = 3;

/**
 * Run every registered rule over the context, filter out nulls + dismissed,
 * sort by severity, cap at MAX_VISIBLE_SUGGESTIONS.
 */
export function evaluateCoachRules(
  ctx: DealCoachContext,
  dismissedRuleIds: ReadonlySet<string> = new Set(),
): RuleResult[] {
  const results: RuleResult[] = [];
  for (const evaluator of RULES) {
    try {
      const r = evaluator(ctx);
      if (r && !dismissedRuleIds.has(r.ruleId)) {
        results.push(r);
      }
    } catch (err) {
      // One failing rule must not break the sidebar. Log and continue.
      // eslint-disable-next-line no-console
      console.warn(`[deal-coach] rule failed:`, err);
    }
  }
  results.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return results.slice(0, MAX_VISIBLE_SUGGESTIONS);
}
