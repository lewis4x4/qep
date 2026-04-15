/**
 * Pipeline analytics (Slice 2.4).
 *
 * Pure functions that compute the overlay shown above the swim-lanes board
 * when the "Stage Stats" toggle is on. All inputs are already-loaded deals —
 * no IO, no DB.
 *
 * Metrics provided:
 *   - avgDaysInStagePerStage: avg time since entering the stage (uses
 *     lastActivityAt as the proxy — consistent with PipelineSwimLanesBoard)
 *   - conversionRatesByStage: forward-conversion estimate between adjacent
 *     open stages, computed as `next.count / current.count`. This is a very
 *     rough instantaneous snapshot from the open-pipeline slice — it's a
 *     "right now, this many deals made it to the next column" metric, NOT a
 *     historical cohort rate. It's an intentional approximation that lights
 *     up real bottlenecks without requiring the full stage-transition log.
 *   - bottleneckStageId: the open stage (excluding terminal ones) with the
 *     highest avgDaysInStage above a threshold
 *   - velocityDealsPerWeek: deals that changed stage within the last 7 days,
 *     estimated by lastActivityAt >= now - 7d. Again, an approximation — the
 *     exact answer would require `qrm_stage_transitions`.
 */

import type { QrmDealStage, QrmRepSafeDeal } from "./types";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const BOTTLENECK_DAYS_THRESHOLD = 14;

export interface StageAnalytics {
  stageId: string;
  stageName: string;
  sortOrder: number;
  dealCount: number;
  avgDaysInStage: number | null;
  /** forward conversion to the immediate next open stage; null when last open stage */
  conversionToNextPct: number | null;
}

export interface PipelineAnalyticsSnapshot {
  stages: StageAnalytics[];
  bottleneckStageId: string | null;
  bottleneckStageName: string | null;
  velocityDealsPerWeek: number;
  totalOpenDeals: number;
}

export interface ComputePipelineAnalyticsInput {
  stages: QrmDealStage[];
  deals: QrmRepSafeDeal[];
  now?: number;
}

function avgDaysForDeals(deals: QrmRepSafeDeal[], now: number): number | null {
  if (deals.length === 0) return null;
  const days = deals.map((d) => {
    const entered = d.lastActivityAt ? Date.parse(d.lastActivityAt) : Date.parse(d.createdAt);
    return Number.isFinite(entered) ? (now - entered) / DAY_MS : null;
  }).filter((n): n is number => n !== null);
  if (days.length === 0) return null;
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

export function computePipelineAnalytics({
  stages,
  deals,
  now = Date.now(),
}: ComputePipelineAnalyticsInput): PipelineAnalyticsSnapshot {
  const openStages = [...stages]
    .filter((s) => !s.isClosedWon && !s.isClosedLost)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const dealsByStage = new Map<string, QrmRepSafeDeal[]>();
  for (const deal of deals) {
    const list = dealsByStage.get(deal.stageId);
    if (list) list.push(deal);
    else dealsByStage.set(deal.stageId, [deal]);
  }

  const stageAnalytics: StageAnalytics[] = openStages.map((stage, idx) => {
    const stageDeals = dealsByStage.get(stage.id) ?? [];
    const avg = avgDaysForDeals(stageDeals, now);
    const nextStage = openStages[idx + 1];
    const nextStageDeals = nextStage ? dealsByStage.get(nextStage.id) ?? [] : [];

    // Conversion approximation: when the current stage has deals, the share
    // that "made it" is the ratio of next stage count to current stage count.
    // Capped at 100% to keep the gauge readable (the next column can be
    // larger than the current one on low-volume pipelines — that's a pileup
    // signal, not a >100% conversion rate).
    let conversion: number | null = null;
    if (nextStage && stageDeals.length > 0) {
      conversion = Math.min(100, Math.round((nextStageDeals.length / stageDeals.length) * 1000) / 10);
    }

    return {
      stageId: stage.id,
      stageName: stage.name,
      sortOrder: stage.sortOrder,
      dealCount: stageDeals.length,
      avgDaysInStage: avg,
      conversionToNextPct: conversion,
    };
  });

  // Bottleneck: stage with highest avg days above threshold (prefers middle
  // of funnel over tail — the last open stage often has long-lived deals
  // that are genuinely in-flight, not stuck).
  let bottleneckStageId: string | null = null;
  let bottleneckStageName: string | null = null;
  let bottleneckDays = BOTTLENECK_DAYS_THRESHOLD;
  for (const s of stageAnalytics) {
    if (s.avgDaysInStage !== null && s.avgDaysInStage > bottleneckDays) {
      bottleneckDays = s.avgDaysInStage;
      bottleneckStageId = s.stageId;
      bottleneckStageName = s.stageName;
    }
  }

  const weekAgo = now - WEEK_MS;
  const velocityDealsPerWeek = deals.filter((d) => {
    const t = d.lastActivityAt ? Date.parse(d.lastActivityAt) : NaN;
    return Number.isFinite(t) && t >= weekAgo;
  }).length;

  return {
    stages: stageAnalytics,
    bottleneckStageId,
    bottleneckStageName,
    velocityDealsPerWeek,
    totalOpenDeals: deals.length,
  };
}
