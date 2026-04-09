/**
 * QRM Honesty Calibration — probe scorer functions (Phase 0 P0.6).
 *
 * 8 honesty probes that detect discrepancies between reported state and
 * observed state in the QRM data. Each probe is a pure scorer function
 * that takes pre-queried rows and returns `HonestyObservation[]`.
 *
 * The edge function (`qrm-honesty-scan`) handles the DB reads and calls
 * the scorer. This split keeps the scorers unit-testable with fixture
 * data — same pattern as `ranking.ts` (pure scoring) +
 * `qrm-command-center/index.ts` (DB reads).
 *
 * Probes 1-6 are live and produce observations today.
 * Probes 7-8 are stubs that return `[]` until their prerequisite
 * surfaces land (Phase 2 Slice 2.X and Phase 3 Slice 3.3 respectively).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HonestyObservation {
  observation_type: string;
  entity_type: string | null;
  entity_id: string | null;
  expected_state: string;
  actual_state: string;
  discrepancy_score: number; // 0-1
  attributed_user_id: string | null;
  metadata: Record<string, unknown>;
}

// ─── Row shapes (what the edge function queries and passes in) ───────────────

/** Probes 1 + 2: deals with stage info */
export interface DealWithStageRow {
  id: string;
  name: string;
  last_activity_at: string | null;
  expected_close_on: string | null;
  assigned_rep_id: string | null;
  stage_probability: number | null;
  workspace_id: string;
}

/** Probe 3: closed-lost deals missing loss reason */
export interface ClosedLostDealRow {
  id: string;
  name: string;
  loss_reason: string | null;
  assigned_rep_id: string | null;
  workspace_id: string;
}

/** Probe 4: deposit state mismatch */
export interface DepositMismatchRow {
  id: string;
  name: string;
  deposit_status: string;
  assigned_rep_id: string | null;
  workspace_id: string;
  has_verified_deposit: boolean;
}

/** Probe 5: margin passed with null pct */
export interface MarginMismatchRow {
  id: string;
  name: string;
  margin_check_status: string;
  margin_pct: number | null;
  assigned_rep_id: string | null;
  workspace_id: string;
}

/** Probe 6: retroactive activity */
export interface RetroactiveActivityRow {
  id: string;
  occurred_at: string;
  created_at: string;
  created_by: string | null;
  deal_id: string | null;
  workspace_id: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function daysSince(isoDate: string | null, nowMs: number): number | null {
  if (!isoDate) return null;
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ─── Probe 1: High probability, no activity 14 days ─────────────────────────

export function scoreHighProbNoActivity(
  rows: DealWithStageRow[],
  nowMs: number,
): HonestyObservation[] {
  const observations: HonestyObservation[] = [];
  for (const row of rows) {
    const days = daysSince(row.last_activity_at, nowMs);
    if (days === null || days < 14) continue;
    const prob = row.stage_probability ?? 0;
    if (prob < 70) continue;

    observations.push({
      observation_type: "high_prob_no_activity_14d",
      entity_type: "deal",
      entity_id: row.id,
      expected_state: "activity_within_14d",
      actual_state: `no_activity_${days}d`,
      discrepancy_score: clamp01(days / 30),
      attributed_user_id: row.assigned_rep_id,
      metadata: {
        deal_name: row.name,
        stage_probability: prob,
        days_since_activity: days,
      },
    });
  }
  return observations;
}

// ─── Probe 2: Close imminent, no activity 14 days ───────────────────────────

export function scoreCloseImminentNoActivity(
  rows: DealWithStageRow[],
  nowMs: number,
): HonestyObservation[] {
  const observations: HonestyObservation[] = [];
  for (const row of rows) {
    if (!row.expected_close_on) continue;
    const closeMs = Date.parse(row.expected_close_on);
    if (!Number.isFinite(closeMs)) continue;
    const daysToClose = Math.floor((closeMs - nowMs) / DAY_MS);
    if (daysToClose < 0 || daysToClose > 7) continue;

    const daysSinceActivity = daysSince(row.last_activity_at, nowMs);
    if (daysSinceActivity === null || daysSinceActivity < 14) continue;

    observations.push({
      observation_type: "close_imminent_no_activity",
      entity_type: "deal",
      entity_id: row.id,
      expected_state: "activity_within_14d",
      actual_state: `no_activity_${daysSinceActivity}d_closing_in_${daysToClose}d`,
      discrepancy_score: clamp01(daysSinceActivity / 30),
      attributed_user_id: row.assigned_rep_id,
      metadata: {
        deal_name: row.name,
        days_to_close: daysToClose,
        days_since_activity: daysSinceActivity,
      },
    });
  }
  return observations;
}

// ─── Probe 3: Closed-lost, no loss reason ────────────────────────────────────

export function scoreClosedLostNoReason(
  rows: ClosedLostDealRow[],
): HonestyObservation[] {
  const observations: HonestyObservation[] = [];
  for (const row of rows) {
    if (row.loss_reason && row.loss_reason.trim().length > 0) continue;
    observations.push({
      observation_type: "closed_lost_no_reason",
      entity_type: "deal",
      entity_id: row.id,
      expected_state: "loss_reason_documented",
      actual_state: "loss_reason_blank",
      discrepancy_score: 1.0,
      attributed_user_id: row.assigned_rep_id,
      metadata: { deal_name: row.name },
    });
  }
  return observations;
}

// ─── Probe 4: Deposit state mismatch ─────────────────────────────────────────

export function scoreDepositStateMismatch(
  rows: DepositMismatchRow[],
): HonestyObservation[] {
  const observations: HonestyObservation[] = [];
  for (const row of rows) {
    if (row.deposit_status !== "verified") continue;
    if (row.has_verified_deposit) continue;
    observations.push({
      observation_type: "deposit_state_mismatch",
      entity_type: "deal",
      entity_id: row.id,
      expected_state: "verified_deposit_row_exists",
      actual_state: "deal_marked_verified_but_no_deposit_row",
      discrepancy_score: 1.0,
      attributed_user_id: row.assigned_rep_id,
      metadata: { deal_name: row.name, deposit_status: row.deposit_status },
    });
  }
  return observations;
}

// ─── Probe 5: Margin passed with null percentage ─────────────────────────────

export function scoreMarginPassedNoPct(
  rows: MarginMismatchRow[],
): HonestyObservation[] {
  const observations: HonestyObservation[] = [];
  for (const row of rows) {
    if (row.margin_pct !== null && row.margin_pct !== undefined) continue;
    if (row.margin_check_status !== "passed" && row.margin_check_status !== "approved_by_manager") {
      continue;
    }
    observations.push({
      observation_type: "margin_passed_no_pct",
      entity_type: "deal",
      entity_id: row.id,
      expected_state: "margin_pct_populated",
      actual_state: `margin_${row.margin_check_status}_but_pct_null`,
      discrepancy_score: 1.0,
      attributed_user_id: row.assigned_rep_id,
      metadata: {
        deal_name: row.name,
        margin_check_status: row.margin_check_status,
      },
    });
  }
  return observations;
}

// ─── Probe 6: Retroactive activity (occurred_at > created_at + 48h) ─────────

export function scoreRetroactiveActivity(
  rows: RetroactiveActivityRow[],
): HonestyObservation[] {
  const observations: HonestyObservation[] = [];
  for (const row of rows) {
    const occurredMs = Date.parse(row.occurred_at);
    const createdMs = Date.parse(row.created_at);
    if (!Number.isFinite(occurredMs) || !Number.isFinite(createdMs)) continue;

    const gapMs = occurredMs - createdMs;
    if (gapMs <= 48 * HOUR_MS) continue;

    const gapHours = Math.floor(gapMs / HOUR_MS);
    observations.push({
      observation_type: "retroactive_activity",
      entity_type: "activity",
      entity_id: row.id,
      expected_state: "occurred_within_48h_of_creation",
      actual_state: `occurred_${gapHours}h_before_creation`,
      discrepancy_score: clamp01(gapHours / 168), // 168h = 1 week
      attributed_user_id: row.created_by,
      metadata: {
        gap_hours: gapHours,
        occurred_at: row.occurred_at,
        created_at: row.created_at,
        deal_id: row.deal_id,
      },
    });
  }
  return observations;
}

// ─── Probe 7: Meaningful contact decay proximity (STUB) ──────────────────────

export function scoreDecayThresholdProximity(): HonestyObservation[] {
  // STUB — depends on Phase 2 Slice 2.X (meaningful-contact calculation
  // engine). Returns [] until that surface ships. Registered in
  // qrm_honesty_probes with is_enabled=false and
  // depends_on='phase-2-slice-2.x-meaningful-contact'.
  return [];
}

// ─── Probe 8: Protected account gaming (STUB) ────────────────────────────────

export function scoreProtectedAccountGaming(): HonestyObservation[] {
  // STUB — depends on Phase 3 Slice 3.3 (Account Command Center override
  // workflow). Returns [] until that surface ships. Registered in
  // qrm_honesty_probes with is_enabled=false and
  // depends_on='phase-3-slice-3.3-account-override'.
  return [];
}

// ─── Probe registry ──────────────────────────────────────────────────────────
//
// The edge function loads enabled probes from qrm_honesty_probes, looks up
// each probe_name in this registry, and calls the scorer with the
// appropriate pre-queried rows. If a probe_name isn't in the registry,
// the edge function skips it (defensive against future probes added to the
// DB before the code is updated).

export type ScorerFunction =
  | ((rows: DealWithStageRow[], nowMs: number) => HonestyObservation[])
  | ((rows: ClosedLostDealRow[]) => HonestyObservation[])
  | ((rows: DepositMismatchRow[]) => HonestyObservation[])
  | ((rows: MarginMismatchRow[]) => HonestyObservation[])
  | ((rows: RetroactiveActivityRow[]) => HonestyObservation[])
  | (() => HonestyObservation[]);

/**
 * Query group keys — the edge function groups probes by which DB query
 * they need, runs each query once, and fans the result to all probes
 * in that group. This avoids duplicate queries when multiple probes
 * consume the same data set.
 */
export type QueryGroup =
  | "deals_with_stages"
  | "closed_lost_deals"
  | "deposit_mismatch"
  | "margin_mismatch"
  | "retroactive_activities"
  | "stub";

export interface ProbeRegistryEntry {
  scorer: ScorerFunction;
  queryGroup: QueryGroup;
}

export const PROBE_REGISTRY: Record<string, ProbeRegistryEntry> = {
  high_prob_no_activity_14d: {
    scorer: scoreHighProbNoActivity as ScorerFunction,
    queryGroup: "deals_with_stages",
  },
  close_imminent_no_activity: {
    scorer: scoreCloseImminentNoActivity as ScorerFunction,
    queryGroup: "deals_with_stages",
  },
  closed_lost_no_reason: {
    scorer: scoreClosedLostNoReason as ScorerFunction,
    queryGroup: "closed_lost_deals",
  },
  deposit_state_mismatch: {
    scorer: scoreDepositStateMismatch as ScorerFunction,
    queryGroup: "deposit_mismatch",
  },
  margin_passed_no_pct: {
    scorer: scoreMarginPassedNoPct as ScorerFunction,
    queryGroup: "margin_mismatch",
  },
  retroactive_activity: {
    scorer: scoreRetroactiveActivity as ScorerFunction,
    queryGroup: "retroactive_activities",
  },
  meaningful_contact_decay_proximity: {
    scorer: scoreDecayThresholdProximity as ScorerFunction,
    queryGroup: "stub",
  },
  protected_account_gaming: {
    scorer: scoreProtectedAccountGaming as ScorerFunction,
    queryGroup: "stub",
  },
};
