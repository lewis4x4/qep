/**
 * QRM Command Center — Executive Intelligence Layer v1 builder.
 *
 * Pure function, no IO. Computes forecast confidence, rep performance,
 * margin pressure, and branch health from pre-fetched data.
 * Manager/owner-gated — non-elevated callers get empty payload.
 */

import type {
  BranchHealthCard,
  ExecutiveIntelPayload,
  ForecastConfidenceCard,
  MarginPressureCard,
  RepPerformanceCard,
} from "./types.ts";

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const INACTIVITY_THRESHOLD_DAYS = 14;
const MAX_REPS = 5;
const MAX_BRANCHES = 10;

// ─── Row types ─────────────────────────────────────────────────────────────

export interface ExecDealRow {
  id: string;
  amount: number | null;
  stage_id: string;
  deposit_status: string | null;
  margin_check_status: string | null;
  margin_pct: number | null;
  expected_close_on: string | null;
  last_activity_at: string | null;
  assigned_rep_id: string | null;
  stage_probability: number | null;
}

export interface ProspectingKpiRow {
  rep_id: string | null;
  kpi_date: string;
  total_visits: number | null;
  positive_visits: number | null;
  target_met: boolean | null;
  consecutive_days_met: number | null;
  opportunities_created: number | null;
  quotes_generated: number | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
}

export interface MarginDailyRow {
  day: string;
  margin_dollars: number | null;
  median_margin: number | null;
  negative_margin_deal_count: number | null;
}

export interface BranchRow {
  id: string;
  display_name: string | null;
  is_active: boolean | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function parseTime(v: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function unwrapJoin<T>(val: T | T[] | null): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Forecast Confidence ───────────────────────────────────────────────────

function buildForecast(deals: ExecDealRow[], nowTime: number): ForecastConfidenceCard {
  let rawPipeline = 0;
  let weightedPipeline = 0;
  let activeDeals = 0;
  let totalInactivityDays = 0;
  let inactivityCount = 0;
  let depositsVerified = 0;
  let depositsTotal = 0;

  // Penalty accumulators
  let penaltyInactive = 0;
  let penaltyDeposit = 0;
  let penaltyMargin = 0;
  let penaltyNoClose = 0;

  for (const deal of deals) {
    const amt = deal.amount ?? 0;
    const prob = deal.stage_probability ?? 0;
    rawPipeline += amt;
    weightedPipeline += amt * prob;
    activeDeals++;

    const lastActivity = parseTime(deal.last_activity_at);
    if (lastActivity) {
      const daysSince = (nowTime - lastActivity) / DAY_MS;
      totalInactivityDays += daysSince;
      inactivityCount++;
      if (daysSince > INACTIVITY_THRESHOLD_DAYS) {
        penaltyInactive = clamp(penaltyInactive + 3, 0, 30);
      }
    }

    if (deal.deposit_status === "pending") {
      penaltyDeposit = clamp(penaltyDeposit + 5, 0, 25);
      depositsTotal++;
    } else if (deal.deposit_status === "verified") {
      depositsVerified++;
      depositsTotal++;
    }

    if (deal.margin_check_status === "flagged") {
      penaltyMargin = clamp(penaltyMargin + 3, 0, 15);
    }

    if (!deal.expected_close_on) {
      penaltyNoClose = clamp(penaltyNoClose + 2, 0, 10);
    }
  }

  const avgInactivity = inactivityCount > 0 ? totalInactivityDays / inactivityCount : 0;
  const avgPenalty = avgInactivity > 10 ? 10 : 0;
  const totalPenalty = penaltyInactive + penaltyDeposit + penaltyMargin + penaltyNoClose + avgPenalty;
  const confidenceScore = clamp(Math.round(100 - totalPenalty), 0, 100);
  const confidenceLabel: ForecastConfidenceCard["confidenceLabel"] =
    confidenceScore >= 70 ? "Strong" : confidenceScore >= 40 ? "Moderate" : "Weak";

  return {
    weightedPipeline: Math.round(weightedPipeline * 100) / 100,
    rawPipeline: Math.round(rawPipeline * 100) / 100,
    confidenceScore,
    confidenceLabel,
    activeDeals,
    avgInactivityDays: Math.round(avgInactivity * 10) / 10,
    depositsVerifiedPct: depositsTotal > 0 ? Math.round((depositsVerified / depositsTotal) * 100) : 100,
  };
}

// ─── Rep Performance ───────────────────────────────────────────────────────

function buildRepPerformance(kpis: ProspectingKpiRow[]): RepPerformanceCard[] {
  // Aggregate by rep
  const repMap = new Map<string, {
    repName: string;
    visits: number;
    streak: number;
    opportunities: number;
    quotes: number;
  }>();

  for (const row of kpis) {
    if (!row.rep_id) continue;
    const profile = unwrapJoin(row.profiles);
    const existing = repMap.get(row.rep_id) ?? {
      repName: profile?.full_name ?? "Unknown",
      visits: 0,
      streak: 0,
      opportunities: 0,
      quotes: 0,
    };
    existing.visits += row.total_visits ?? 0;
    existing.streak = Math.max(existing.streak, row.consecutive_days_met ?? 0);
    existing.opportunities += row.opportunities_created ?? 0;
    existing.quotes += row.quotes_generated ?? 0;
    repMap.set(row.rep_id, existing);
  }

  return [...repMap.entries()]
    .map(([repId, data]) => ({
      repId,
      repName: data.repName,
      visits7d: data.visits,
      targetMetStreak: data.streak,
      opportunitiesCreated: data.opportunities,
      quotesGenerated: data.quotes,
    }))
    .sort((a, b) => b.visits7d - a.visits7d)
    .slice(0, MAX_REPS);
}

// ─── Margin Pressure ───────────────────────────────────────────────────────

function buildMarginPressure(deals: ExecDealRow[], marginDaily: MarginDailyRow[]): MarginPressureCard {
  const flagged = deals.filter((d) => d.margin_check_status === "flagged");
  const flaggedValue = flagged.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  let negativeCloses = 0;
  const medians: number[] = [];
  for (const row of marginDaily) {
    negativeCloses += row.negative_margin_deal_count ?? 0;
    if (row.median_margin !== null) medians.push(row.median_margin);
  }

  const medianMargin = medians.length > 0
    ? Math.round((medians.reduce((a, b) => a + b, 0) / medians.length) * 10) / 10
    : null;

  return {
    flaggedDealCount: flagged.length,
    flaggedDealValue: Math.round(flaggedValue * 100) / 100,
    negativeMarginCloses30d: negativeCloses,
    medianMarginPct30d: medianMargin,
  };
}

// ─── Branch Health ─────────────────────────────────────────────────────────

function buildBranchHealth(
  _deals: ExecDealRow[],
  branches: BranchRow[],
  _nowTime: number,
): BranchHealthCard[] {
  // For v1, return branch list with placeholder data.
  // Full branch-deal aggregation requires profiles.branch_id FK which
  // may not exist yet. We show branch names as a starting point.
  return branches
    .filter((b) => b.is_active)
    .slice(0, MAX_BRANCHES)
    .map((b) => ({
      branchId: b.id,
      branchName: b.display_name ?? "Unknown",
      dealCount: 0,
      pipelineValue: 0,
      avgAgeDays: 0,
    }));
}

// ─── Main builder ──────────────────────────────────────────────────────────

export function buildExecutiveIntel(
  deals: ExecDealRow[] | null,
  kpis: ProspectingKpiRow[] | null,
  marginDaily: MarginDailyRow[] | null,
  branches: BranchRow[] | null,
  isElevated: boolean,
  nowTime: number,
): ExecutiveIntelPayload {
  if (!isElevated) {
    return {
      forecast: {
        weightedPipeline: 0, rawPipeline: 0, confidenceScore: 0,
        confidenceLabel: "Weak", activeDeals: 0, avgInactivityDays: 0, depositsVerifiedPct: 0,
      },
      topReps: [],
      marginPressure: { flaggedDealCount: 0, flaggedDealValue: 0, negativeMarginCloses30d: 0, medianMarginPct30d: null },
      branchHealth: [],
      isElevatedView: false,
    };
  }

  const safeDeals = deals ?? [];
  return {
    forecast: buildForecast(safeDeals, nowTime),
    topReps: buildRepPerformance(kpis ?? []),
    marginPressure: buildMarginPressure(safeDeals, marginDaily ?? []),
    branchHealth: buildBranchHealth(safeDeals, branches ?? [], nowTime),
    isElevatedView: true,
  };
}
