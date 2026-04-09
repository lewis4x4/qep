/**
 * QRM Command Center — Revenue Reality Board builder.
 *
 * Pure function, no DB clients, no IO. Accepts the already-fetched deal list
 * and signal bundles; produces the `RevenueRealityBoardPayload` that tells
 * the operator the financial truth of their pipeline.
 *
 * DGE integration: when a deal has a non-null `dge_score`, the effective
 * close probability is blended 60/40 between stage probability and a
 * DGE-derived approximation. This is a Phase 1 approximation — a future
 * slice can query `deal_scenarios.close_probability` directly.
 */

import type {
  BlockerBreakdownEntry,
  BlockerType,
  RevenueRealityBoardPayload,
} from "./types.ts";

import {
  classifyBlocker,
  getDealSignalState,
  DEAL_STALLED_THRESHOLD_DAYS,
  type BlockerKind,
  type DealSignalBundle,
  type RankableDeal,
} from "./ranking.ts";

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const STALLED_QUOTE_DAYS = DEAL_STALLED_THRESHOLD_DAYS * 2; // 14 days
const DGE_STAGE_WEIGHT = 0.6;
const DGE_BLEND_WEIGHT = 0.4;

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Compute the effective close probability for a deal.
 *
 * When `dgeScore` is available and positive, blend:
 *   effectiveProb = 0.6 × stageProbability + 0.4 × (dgeScore / amount)
 *
 * The ratio `dgeScore / amount` approximates close probability because
 * `dge_score` = `recommendedPrice × marginPct × closeProbability` from the
 * DGE optimizer, making the ratio a proxy for the combined prob-margin
 * adjustment normalized against deal size.
 *
 * Falls back to pure stage probability when DGE is unavailable.
 */
export function getEffectiveProbability(
  stageProbability: number | null,
  amount: number | null,
  dgeScore: number | null,
): { prob: number; dgeUsed: boolean } {
  const stageProb = stageProbability ?? 0;

  if (dgeScore == null || dgeScore <= 0 || amount == null || amount <= 0) {
    return { prob: stageProb, dgeUsed: false };
  }

  const dgeProb = clamp01(dgeScore / amount);
  const blended = DGE_STAGE_WEIGHT * stageProb + DGE_BLEND_WEIGHT * dgeProb;
  return { prob: clamp01(blended), dgeUsed: true };
}

const EMPTY_SIGNALS: DealSignalBundle = {
  anomalyTypes: [],
  anomalySeverity: null,
  recentVoiceSentiment: null,
  competitorMentioned: false,
  hasPendingDeposit: false,
  healthScore: null,
};

// ─── Builder ───────────────────────────────────────────────────────────────

export function buildRevenueRealityBoard(
  deals: RankableDeal[],
  signalsByDealId: Map<string, DealSignalBundle>,
  nowTime: number,
): RevenueRealityBoardPayload {
  let openPipeline = 0;
  let weightedRevenue = 0;
  let closable7d = 0;
  let closable30d = 0;
  let atRisk = 0;
  let marginAtRisk = 0;
  let stalledCount = 0;
  let stalledValue = 0;
  let dgeBlendedCount = 0;

  const blockerMap = new Map<BlockerType, { count: number; totalValue: number }>();

  for (const deal of deals) {
    const amt = deal.amount ?? 0;
    const signals = signalsByDealId.get(deal.id) ?? EMPTY_SIGNALS;
    const signalState = getDealSignalState(deal, nowTime);

    // Effective probability (with DGE blend when available)
    const { prob: effectiveProb, dgeUsed } = getEffectiveProbability(
      deal.stageProbability,
      deal.amount,
      deal.dgeScore,
    );
    if (dgeUsed) dgeBlendedCount++;

    // Open pipeline (raw sum)
    openPipeline += amt;

    // Weighted revenue
    const weighted = amt * effectiveProb;
    weightedRevenue += weighted;

    // Closable windows
    if (deal.expectedCloseOn) {
      const closeTime = Date.parse(deal.expectedCloseOn);
      if (Number.isFinite(closeTime) && effectiveProb >= 0.5) {
        const timeToClose = closeTime - nowTime;
        // Future close within 30 days (superset of 7d)
        if (timeToClose >= -DAY_MS && timeToClose <= THIRTY_DAYS_MS) {
          closable30d += weighted;
          // Also within 7 days
          if (timeToClose <= SEVEN_DAYS_MS) {
            closable7d += weighted;
          }
        }
      }
    }

    // At-risk revenue (stalled or overdue)
    if (signalState.isStalled || signalState.isOverdueFollowUp) {
      atRisk += weighted;
    }

    // Margin at risk (flagged)
    if (deal.marginCheckStatus === "flagged") {
      marginAtRisk += amt;
    }

    // Stalled quotes (>14 days no activity)
    if (
      signalState.daysSinceLastActivity !== null &&
      signalState.daysSinceLastActivity > STALLED_QUOTE_DAYS
    ) {
      stalledCount++;
      stalledValue += amt;
    }

    // Blocker breakdown
    const blockerKind = classifyBlocker(deal, signals);
    if (blockerKind !== null && blockerKind !== "awaiting_approval") {
      const bt = blockerKind as BlockerType;
      const existing = blockerMap.get(bt) ?? { count: 0, totalValue: 0 };
      existing.count++;
      existing.totalValue += amt;
      blockerMap.set(bt, existing);
    }
  }

  // Build blocker breakdown array
  const blockedByType: BlockerBreakdownEntry[] = [];
  for (const [type, entry] of blockerMap) {
    blockedByType.push({ type, count: entry.count, totalValue: entry.totalValue });
  }
  blockedByType.sort((a, b) => b.totalValue - a.totalValue);

  // DGE availability
  const totalDeals = deals.length;
  const dgeAvailability: RevenueRealityBoardPayload["dgeAvailability"] =
    totalDeals === 0 || dgeBlendedCount === 0
      ? "none"
      : dgeBlendedCount === totalDeals
        ? "full"
        : "partial";

  return {
    openPipeline: Math.round(openPipeline * 100) / 100,
    weightedRevenue: Math.round(weightedRevenue * 100) / 100,
    closable7d: Math.round(closable7d * 100) / 100,
    closable30d: Math.round(closable30d * 100) / 100,
    atRisk: Math.round(atRisk * 100) / 100,
    marginAtRisk: Math.round(marginAtRisk * 100) / 100,
    stalledQuotes: {
      count: stalledCount,
      totalValue: Math.round(stalledValue * 100) / 100,
    },
    blockedByType,
    dgeBlendedDealCount: dgeBlendedCount,
    dgeAvailability,
  };
}
