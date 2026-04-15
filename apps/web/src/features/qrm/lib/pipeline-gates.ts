/**
 * Pipeline stage gate evaluation (Slice 2.4).
 *
 * Pure function with no IO so it can be reused by:
 *   - the drag-end hook to reject bad moves with a toast
 *   - the drag-over hook to paint the target column red before the drop lands
 *   - tests
 *
 * Gate rules follow the 21-step pipeline baked into migration 066:
 *   - Sort order 1–12: Pre-Sale — anything goes
 *   - Sort order 13–16: Close Process — soft warning on margin < 10%
 *   - Sort order 17–21: Post-Sale — hard gate: deposit must be `verified`
 *
 * The existing `useCrmPipelineDragDrop` hook already encodes these rules; this
 * module centralizes them so both the target highlight and the toast stay in
 * sync.
 */

import type { QrmDealStage, QrmRepSafeDeal } from "./types";

export type PipelineGateSeverity = "allow" | "warn" | "block";

export interface PipelineGateResult {
  severity: PipelineGateSeverity;
  message: string | null;
  /** When severity = "warn" the move proceeds but surfaces a banner at drop. */
  proceed: boolean;
}

const ALLOW: PipelineGateResult = { severity: "allow", message: null, proceed: true };

/**
 * Evaluate whether `deal` can move into `targetStage`. Pure, synchronous.
 *
 * Returns { severity: "block", proceed: false } for hard rejections, "warn"
 * for advisory moves, and "allow" otherwise.
 */
export function evaluateStageGate(
  deal: QrmRepSafeDeal | null | undefined,
  targetStage: QrmDealStage | null | undefined,
): PipelineGateResult {
  if (!deal || !targetStage) return ALLOW;

  const order = targetStage.sortOrder ?? 0;

  // Hard gate: Post-Sale stages require a verified deposit.
  if (order >= 17 && deal.depositStatus !== "verified") {
    return {
      severity: "block",
      message: "Deposit must be verified before entering this stage. Verify the deposit in the Approval Center first.",
      proceed: false,
    };
  }

  // Soft gate: Close Process stages warn on low margin.
  if (order >= 13 && order <= 16 && deal.marginPct !== null && deal.marginPct < 10) {
    return {
      severity: "warn",
      message: `Low margin (${deal.marginPct.toFixed(1)}%) — manager approval will be required at this stage.`,
      proceed: true,
    };
  }

  return ALLOW;
}

/**
 * Evaluate a gate for a set of deals moving into the same target stage.
 * Returns a block result if ANY deal would be blocked, a warn result if ANY
 * deal would warn, otherwise allow.
 *
 * Used by multi-select drag so we don't commit a partially-blocked batch.
 */
export function evaluateStageGateForSelection(
  deals: QrmRepSafeDeal[],
  targetStage: QrmDealStage | null | undefined,
): PipelineGateResult {
  if (deals.length === 0) return ALLOW;

  let warnResult: PipelineGateResult | null = null;
  for (const deal of deals) {
    const result = evaluateStageGate(deal, targetStage);
    if (result.severity === "block") return result;
    if (result.severity === "warn" && warnResult === null) warnResult = result;
  }
  return warnResult ?? ALLOW;
}
