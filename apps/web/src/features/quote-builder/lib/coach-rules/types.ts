/**
 * Deal Coach rule contracts — Slice 13.
 *
 * Each rule is a pure function that takes a snapshot of the draft +
 * context (the rep's own history, active programs, recent outcomes)
 * and returns zero or one suggestion. Rules are composable, testable,
 * and framework-agnostic.
 */

import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

// ── Context the registry passes to every rule ──────────────────────────────

export interface DealCoachContext {
  /** The live quote draft. */
  draft: QuoteWorkspaceDraft;

  /** Computed totals from QuoteBuilderV2Page.derived state. */
  computed: {
    equipmentTotal: number;
    attachmentTotal: number;
    subtotal: number;
    netTotal: number;
    marginAmount: number;
    marginPct: number;
  };

  /** Who's quoting. */
  userId: string;
  userRole: string | null;

  /** The active quote package id, if the draft has been saved at least once.
   *  Rules that need to persist state (shown/dismissed) wait for this. */
  quotePackageId: string | null;

  /** 90-day won-quote margin distribution for this rep (or the whole team
   *  if the rep has <5 closes of their own). */
  marginBaseline: {
    /** Median margin_pct on won deals. Null if fewer than 3 samples. */
    medianPct: number | null;
    /** Sample size the median was computed from. */
    sampleSize: number;
    /** True when we fell back to team-wide data (rep had <5 wins). */
    usingTeamFallback: boolean;
  };

  /** Active programs for the brands in the current equipment lineup. */
  activePrograms: Array<{
    programId: string;
    programCode: string;
    programType: string;
    programName: string;
    brandName: string;
  }>;
}

// ── Rule result ────────────────────────────────────────────────────────────

export type RuleSeverity = "critical" | "warning" | "info";

export interface RuleResult {
  /** Stable registry id — used for dismissal memory + training data. */
  ruleId: string;
  severity: RuleSeverity;
  /** Short headline — appears in the card header. */
  title: string;
  /** Body copy — one or two sentences. Can use **markdown bold**. */
  body: string;
  /** Reasoning the rep can expand to see. */
  why: string;
  /** Optional call-to-action label + handler id. The sidebar interprets
   *  `actionId` — e.g., "focus_margin_input" scrolls to + focuses that field. */
  action?: {
    label: string;
    actionId: string;
  };
  /** Structured snapshot persisted to qb_deal_coach_actions for training. */
  metrics?: Record<string, number | string | null>;
}

export type RuleEvaluator = (ctx: DealCoachContext) => RuleResult | null;

// ── Severity ranking for sort ──────────────────────────────────────────────

export const SEVERITY_RANK: Record<RuleSeverity, number> = {
  critical: 0,
  warning:  1,
  info:     2,
};
