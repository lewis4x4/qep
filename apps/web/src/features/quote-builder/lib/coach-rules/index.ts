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
import { reasonIntelligenceRule } from "./reason-intelligence";
import { applyAdaptiveAdjustments, type AcceptanceSnapshot } from "./adaptive";
import type {
  DealCoachContext,
  RuleEvaluator,
  RuleResult,
} from "./types";
import { SEVERITY_RANK } from "./types";

export * from "./types";
export * from "./adaptive";

const RULES: RuleEvaluator[] = [
  marginBaselineRule,
  activeProgramsRule,
  similarDealsRule,
  reasonIntelligenceRule,
];

/** Maximum suggestions shown at once — prevents Clippy-feel. */
export const MAX_VISIBLE_SUGGESTIONS = 3;

/**
 * Run every registered rule over the context, filter out nulls + dismissed,
 * apply acceptance-weighted adjustments, sort by severity, cap at
 * MAX_VISIBLE_SUGGESTIONS.
 *
 * Slice 18: the `acceptanceStats` arg is optional. When omitted the old
 * behavior is preserved (every rule rides its author-chosen severity).
 * When provided, rules with sub-threshold workspace acceptance are
 * demoted or suppressed — see ./adaptive.ts.
 */
export function evaluateCoachRules(
  ctx: DealCoachContext,
  dismissedRuleIds: ReadonlySet<string> = new Set(),
  acceptanceStats: AcceptanceSnapshot[] = [],
): RuleResult[] {
  const raw: RuleResult[] = [];
  for (const evaluator of RULES) {
    try {
      const r = evaluator(ctx);
      if (r && !dismissedRuleIds.has(r.ruleId)) {
        raw.push(r);
      }
    } catch (err) {
      // One failing rule must not break the sidebar. Log and continue.
      // eslint-disable-next-line no-console
      console.warn(`[deal-coach] rule failed:`, err);
    }
  }
  const { adjusted } = applyAdaptiveAdjustments(raw, acceptanceStats);
  adjusted.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return adjusted.slice(0, MAX_VISIBLE_SUGGESTIONS);
}
