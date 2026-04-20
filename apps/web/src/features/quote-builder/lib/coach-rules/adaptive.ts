/**
 * Slice 18 — Adaptive rule adjustment.
 *
 * Applies workspace-wide acceptance stats to the rule output:
 *   - Rules with <5% acceptance (and ≥ MIN_CONFIDENCE_SHOWS) are
 *     suppressed entirely. These are rules that fire but the team has
 *     shown are not useful in practice.
 *   - Rules with 5%–20% acceptance are demoted one severity tier
 *     (critical → warning, warning → info) so they still surface
 *     but don't grab top-of-sidebar real estate.
 *   - Rules above 20% ride their original severity.
 *
 * MIN_CONFIDENCE_SHOWS prevents a single dismissal from killing a new
 * rule before it has a chance to prove itself. A rule must have fired
 * at least 10 times before acceptance-based adjustment kicks in —
 * below that we trust the rule author's original severity.
 *
 * Exported pure for testing. Called from the coach registry after
 * dismissal filtering but before MAX_VISIBLE_SUGGESTIONS truncation.
 */

import type { RuleResult, RuleSeverity } from "./types";

export const MIN_CONFIDENCE_SHOWS = 10;
export const SUPPRESS_BELOW_PCT = 5;
export const DEMOTE_BELOW_PCT   = 20;

export interface AcceptanceSnapshot {
  ruleId:               string;
  timesShown:           number;
  acceptanceRatePct:    number | null;
}

export type AdaptiveAction = "unchanged" | "demoted" | "suppressed";

export interface AdaptiveOutcome {
  rule:   RuleResult;
  action: AdaptiveAction;
  /** The acceptance-rate-pct that drove the decision. Available for
   *  callers that want to render an inline "(demoted: 12% acceptance)"
   *  tooltip — `evaluateCoachRules` doesn't surface this today but
   *  `applyAdaptiveAdjustments` returns it on its actions map so any
   *  future UI can wire it without changing the decision pipeline. */
  acceptanceRatePct: number | null;
  /** How many times the rule has shown (workspace-wide, window). */
  timesShown: number;
}

const DEMOTE_MAP: Record<RuleSeverity, RuleSeverity> = {
  critical: "warning",
  warning:  "info",
  info:     "info", // already the lowest — no-op
};

/**
 * Apply adaptive adjustments to a rule list. Pure.
 *
 * @param rules  rule results already filtered for dismissals + personal suppression
 * @param stats  workspace-wide acceptance rows, keyed by rule_id
 * @returns the adjusted rules (suppressed entries removed), plus an
 *          `actions` map describing what happened per rule id for
 *          optional UI surfacing.
 */
export function applyAdaptiveAdjustments(
  rules: RuleResult[],
  stats: AcceptanceSnapshot[],
): { adjusted: RuleResult[]; actions: Record<string, AdaptiveOutcome> } {
  const byRule = new Map<string, AcceptanceSnapshot>();
  for (const s of stats) byRule.set(s.ruleId, s);

  const adjusted: RuleResult[] = [];
  const actions: Record<string, AdaptiveOutcome> = {};

  for (const rule of rules) {
    const stat = byRule.get(rule.ruleId);
    const outcome = classify(rule, stat);
    actions[rule.ruleId] = outcome;
    if (outcome.action !== "suppressed") adjusted.push(outcome.rule);
  }

  return { adjusted, actions };
}

/**
 * Classify a single rule's adaptive outcome. Pure. Exported for tests.
 */
export function classify(
  rule: RuleResult,
  stat: AcceptanceSnapshot | undefined,
): AdaptiveOutcome {
  // No stats at all → no confidence to adjust — pass through.
  if (!stat || stat.timesShown < MIN_CONFIDENCE_SHOWS || stat.acceptanceRatePct == null) {
    return {
      rule,
      action: "unchanged",
      acceptanceRatePct: stat?.acceptanceRatePct ?? null,
      timesShown: stat?.timesShown ?? 0,
    };
  }

  if (stat.acceptanceRatePct < SUPPRESS_BELOW_PCT) {
    return {
      rule,
      action: "suppressed",
      acceptanceRatePct: stat.acceptanceRatePct,
      timesShown: stat.timesShown,
    };
  }

  if (stat.acceptanceRatePct < DEMOTE_BELOW_PCT) {
    const demoted: RuleResult = {
      ...rule,
      severity: DEMOTE_MAP[rule.severity],
      metrics: {
        ...(rule.metrics ?? {}),
        adaptive_demoted_from: rule.severity,
        adaptive_acceptance_pct: stat.acceptanceRatePct,
      },
    };
    return {
      rule: demoted,
      action: "demoted",
      acceptanceRatePct: stat.acceptanceRatePct,
      timesShown: stat.timesShown,
    };
  }

  return {
    rule,
    action: "unchanged",
    acceptanceRatePct: stat.acceptanceRatePct,
    timesShown: stat.timesShown,
  };
}
