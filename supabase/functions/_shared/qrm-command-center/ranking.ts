/**
 * QRM Command Center — rules-based deal ranker.
 *
 * Pure Deno-compatible functions. No DB clients, no IO, no LLM calls.
 * The edge function loads raw signals from Postgres and hands them here for
 * scoring + lane assignment + Chief-of-Staff selection. Slice 4 layers an
 * optional LLM rewrite over `formatRationale`; Slices 1-3 never do.
 *
 * Mirrors the stalled/overdue thresholds defined in
 * apps/web/src/features/qrm/lib/deal-signals.ts so frontend cards and the
 * ranker never disagree on whether a deal is at risk.
 */

import {
  isIronRole,
  type ActionLanesPayload,
  type AiChiefOfStaffPayload,
  type IronRole,
  type LaneKey,
  type PipelineMetaStage,
  type PipelinePressurePayload,
  type PipelineRiskState,
  type PipelineStageBucket,
  type RecommendationAction,
  type RecommendationCardPayload,
} from "./types.ts";

// ─── Constants ─────────────────────────────────────────────────────────────

export const DEAL_STALLED_THRESHOLD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const URGENCY_HORIZON_MS = 30 * DAY_MS;
const VOICE_LOOKBACK_MS = 7 * DAY_MS;
const COMPETITOR_LOOKBACK_MS = 14 * DAY_MS;
const HOT_CLOSE_WINDOW_MS = 7 * DAY_MS;
const STAGE_STUCK_DAYS = 14;

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface RankableDeal {
  id: string;
  name: string;
  amount: number | null;
  stageId: string;
  stageName: string | null;
  stageProbability: number | null;
  expectedCloseOn: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  depositStatus: string | null;
  marginCheckStatus: string | null;
  primaryContactId: string | null;
  companyId: string | null;
  assignedRepId: string | null;
  /** DGE optimizer expected value — used by Revenue Reality Board for probability blending. */
  dgeScore: number | null;
}

export interface DealSignalBundle {
  /** anomaly_alerts entries scoped to this deal (entity_type='deal'). */
  anomalyTypes: string[];
  /** Highest severity from anomaly_alerts: 'low'|'medium'|'high'|'critical'. */
  anomalySeverity: "low" | "medium" | "high" | "critical" | null;
  /** Voice capture sentiment in the last VOICE_LOOKBACK_MS window. */
  recentVoiceSentiment: "positive" | "neutral" | "negative" | null;
  /** True if a competitor was mentioned in the last COMPETITOR_LOOKBACK_MS window. */
  competitorMentioned: boolean;
  /** Active deposits row exists in 'pending'|'requested'|'received' state. */
  hasPendingDeposit: boolean;
  /** Customer health score (0-100) from customer_profiles_extended, if known. */
  healthScore: number | null;
}

export interface ContactCompanyLookup {
  companies: Map<string, string>;
  contacts: Map<string, string>;
}

// ─── Deal signal state (mirrors apps/web/src/features/qrm/lib/deal-signals.ts)

export interface DealSignalState {
  isOverdueFollowUp: boolean;
  isStalled: boolean;
  daysSinceLastActivity: number | null;
}

function toTime(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function getDealSignalState(deal: RankableDeal, nowTime: number): DealSignalState {
  const followUpTime = toTime(deal.nextFollowUpAt);
  const lastActivityTime = toTime(deal.lastActivityAt) ?? toTime(deal.createdAt);

  const isOverdueFollowUp = followUpTime !== null && followUpTime < nowTime;
  const daysSinceLastActivity = lastActivityTime !== null
    ? Math.floor((nowTime - lastActivityTime) / DAY_MS)
    : null;
  const isStalled = daysSinceLastActivity !== null &&
    daysSinceLastActivity > DEAL_STALLED_THRESHOLD_DAYS;

  return { isOverdueFollowUp, isStalled, daysSinceLastActivity };
}

// ─── Role weights ──────────────────────────────────────────────────────────

export interface FactorWeights {
  expectedRevenue: number;
  urgencyFromCloseDate: number;
  stalledPenalty: number;
  overdueFollowUp: number;
  blockerSeverity: number;
  voiceHeat: number;
  competitorPressure: number;
  healthScoreTrend: number;
}

const ADVISOR_WEIGHTS: FactorWeights = {
  expectedRevenue: 1.0,
  urgencyFromCloseDate: 0.9,
  stalledPenalty: 0.8,
  overdueFollowUp: 1.0,
  blockerSeverity: 0.6,
  voiceHeat: 0.4,
  competitorPressure: 0.5,
  healthScoreTrend: 0.2,
};

const MANAGER_WEIGHTS: FactorWeights = {
  expectedRevenue: 1.0,
  urgencyFromCloseDate: 0.6,
  stalledPenalty: 0.9,
  overdueFollowUp: 0.5,
  blockerSeverity: 0.9,
  voiceHeat: 0.3,
  competitorPressure: 0.6,
  healthScoreTrend: 0.6,
};

const WOMAN_WEIGHTS: FactorWeights = {
  expectedRevenue: 0.7,
  urgencyFromCloseDate: 0.5,
  stalledPenalty: 0.4,
  overdueFollowUp: 0.4,
  blockerSeverity: 1.0,
  voiceHeat: 0.1,
  competitorPressure: 0.2,
  healthScoreTrend: 0.3,
};

const MAN_WEIGHTS: FactorWeights = {
  expectedRevenue: 0.6,
  urgencyFromCloseDate: 0.7,
  stalledPenalty: 0.5,
  overdueFollowUp: 0.4,
  blockerSeverity: 0.9,
  voiceHeat: 0.2,
  competitorPressure: 0.2,
  healthScoreTrend: 0.3,
};

export function getRoleWeights(role: IronRole): FactorWeights {
  switch (role) {
    case "iron_advisor":
      return ADVISOR_WEIGHTS;
    case "iron_manager":
      return MANAGER_WEIGHTS;
    case "iron_woman":
      return WOMAN_WEIGHTS;
    case "iron_man":
      return MAN_WEIGHTS;
  }
}

// ─── Phase 0 P0.5 — role blend row narrowing ──────────────────────────────
//
// Pure narrowing helper consumed by the qrm-command-center edge function.
// Defensive against schema drift: drops rows whose iron_role is not a
// recognized enum value, drops rows with non-numeric / out-of-range /
// NaN weights, drops null/undefined rows.
//
// The narrowed shape is exactly what `blendRoleWeights()` consumes — no
// further filtering happens downstream, but the combinator does its own
// defensive filtering as a second line of defense.
//
// `isIronRole` is the canonical narrower from types.ts — used here AND
// at the edge function entry point so the enum check lives in one place.
export function narrowRoleBlendRows(
  rawRows: ReadonlyArray<{ iron_role?: unknown; weight?: unknown } | null | undefined> | null | undefined,
): IronRoleWeightEntry[] {
  if (!rawRows || rawRows.length === 0) return [];
  const out: IronRoleWeightEntry[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== "object") continue;
    const role = row.iron_role;
    if (typeof role !== "string" || !isIronRole(role)) continue;
    const rawWeight = row.weight;
    const weight = typeof rawWeight === "number" ? rawWeight : Number(rawWeight);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) continue;
    out.push({ role, weight });
  }
  return out;
}

// ─── Phase 0 P0.5 — blended role weights ───────────────────────────────────
//
// The single-role helper above is preserved for backwards compatibility.
// `blendRoleWeights` is the new canonical entry point: it accepts a list of
// {role, weight} entries (matching `IronRoleBlendEntry` from
// apps/web/src/features/qrm/lib/iron-roles.ts) and returns a linearly
// combined `FactorWeights` so a manager covering an advisor at 0.4 weight
// gets ranking priorities that are 60% manager / 40% advisor.
//
// Empty input falls back to ADVISOR_WEIGHTS (the safest default — Iron
// Advisor is the role with no special elevation, so any operator that
// somehow has no blend gets the customer-facing default rather than a
// manager-elevated view that might leak data).
//
// The combinator does NOT normalize the input weights to sum to 1.0 — it
// trusts the caller to have validated via `getIronRoleBlend()` first. This
// is deliberate: drift away from 1.0 is a P0.6 honesty probe concern, not a
// scoring concern, and forcing normalization here would mask the drift.

export interface IronRoleWeightEntry {
  role: IronRole;
  /** Blend weight in [0, 1]. Sum across the array SHOULD equal 1.0. */
  weight: number;
}

export function blendRoleWeights(entries: IronRoleWeightEntry[]): FactorWeights {
  if (!entries || entries.length === 0) {
    return { ...ADVISOR_WEIGHTS };
  }

  const result: FactorWeights = {
    expectedRevenue: 0,
    urgencyFromCloseDate: 0,
    stalledPenalty: 0,
    overdueFollowUp: 0,
    blockerSeverity: 0,
    voiceHeat: 0,
    competitorPressure: 0,
    healthScoreTrend: 0,
  };

  let appliedWeightSum = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.weight !== "number" || !Number.isFinite(entry.weight)) continue;
    if (entry.weight <= 0 || entry.weight > 1) continue;
    const w = getRoleWeights(entry.role);
    result.expectedRevenue += w.expectedRevenue * entry.weight;
    result.urgencyFromCloseDate += w.urgencyFromCloseDate * entry.weight;
    result.stalledPenalty += w.stalledPenalty * entry.weight;
    result.overdueFollowUp += w.overdueFollowUp * entry.weight;
    result.blockerSeverity += w.blockerSeverity * entry.weight;
    result.voiceHeat += w.voiceHeat * entry.weight;
    result.competitorPressure += w.competitorPressure * entry.weight;
    result.healthScoreTrend += w.healthScoreTrend * entry.weight;
    appliedWeightSum += entry.weight;
  }

  // If every entry was filtered out as invalid, fall back to ADVISOR.
  if (appliedWeightSum === 0) {
    return { ...ADVISOR_WEIGHTS };
  }

  return result;
}

// ─── Phase 0 P0.5 — team-scope eligibility for blended operators ──────────
//
// `team` scope in the QRM Command Center exposes cross-rep deal data and
// is gated to managers. With role blends, an operator can be PARTIALLY a
// manager (e.g. covering for an absent advisor at 0.4 weight). The owner
// rule is "manager weight ≥ 0.5" — cumulative iron_manager weight in the
// blend must meet or exceed half. Single-role iron_manager users
// (everyone post-migration-210 backfill) get 1.0 ≥ 0.5 → true, identical
// to the legacy `isElevated(role) === "iron_manager"` behavior. Other
// single-role users get 0 < 0.5 → false, also identical. Backwards
// compatible by construction; only blended operators see new behavior.
//
// Threshold lives here so it's:
//   1. Unit-testable in isolation (no edge function bootstrapping)
//   2. Consistent across any future caller (web admin, SQL view, etc.)
//   3. Documented next to the policy it implements

export const TEAM_SCOPE_MANAGER_WEIGHT_THRESHOLD = 0.5;

export function isBlendTeamScopeEligible(blend: IronRoleWeightEntry[]): boolean {
  let managerWeight = 0;
  for (const entry of blend) {
    if (!entry || entry.role !== "iron_manager") continue;
    if (typeof entry.weight !== "number" || !Number.isFinite(entry.weight)) continue;
    if (entry.weight <= 0) continue;
    managerWeight += entry.weight;
  }
  return managerWeight >= TEAM_SCOPE_MANAGER_WEIGHT_THRESHOLD;
}

// ─── Blocker classification ────────────────────────────────────────────────

export type BlockerKind =
  | "deposit_missing"
  | "margin_flagged"
  | "awaiting_approval"
  | "anomaly_critical"
  | null;

export function classifyBlocker(deal: RankableDeal, signals: DealSignalBundle): BlockerKind {
  if (deal.depositStatus === "pending" && signals.hasPendingDeposit) {
    return "deposit_missing";
  }
  if (deal.marginCheckStatus === "flagged") {
    return "margin_flagged";
  }
  if (signals.anomalySeverity === "critical") {
    return "anomaly_critical";
  }
  if (deal.marginCheckStatus === "approved_by_manager") {
    return null;
  }
  return null;
}

function blockerSeverity(kind: BlockerKind): number {
  switch (kind) {
    case "deposit_missing":
      return 1.0;
    case "margin_flagged":
      return 1.0;
    case "anomaly_critical":
      return 0.85;
    case "awaiting_approval":
      return 0.6;
    default:
      return 0;
  }
}

// ─── Scoring ───────────────────────────────────────────────────────────────

export interface ScoredDeal {
  deal: RankableDeal;
  signals: DealSignalBundle;
  state: DealSignalState;
  blocker: BlockerKind;
  score: number;
  rationale: string[];
  factorContributions: Array<{ factor: keyof FactorWeights; value: number }>;
}

interface ScoringContext {
  nowTime: number;
  maxOpenAmount: number;
  weights: FactorWeights;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function scoreDealForRecommendation(
  deal: RankableDeal,
  signals: DealSignalBundle,
  ctx: ScoringContext,
): ScoredDeal {
  const state = getDealSignalState(deal, ctx.nowTime);
  const blocker = classifyBlocker(deal, signals);

  const stageProb = deal.stageProbability ?? 0.3;
  const expectedRevenue = ctx.maxOpenAmount > 0
    ? clamp01(((deal.amount ?? 0) * stageProb) / ctx.maxOpenAmount)
    : 0;

  const closeMs = toTime(deal.expectedCloseOn);
  const urgencyFromCloseDate = closeMs !== null
    ? clamp01(1 - (closeMs - ctx.nowTime) / URGENCY_HORIZON_MS)
    : 0;

  const stalledPenalty = state.isStalled ? 1 : 0;
  const overdueFollowUp = state.isOverdueFollowUp ? 1 : 0;

  const blockerScore = blockerSeverity(blocker);

  let voiceHeat = 0;
  if (signals.recentVoiceSentiment === "positive") voiceHeat = 0.3;
  else if (signals.recentVoiceSentiment === "negative") voiceHeat = -0.3;

  const competitorPressure = signals.competitorMentioned ? 0.2 : 0;

  const healthScoreTrend = signals.healthScore != null
    ? clamp01(signals.healthScore / 100)
    : 0;

  const w = ctx.weights;
  const contributions: Array<{ factor: keyof FactorWeights; value: number }> = [
    { factor: "expectedRevenue", value: expectedRevenue * w.expectedRevenue },
    { factor: "urgencyFromCloseDate", value: urgencyFromCloseDate * w.urgencyFromCloseDate },
    { factor: "stalledPenalty", value: stalledPenalty * w.stalledPenalty },
    { factor: "overdueFollowUp", value: overdueFollowUp * w.overdueFollowUp },
    { factor: "blockerSeverity", value: blockerScore * w.blockerSeverity },
    { factor: "voiceHeat", value: voiceHeat * w.voiceHeat },
    { factor: "competitorPressure", value: competitorPressure * w.competitorPressure },
    { factor: "healthScoreTrend", value: healthScoreTrend * w.healthScoreTrend },
  ];

  const score = contributions.reduce((acc, c) => acc + c.value, 0);

  const rationale = buildRationale({
    deal,
    state,
    blocker,
    signals,
    contributions,
  });

  return { deal, signals, state, blocker, score, rationale, factorContributions: contributions };
}

// ─── Lane assignment ───────────────────────────────────────────────────────

export function assignLane(
  deal: RankableDeal,
  signals: DealSignalBundle,
  state: DealSignalState,
  blocker: BlockerKind,
  nowTime: number,
): LaneKey | null {
  if (blocker !== null) {
    return "blockers";
  }

  const closeMs = toTime(deal.expectedCloseOn);
  const closesSoon = closeMs !== null && (closeMs - nowTime) < HOT_CLOSE_WINDOW_MS && closeMs >= nowTime - DAY_MS;
  const stageProb = deal.stageProbability ?? 0;

  if (state.isStalled || state.isOverdueFollowUp) {
    return "revenue_at_risk";
  }
  if (closesSoon && stageProb < 0.5) {
    return "revenue_at_risk";
  }
  if (closesSoon && stageProb >= 0.5) {
    return "revenue_ready";
  }
  if (signals.recentVoiceSentiment === "negative" || signals.competitorMentioned) {
    return "revenue_at_risk";
  }
  return null;
}

// ─── Rationale (terminology-locked) ────────────────────────────────────────

interface RationaleInput {
  deal: RankableDeal;
  state: DealSignalState;
  blocker: BlockerKind;
  signals: DealSignalBundle;
  contributions: Array<{ factor: keyof FactorWeights; value: number }>;
}

function buildRationale(input: RationaleInput): string[] {
  const bullets: string[] = [];

  if (input.blocker === "deposit_missing") {
    bullets.push("Deposit pending — order is gated until verified.");
  } else if (input.blocker === "margin_flagged") {
    bullets.push("Margin flagged for Iron Manager review at the close & funding stage.");
  } else if (input.blocker === "anomaly_critical") {
    bullets.push("Critical anomaly raised by the QRM nightly scan.");
  }

  if (input.state.isStalled && input.state.daysSinceLastActivity != null) {
    bullets.push(`No activity for ${input.state.daysSinceLastActivity} days (stall threshold ${DEAL_STALLED_THRESHOLD_DAYS}).`);
  }

  if (input.state.isOverdueFollowUp) {
    bullets.push("Follow-up is overdue against the cadence engine.");
  }

  if (input.signals.recentVoiceSentiment === "negative") {
    bullets.push("Recent voice capture flagged negative sentiment.");
  } else if (input.signals.recentVoiceSentiment === "positive") {
    bullets.push("Recent voice capture shows positive buying intent.");
  }

  if (input.signals.competitorMentioned) {
    bullets.push("Competitor mentioned in field intelligence in the last 14 days.");
  }

  // Always include the top contributing positive factor as the closing line.
  const top = [...input.contributions]
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)[0];
  if (top && bullets.length < 3) {
    bullets.push(factorLabel(top.factor));
  }

  if (bullets.length === 0) {
    bullets.push("Highest weighted opportunity for the current scope.");
  }

  return bullets.slice(0, 3).map(formatRationale);
}

function factorLabel(factor: keyof FactorWeights): string {
  switch (factor) {
    case "expectedRevenue":
      return "Top expected-revenue contributor in the open pipeline.";
    case "urgencyFromCloseDate":
      return "Expected close date is approaching.";
    case "stalledPenalty":
      return "Stalled relative to the cadence baseline.";
    case "overdueFollowUp":
      return "Follow-up cadence is overdue.";
    case "blockerSeverity":
      return "Active operational blocker.";
    case "voiceHeat":
      return "Voice intelligence signals momentum.";
    case "competitorPressure":
      return "Competitive pressure detected.";
    case "healthScoreTrend":
      return "Customer health score is trending favorably.";
  }
}

/**
 * Rationale terminology lock.
 *
 * Per CODEX.md §"Terminology Lock", user-visible strings must say "QRM",
 * never "CRM". This helper rewrites the legacy term in any incoming string —
 * including ones we might accidentally introduce via factor labels or future
 * LLM rewrites — and is unit-tested to assert "CRM" never escapes the ranker.
 */
export function formatRationale(raw: string): string {
  // Replace bare "CRM" tokens (uppercase) but not legitimate substrings like
  // "scrambler" — match only when preceded/followed by non-letter characters.
  return raw.replace(/(^|[^A-Za-z])CRM(?![A-Za-z])/g, (_match, prefix: string) => `${prefix}QRM`);
}

// ─── Card construction ────────────────────────────────────────────────────

function buildPrimaryAction(deal: RankableDeal, lane: LaneKey | null): RecommendationAction {
  const href = `/qrm/deals/${deal.id}`;
  if (lane === "blockers") {
    return { kind: "open_deal", label: "Resolve blocker", href, payloadId: deal.id };
  }
  if (lane === "revenue_at_risk") {
    return { kind: "log_activity", label: "Log next touch", href, payloadId: deal.id };
  }
  return { kind: "open_deal", label: "Open deal", href, payloadId: deal.id };
}

function buildSecondaryAction(deal: RankableDeal): RecommendationAction {
  return {
    kind: "schedule_follow_up",
    label: "Schedule follow-up",
    href: `/qrm/deals/${deal.id}`,
    payloadId: deal.id,
  };
}

export function toRecommendationCard(
  scored: ScoredDeal,
  lane: LaneKey,
  lookups: ContactCompanyLookup,
  observedAt: string,
): RecommendationCardPayload {
  const { deal, score } = scored;
  const confidence = Math.max(0, Math.min(1, score / 4));
  return {
    recommendationKey: `deal:${deal.id}:${lane}`,
    entityType: "deal",
    entityId: deal.id,
    headline: deal.name,
    rationale: scored.rationale,
    lane,
    confidence,
    score,
    primaryAction: buildPrimaryAction(deal, lane),
    secondaryAction: buildSecondaryAction(deal),
    amount: deal.amount,
    companyName: deal.companyId ? lookups.companies.get(deal.companyId) ?? null : null,
    contactName: deal.primaryContactId ? lookups.contacts.get(deal.primaryContactId) ?? null : null,
    stageName: deal.stageName,
    observedAt,
  };
}

// ─── Aggregations ──────────────────────────────────────────────────────────

export function rankAndAssignLanes(
  scoredDeals: ScoredDeal[],
  lookups: ContactCompanyLookup,
  nowTime: number,
  observedAt: string,
): ActionLanesPayload {
  const lanes: ActionLanesPayload = {
    revenueReady: [],
    revenueAtRisk: [],
    blockers: [],
  };

  for (const scored of scoredDeals) {
    const lane = assignLane(
      scored.deal,
      scored.signals,
      scored.state,
      scored.blocker,
      nowTime,
    );
    if (lane === null) continue;
    const card = toRecommendationCard(scored, lane, lookups, observedAt);
    if (lane === "revenue_ready") lanes.revenueReady.push(card);
    else if (lane === "revenue_at_risk") lanes.revenueAtRisk.push(card);
    else lanes.blockers.push(card);
  }

  // Sort each lane: blockers by severity*expectedRevenue desc, the rest by score desc.
  lanes.blockers.sort((a, b) => b.score - a.score);
  lanes.revenueAtRisk.sort((a, b) => b.score - a.score);
  lanes.revenueReady.sort((a, b) => b.score - a.score);

  // Cap each lane to keep the UI scannable.
  lanes.blockers = lanes.blockers.slice(0, 8);
  lanes.revenueAtRisk = lanes.revenueAtRisk.slice(0, 8);
  lanes.revenueReady = lanes.revenueReady.slice(0, 8);

  return lanes;
}

export function rankChiefOfStaff(
  scoredDeals: ScoredDeal[],
  lanes: ActionLanesPayload,
): AiChiefOfStaffPayload {
  const bestMove = lanes.revenueReady[0]
    ?? lanes.revenueAtRisk[0]
    ?? lanes.blockers[0]
    ?? null;

  const biggestRisk = pickBiggestRisk(scoredDeals, lanes);
  const fastestPath = pickFastestPath(scoredDeals, lanes);

  const additionalSet = new Set<string>();
  const additional: RecommendationCardPayload[] = [];
  for (const card of [...lanes.revenueReady, ...lanes.revenueAtRisk, ...lanes.blockers]) {
    if (additional.length >= 5) break;
    if (bestMove && card.recommendationKey === bestMove.recommendationKey) continue;
    if (biggestRisk && card.recommendationKey === biggestRisk.recommendationKey) continue;
    if (fastestPath && card.recommendationKey === fastestPath.recommendationKey) continue;
    if (additionalSet.has(card.recommendationKey)) continue;
    additionalSet.add(card.recommendationKey);
    additional.push(card);
  }

  return {
    bestMove,
    biggestRisk,
    fastestPath,
    additional,
    source: "rules",
  };
}

function pickBiggestRisk(
  scored: ScoredDeal[],
  lanes: ActionLanesPayload,
): RecommendationCardPayload | null {
  // Prefer the highest blocker severity * expected revenue contribution.
  const blockers = lanes.blockers;
  if (blockers.length > 0) {
    return blockers[0];
  }
  const atRisk = lanes.revenueAtRisk;
  if (atRisk.length > 0) {
    return atRisk[0];
  }
  return null;
}

function pickFastestPath(
  scored: ScoredDeal[],
  lanes: ActionLanesPayload,
): RecommendationCardPayload | null {
  if (lanes.revenueReady.length === 0) return null;
  // Highest score in revenue_ready that is closest to closing.
  const sorted = [...lanes.revenueReady].sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    const aClose = toTime(a.observedAt) ?? 0;
    const bClose = toTime(b.observedAt) ?? 0;
    return aClose - bClose;
  });
  return sorted[0] ?? null;
}

// ─── Pipeline pressure ─────────────────────────────────────────────────────

export interface PipelineStageInput {
  id: string;
  name: string;
  sortOrder: number;
  isClosedWon: boolean;
  isClosedLost: boolean;
}

export function classifyMetaStage(stage: PipelineStageInput): PipelineMetaStage {
  if (stage.isClosedWon || stage.isClosedLost) return "post_sale";
  if (stage.sortOrder <= 4) return "early_funnel";
  if (stage.sortOrder <= 9) return "quote_validation";
  if (stage.sortOrder <= 14) return "close_funding";
  if (stage.sortOrder <= 19) return "readiness_delivery";
  return "post_sale";
}

export function buildPipelinePressure(
  stages: PipelineStageInput[],
  deals: RankableDeal[],
  nowTime: number,
): PipelinePressurePayload {
  const stageMap = new Map<string, PipelineStageInput>();
  for (const stage of stages) stageMap.set(stage.id, stage);

  const buckets = new Map<string, {
    stage: PipelineStageInput;
    count: number;
    amount: number;
    weightedAmount: number;
    daysSum: number;
    daysCounted: number;
    stuckCount: number;
  }>();

  let openCount = 0;
  let openAmount = 0;
  let weightedAmount = 0;

  for (const deal of deals) {
    const stage = stageMap.get(deal.stageId);
    if (!stage || stage.isClosedWon || stage.isClosedLost) continue;
    openCount += 1;
    openAmount += deal.amount ?? 0;
    const stageProb = deal.stageProbability ?? 0.3;
    weightedAmount += (deal.amount ?? 0) * stageProb;

    let bucket = buckets.get(stage.id);
    if (!bucket) {
      bucket = {
        stage,
        count: 0,
        amount: 0,
        weightedAmount: 0,
        daysSum: 0,
        daysCounted: 0,
        stuckCount: 0,
      };
      buckets.set(stage.id, bucket);
    }
    bucket.count += 1;
    bucket.amount += deal.amount ?? 0;
    bucket.weightedAmount += (deal.amount ?? 0) * stageProb;

    const lastTime = toTime(deal.lastActivityAt) ?? toTime(deal.createdAt);
    if (lastTime !== null) {
      const daysInStage = Math.floor((nowTime - lastTime) / DAY_MS);
      bucket.daysSum += daysInStage;
      bucket.daysCounted += 1;
      if (daysInStage > STAGE_STUCK_DAYS) bucket.stuckCount += 1;
    }
  }

  const stageBuckets: PipelineStageBucket[] = [];
  for (const bucket of buckets.values()) {
    const avgDaysInStage = bucket.daysCounted > 0
      ? Math.round(bucket.daysSum / bucket.daysCounted)
      : null;
    const riskState: PipelineRiskState = bucket.stuckCount === 0
      ? "healthy"
      : bucket.stuckCount / Math.max(bucket.count, 1) > 0.4
        ? "critical"
        : "watch";
    stageBuckets.push({
      id: bucket.stage.id,
      name: bucket.stage.name,
      metaStage: classifyMetaStage(bucket.stage),
      count: bucket.count,
      amount: bucket.amount,
      weightedAmount: bucket.weightedAmount,
      avgDaysInStage,
      stuckCount: bucket.stuckCount,
      riskState,
    });
  }

  stageBuckets.sort((a, b) => {
    const sa = stageMap.get(a.id)?.sortOrder ?? 0;
    const sb = stageMap.get(b.id)?.sortOrder ?? 0;
    return sa - sb;
  });

  return {
    stages: stageBuckets,
    totals: { openCount, openAmount, weightedAmount },
  };
}

// ─── Convenience: bulk score ──────────────────────────────────────────────

export function scoreDeals(
  deals: RankableDeal[],
  signalsByDealId: Map<string, DealSignalBundle>,
  weights: FactorWeights,
  nowTime: number,
): ScoredDeal[] {
  const maxOpenAmount = deals.reduce((max, d) => Math.max(max, d.amount ?? 0), 0);
  const ctx: ScoringContext = { nowTime, maxOpenAmount, weights };
  return deals.map((deal) => {
    const signals = signalsByDealId.get(deal.id) ?? {
      anomalyTypes: [],
      anomalySeverity: null,
      recentVoiceSentiment: null,
      competitorMentioned: false,
      hasPendingDeposit: false,
      healthScore: null,
    };
    return scoreDealForRecommendation(deal, signals, ctx);
  });
}

/**
 * Phase 0 P0.5 — blend-aware bulk scoring.
 *
 * Convenience overload of {@link scoreDeals} that accepts a role blend
 * (`IronRoleWeightEntry[]`) instead of a single `FactorWeights` object.
 * Internally combines via {@link blendRoleWeights} and delegates the rest
 * of the work to the existing `scoreDeals` path. Same return shape, same
 * fallback behavior on missing signals.
 */
export function scoreDealsWithBlend(
  deals: RankableDeal[],
  signalsByDealId: Map<string, DealSignalBundle>,
  blend: IronRoleWeightEntry[],
  nowTime: number,
): ScoredDeal[] {
  const weights = blendRoleWeights(blend);
  return scoreDeals(deals, signalsByDealId, weights, nowTime);
}
