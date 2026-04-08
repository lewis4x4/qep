/**
 * QRM Command Center — Prediction Ledger adapter (Phase 0 P0.3 + P0.8).
 *
 * Pure-function helpers that turn the ranker's output (`ScoredDeal[]` +
 * `ActionLanesPayload` + `AiChiefOfStaffPayload`) into rows ready for insert
 * into `qrm_predictions` (migration 208). Includes:
 *
 *   - sha256 hashing of canonical-JSON inputs (rationale, deal core fields,
 *     signal bundle) so the ledger can detect re-emissions of identical
 *     predictions and the grader can group predictions by what the model saw.
 *
 *   - Deduplication: a single deal in three lanes plus three Chief-of-Staff
 *     slots only writes ONE ledger row per (subject, prediction_kind) pair.
 *
 *   - Trace step extraction: maps `ScoredDeal.factorContributions` into the
 *     `trace_steps` jsonb shape the trace UI consumes (P0.8 atomic).
 *
 * Deno-compatible. No DB clients in this module — the edge function does the
 * actual insert. These helpers are testable in isolation against fixture
 * scored deals.
 */

import type {
  FactorWeights,
  RankableDeal,
  ScoredDeal,
} from "./ranking.ts";
import type {
  ActionLanesPayload,
  AiChiefOfStaffPayload,
  IronRole,
  LaneKey,
  RecommendationCardPayload,
} from "./types.ts";

// ─── Canonical JSON serialization ─────────────────────────────────────────

/**
 * Stable JSON serialization with sorted object keys. Same input must always
 * produce the same byte sequence so hashes are deterministic across runs.
 *
 * Arrays preserve order (it's semantically meaningful).
 * Objects sort keys alphabetically.
 * NaN, Infinity, undefined become null (matches JSON.stringify behavior).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

// ─── SHA-256 hashing (async, Deno crypto.subtle) ──────────────────────────

const TEXT_ENCODER = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const buf = TEXT_ENCODER.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash a rationale array to a stable hex digest. */
export async function hashRationale(rationale: readonly string[]): Promise<string> {
  return await sha256Hex(canonicalJson(rationale));
}

/**
 * Hash the deal-side inputs the ranker considered: deal core fields plus
 * the role weights and ranker version. Two predictions are "the same input"
 * if and only if their `inputs_hash` matches.
 *
 * Excludes signals — those have their own hash so a deal scored at two
 * different times with different signal sets has the same `inputs_hash`
 * but different `signals_hash`. This lets the grader group by inputs_hash
 * to ask "how does the ranker behave on this deal across signal changes?"
 */
export async function hashInputs(
  deal: RankableDeal,
  weights: FactorWeights,
  ironRole: IronRole,
  rankerVersion: string,
): Promise<string> {
  return await sha256Hex(
    canonicalJson({
      deal_id: deal.id,
      stage_id: deal.stageId,
      stage_probability: deal.stageProbability,
      amount: deal.amount,
      expected_close_on: deal.expectedCloseOn,
      next_follow_up_at: deal.nextFollowUpAt,
      last_activity_at: deal.lastActivityAt,
      deposit_status: deal.depositStatus,
      margin_check_status: deal.marginCheckStatus,
      iron_role: ironRole,
      weights,
      ranker_version: rankerVersion,
    }),
  );
}

/**
 * Hash the signal bundle the ranker observed for this deal at scoring time.
 * Two predictions with the same `inputs_hash` but different `signals_hash`
 * mean "same deal, different signal context — the ranker saw different
 * voice/anomaly/deposit/competitor data."
 */
export async function hashSignals(scored: ScoredDeal): Promise<string> {
  return await sha256Hex(
    canonicalJson({
      anomaly_types: [...scored.signals.anomalyTypes].sort(),
      anomaly_severity: scored.signals.anomalySeverity,
      voice_sentiment: scored.signals.recentVoiceSentiment,
      competitor_mentioned: scored.signals.competitorMentioned,
      pending_deposit: scored.signals.hasPendingDeposit,
      health_score: scored.signals.healthScore,
      blocker: scored.blocker,
      stalled: scored.state.isStalled,
      overdue: scored.state.isOverdueFollowUp,
    }),
  );
}

// ─── Trace step extraction (P0.8 atomic) ──────────────────────────────────

/**
 * Map a `ScoredDeal.factorContributions` array into the `trace_steps` jsonb
 * shape the Phase 0 Day 11 trace UI consumes. Each step records the factor
 * name, the ranker's contribution value, and the role weight that applied.
 */
export interface TraceStep {
  factor: string;
  value: number;
  weight: number;
}

export function extractTraceSteps(
  scored: ScoredDeal,
  weights: FactorWeights,
): TraceStep[] {
  return scored.factorContributions.map((c) => ({
    factor: c.factor,
    value: Number(c.value.toFixed(6)),
    weight: weights[c.factor],
  }));
}

// ─── Ledger row builder ───────────────────────────────────────────────────

/**
 * Shape of a single row inserted into the `qrm_predictions` table. Mirrors
 * migration 208's column list. Database-default columns (id, predicted_at,
 * trace_id default, created_at, updated_at, outcome*) are NOT included here
 * — let the database fill them in.
 */
export interface PredictionRowInsert {
  workspace_id: string;
  subject_type: "deal" | "contact" | "company" | "quote" | "demo" | "task";
  subject_id: string;
  prediction_kind: string;
  score: number;
  rationale: string[];
  rationale_hash: string;
  inputs_hash: string;
  signals_hash: string;
  model_source: "rules" | "rules+llm";
  trace_steps: TraceStep[];
}

interface BuildPredictionRowParams {
  workspaceId: string;
  scored: ScoredDeal;
  card: RecommendationCardPayload;
  predictionKind: string;
  weights: FactorWeights;
  ironRole: IronRole;
  rankerVersion: string;
  modelSource: "rules" | "rules+llm";
}

/**
 * Build a single insertable row from a ranker output card + the underlying
 * scored deal it came from. Computes all three hashes asynchronously.
 */
export async function buildPredictionRow(
  params: BuildPredictionRowParams,
): Promise<PredictionRowInsert> {
  const {
    workspaceId,
    scored,
    card,
    predictionKind,
    weights,
    ironRole,
    rankerVersion,
    modelSource,
  } = params;

  const [rationaleHash, inputsHash, signalsHash] = await Promise.all([
    hashRationale(card.rationale),
    hashInputs(scored.deal, weights, ironRole, rankerVersion),
    hashSignals(scored),
  ]);

  return {
    workspace_id: workspaceId,
    subject_type: card.entityType,
    subject_id: card.entityId,
    prediction_kind: predictionKind,
    score: card.score,
    rationale: card.rationale,
    rationale_hash: rationaleHash,
    inputs_hash: inputsHash,
    signals_hash: signalsHash,
    model_source: modelSource,
    trace_steps: extractTraceSteps(scored, weights),
  };
}

// ─── Batch builder (the function the edge function actually calls) ────────

interface BuildLedgerBatchParams {
  workspaceId: string;
  scoredByDealId: Map<string, ScoredDeal>;
  lanes: ActionLanesPayload;
  chief: AiChiefOfStaffPayload;
  weights: FactorWeights;
  ironRole: IronRole;
  rankerVersion: string;
  modelSource: "rules" | "rules+llm";
}

/**
 * Build the full set of ledger rows for one `/qrm/command` request. Iterates
 * lane cards + Chief-of-Staff picks, deduplicates by `(subject_id,
 * prediction_kind)` so a deal that appears in both a lane and a Chief-of-Staff
 * slot only gets one row per kind, and returns the array ready for batch
 * insert.
 *
 * Dedupe strategy: a deal can legitimately appear in multiple kinds (e.g.
 * `recommendation:revenue_at_risk` AND `chief_of_staff:biggest_risk`). Both
 * kinds get rows. But the same deal cannot appear twice under the same kind
 * — the second occurrence is dropped.
 */
export async function buildLedgerBatch(
  params: BuildLedgerBatchParams,
): Promise<PredictionRowInsert[]> {
  const seen = new Set<string>();
  const rows: PredictionRowInsert[] = [];

  const ingest = async (
    card: RecommendationCardPayload | null,
    kind: string,
  ): Promise<void> => {
    if (!card) return;
    const dedupeKey = `${card.entityId}:${kind}`;
    if (seen.has(dedupeKey)) return;
    const scored = params.scoredByDealId.get(card.entityId);
    if (!scored) {
      // Defensive: a card without a corresponding scored deal cannot be
      // ledgered (we have no factor contributions to trace). Skip silently.
      return;
    }
    const row = await buildPredictionRow({
      workspaceId: params.workspaceId,
      scored,
      card,
      predictionKind: kind,
      weights: params.weights,
      ironRole: params.ironRole,
      rankerVersion: params.rankerVersion,
      modelSource: params.modelSource,
    });
    rows.push(row);
    seen.add(dedupeKey);
  };

  // Lane cards first (deterministic order: ready → at_risk → blockers).
  for (const card of params.lanes.revenueReady) {
    await ingest(card, kindForLane("revenue_ready"));
  }
  for (const card of params.lanes.revenueAtRisk) {
    await ingest(card, kindForLane("revenue_at_risk"));
  }
  for (const card of params.lanes.blockers) {
    await ingest(card, kindForLane("blockers"));
  }

  // Chief-of-Staff picks. These often duplicate lane cards by entity_id
  // but the dedupe key includes the prediction_kind so they get their
  // own rows under the chief_of_staff:* kinds.
  await ingest(params.chief.bestMove, "chief_of_staff:best_move");
  await ingest(params.chief.biggestRisk, "chief_of_staff:biggest_risk");
  await ingest(params.chief.fastestPath, "chief_of_staff:fastest_path");

  return rows;
}

function kindForLane(lane: LaneKey): string {
  switch (lane) {
    case "revenue_ready":
      return "recommendation:revenue_ready";
    case "revenue_at_risk":
      return "recommendation:revenue_at_risk";
    case "blockers":
      return "recommendation:blockers";
  }
}

// ─── Ranker version constant ──────────────────────────────────────────────

/**
 * Bump this when the ranker's scoring formula changes meaningfully. Goes
 * into every `inputs_hash` so the grader can group predictions by ranker
 * version when computing accuracy.
 *
 * Format: 'YYYY-MM-DD.N' where N increments per change on the same day.
 * Slice 1 spine baseline: 2026-04-08.1
 * Day 4 P0.3 ledger ship: 2026-04-08.1 (no scoring change)
 */
export const QRM_RANKER_VERSION = "2026-04-08.1";
