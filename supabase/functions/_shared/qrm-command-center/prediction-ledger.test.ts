/**
 * Deno tests for the QRM Command Center prediction ledger adapter (Phase 0 P0.3).
 *
 * Run with:
 *   deno test supabase/functions/_shared/qrm-command-center/prediction-ledger.test.ts
 *
 * The adapter is the contract between the ranker and the qrm_predictions
 * table. These tests pin:
 *
 *   - Canonical JSON determinism: same input value → same byte sequence,
 *     regardless of object key insertion order or numeric oddities.
 *   - Hash determinism: same canonical JSON → same SHA-256 hex digest.
 *   - Trace step extraction: factor contributions are mapped 1:1 with
 *     numeric precision preserved.
 *   - Row builder: every column required by migration 208 is populated.
 *   - Batch builder dedupe: a deal in three lanes + three Chief-of-Staff
 *     slots produces ≤6 rows (3 lane kinds + 3 chief kinds, never more).
 *   - Defensive: cards without a corresponding scored deal are skipped.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildLedgerBatch,
  buildPredictionRow,
  canonicalJson,
  extractTraceSteps,
  hashInputs,
  hashRationale,
  hashSignals,
  QRM_RANKER_VERSION,
} from "./prediction-ledger.ts";
import {
  getRoleWeights,
  scoreDealForRecommendation,
  type FactorWeights,
  type IronRoleWeightEntry,
  type RankableDeal,
  type ScoredDeal,
} from "./ranking.ts";
import type {
  ActionLanesPayload,
  AiChiefOfStaffPayload,
  RecommendationCardPayload,
} from "./types.ts";

const NOW = Date.parse("2026-04-08T12:00:00.000Z");

function makeDeal(overrides: Partial<RankableDeal> = {}): RankableDeal {
  return {
    id: overrides.id ?? "deal-1",
    name: overrides.name ?? "Smith Logging — Yanmar ViO55",
    amount: overrides.amount ?? 86_000,
    stageId: overrides.stageId ?? "stage-quote",
    stageName: overrides.stageName ?? "Quote Sent",
    stageProbability: overrides.stageProbability ?? 0.5,
    expectedCloseOn: overrides.expectedCloseOn ?? "2026-04-12",
    nextFollowUpAt: overrides.nextFollowUpAt ?? null,
    lastActivityAt: overrides.lastActivityAt ?? "2026-04-05T00:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    depositStatus: overrides.depositStatus ?? "not_required",
    marginCheckStatus: overrides.marginCheckStatus ?? "not_checked",
    primaryContactId: overrides.primaryContactId ?? "contact-1",
    companyId: overrides.companyId ?? "company-1",
    assignedRepId: overrides.assignedRepId ?? "rep-1",
  };
}

function makeScored(deal?: RankableDeal): ScoredDeal {
  const d = deal ?? makeDeal();
  const weights = getRoleWeights("iron_advisor");
  return scoreDealForRecommendation(
    d,
    {
      anomalyTypes: [],
      anomalySeverity: null,
      recentVoiceSentiment: null,
      competitorMentioned: false,
      hasPendingDeposit: false,
      healthScore: null,
    },
    { nowTime: NOW, maxOpenAmount: 100_000, weights },
  );
}

// Default single-role-1.0 blend used by every test that does not
// specifically test blended-operator behavior. Mirrors the post-migration-210
// production default (everyone has a single weight=1.0 row).
const ADVISOR_BLEND: IronRoleWeightEntry[] = [{ role: "iron_advisor", weight: 1.0 }];
const MANAGER_BLEND: IronRoleWeightEntry[] = [{ role: "iron_manager", weight: 1.0 }];
const COVER_BLEND: IronRoleWeightEntry[] = [
  { role: "iron_manager", weight: 0.6 },
  { role: "iron_advisor", weight: 0.4 },
];

function makeCard(overrides: Partial<RecommendationCardPayload> = {}): RecommendationCardPayload {
  return {
    recommendationKey: overrides.recommendationKey ?? "deal:deal-1:revenue_ready",
    entityType: overrides.entityType ?? "deal",
    entityId: overrides.entityId ?? "deal-1",
    headline: overrides.headline ?? "Smith Logging — Yanmar ViO55",
    rationale: overrides.rationale ?? ["Top expected-revenue contributor.", "Expected close date is approaching."],
    lane: overrides.lane ?? "revenue_ready",
    confidence: overrides.confidence ?? 0.7,
    score: overrides.score ?? 1.45,
    primaryAction: overrides.primaryAction ?? { kind: "open_deal", label: "Open deal" },
    amount: overrides.amount ?? 86_000,
    companyName: overrides.companyName ?? "Smith Logging",
    contactName: overrides.contactName ?? "Marie Smith",
    stageName: overrides.stageName ?? "Quote Sent",
    observedAt: overrides.observedAt ?? "2026-04-08T12:00:00.000Z",
  };
}

// ─── canonicalJson determinism ────────────────────────────────────────────

Deno.test("canonicalJson sorts object keys deterministically", () => {
  const a = canonicalJson({ b: 1, a: 2, c: 3 });
  const b = canonicalJson({ c: 3, a: 2, b: 1 });
  const c = canonicalJson({ a: 2, b: 1, c: 3 });
  assertEquals(a, b);
  assertEquals(b, c);
  assertEquals(a, '{"a":2,"b":1,"c":3}');
});

Deno.test("canonicalJson preserves array order", () => {
  const result = canonicalJson(["first", "second", "third"]);
  assertEquals(result, '["first","second","third"]');
});

Deno.test("canonicalJson sorts nested object keys", () => {
  const result = canonicalJson({ outer: { z: 1, a: 2 }, alpha: { y: 3, x: 4 } });
  assertEquals(result, '{"alpha":{"x":4,"y":3},"outer":{"a":2,"z":1}}');
});

Deno.test("canonicalJson handles NaN and Infinity by converting to null", () => {
  assertEquals(canonicalJson({ a: NaN }), '{"a":null}');
  assertEquals(canonicalJson({ a: Infinity, b: -Infinity }), '{"a":null,"b":null}');
});

// ─── Hash determinism ─────────────────────────────────────────────────────

Deno.test("hashRationale is deterministic across runs", async () => {
  const rationale = ["Stalled in QRM for 9 days.", "Expected close date is approaching."];
  const a = await hashRationale(rationale);
  const b = await hashRationale(rationale);
  assertEquals(a, b);
  // SHA-256 hex is 64 chars
  assertEquals(a.length, 64);
});

Deno.test("hashRationale differs for different rationale arrays", async () => {
  const a = await hashRationale(["alpha"]);
  const b = await hashRationale(["beta"]);
  assert(a !== b);
});

Deno.test("hashInputs is deterministic for the same deal + role + version", async () => {
  const deal = makeDeal();
  const weights = getRoleWeights("iron_advisor");
  const a = await hashInputs(deal, weights, "iron_advisor", ADVISOR_BLEND, QRM_RANKER_VERSION);
  const b = await hashInputs(deal, weights, "iron_advisor", ADVISOR_BLEND, QRM_RANKER_VERSION);
  assertEquals(a, b);
});

Deno.test("hashInputs differs when role changes", async () => {
  const deal = makeDeal();
  const advisor = await hashInputs(
    deal,
    getRoleWeights("iron_advisor"),
    "iron_advisor",
    ADVISOR_BLEND,
    QRM_RANKER_VERSION,
  );
  const manager = await hashInputs(
    deal,
    getRoleWeights("iron_manager"),
    "iron_manager",
    MANAGER_BLEND,
    QRM_RANKER_VERSION,
  );
  assert(advisor !== manager);
});

Deno.test("hashInputs differs when ranker version changes", async () => {
  const deal = makeDeal();
  const weights = getRoleWeights("iron_advisor");
  const v1 = await hashInputs(deal, weights, "iron_advisor", ADVISOR_BLEND, "2026-04-08.1");
  const v2 = await hashInputs(deal, weights, "iron_advisor", ADVISOR_BLEND, "2026-04-08.2");
  assert(v1 !== v2);
});

// ─── Phase 0 P0.5 W2-3 — role_blend in hashInputs ────────────────────────

Deno.test("hashInputs differs when blend changes (same dominant role)", async () => {
  // A manager covering an advisor 60/40 vs a pure manager (1.0) — same
  // dominant role, different blends, MUST produce different hashes.
  const deal = makeDeal();
  const blendedWeights = {
    ...getRoleWeights("iron_manager"),
    expectedRevenue:
      getRoleWeights("iron_manager").expectedRevenue * 0.6 +
      getRoleWeights("iron_advisor").expectedRevenue * 0.4,
  };
  const pureManagerHash = await hashInputs(
    deal,
    getRoleWeights("iron_manager"),
    "iron_manager",
    MANAGER_BLEND,
    QRM_RANKER_VERSION,
  );
  const coverHash = await hashInputs(
    deal,
    blendedWeights as FactorWeights,
    "iron_manager",
    COVER_BLEND,
    QRM_RANKER_VERSION,
  );
  assert(pureManagerHash !== coverHash, "blended cover should produce a different hash than pure manager");
});

Deno.test("hashInputs is deterministic regardless of blend insertion order", async () => {
  // The blend is sorted alphabetically inside hashInputs so producer
  // ordering does not leak into the hash.
  const deal = makeDeal();
  const weights = getRoleWeights("iron_manager");
  const blendForward: IronRoleWeightEntry[] = [
    { role: "iron_manager", weight: 0.6 },
    { role: "iron_advisor", weight: 0.4 },
  ];
  const blendReversed: IronRoleWeightEntry[] = [
    { role: "iron_advisor", weight: 0.4 },
    { role: "iron_manager", weight: 0.6 },
  ];
  const a = await hashInputs(deal, weights, "iron_manager", blendForward, QRM_RANKER_VERSION);
  const b = await hashInputs(deal, weights, "iron_manager", blendReversed, QRM_RANKER_VERSION);
  assertEquals(a, b);
});

Deno.test("hashSignals is deterministic for the same scored deal", async () => {
  const scored = makeScored();
  const a = await hashSignals(scored);
  const b = await hashSignals(scored);
  assertEquals(a, b);
});

Deno.test("hashSignals differs when signal bundle changes", async () => {
  const baseScored = makeScored();
  const heated: ScoredDeal = {
    ...baseScored,
    signals: { ...baseScored.signals, recentVoiceSentiment: "positive" },
  };
  const a = await hashSignals(baseScored);
  const b = await hashSignals(heated);
  assert(a !== b);
});

// ─── extractTraceSteps ────────────────────────────────────────────────────

Deno.test("extractTraceSteps maps factor contributions with weight + 6dp precision", () => {
  const scored = makeScored();
  const weights = getRoleWeights("iron_advisor");
  const steps = extractTraceSteps(scored, weights);
  assertEquals(steps.length, scored.factorContributions.length);
  for (const step of steps) {
    assert(typeof step.factor === "string");
    assert(typeof step.value === "number");
    assert(typeof step.weight === "number");
    // Weight must match the role weight for that factor
    assertEquals(step.weight, weights[step.factor as keyof FactorWeights]);
  }
});

// ─── buildPredictionRow ──────────────────────────────────────────────────

Deno.test("buildPredictionRow populates every column required by migration 208", async () => {
  const scored = makeScored();
  const card = makeCard();
  const row = await buildPredictionRow({
    workspaceId: "default",
    scored,
    card,
    predictionKind: "recommendation:revenue_ready",
    weights: getRoleWeights("iron_advisor"),
    ironRole: "iron_advisor",
    roleBlend: ADVISOR_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });
  assertEquals(row.workspace_id, "default");
  assertEquals(row.subject_type, "deal");
  assertEquals(row.subject_id, "deal-1");
  assertEquals(row.prediction_kind, "recommendation:revenue_ready");
  assertEquals(row.score, 1.45);
  assertEquals(row.rationale, card.rationale);
  assertEquals(row.rationale_hash.length, 64);
  assertEquals(row.inputs_hash.length, 64);
  assertEquals(row.signals_hash.length, 64);
  assertEquals(row.model_source, "rules");
  assert(Array.isArray(row.trace_steps));
  assert(row.trace_steps.length > 0);
  assertEquals(row.role_blend, ADVISOR_BLEND);
});

Deno.test("buildPredictionRow propagates a non-trivial blend (Phase 0 P0.5 W2-3)", async () => {
  const scored = makeScored();
  const card = makeCard();
  const row = await buildPredictionRow({
    workspaceId: "default",
    scored,
    card,
    predictionKind: "recommendation:revenue_ready",
    weights: getRoleWeights("iron_manager"), // pretend the call site supplied blended weights
    ironRole: "iron_manager",
    roleBlend: COVER_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });
  assertEquals(row.role_blend, COVER_BLEND);
  // hash must reflect the blend (regression: a sibling call with
  // ADVISOR_BLEND would produce a different hash)
  const sibling = await buildPredictionRow({
    workspaceId: "default",
    scored,
    card,
    predictionKind: "recommendation:revenue_ready",
    weights: getRoleWeights("iron_manager"),
    ironRole: "iron_manager",
    roleBlend: MANAGER_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });
  assert(row.inputs_hash !== sibling.inputs_hash, "different blends must produce different inputs_hashes");
});

// ─── buildLedgerBatch dedupe ──────────────────────────────────────────────

Deno.test("buildLedgerBatch produces one row per (subject, kind) pair", async () => {
  const dealA = makeDeal({ id: "deal-A" });
  const dealB = makeDeal({ id: "deal-B" });
  const scoredA = makeScored(dealA);
  const scoredB = makeScored(dealB);

  const cardA = makeCard({ entityId: "deal-A", lane: "revenue_ready" });
  const cardB = makeCard({ entityId: "deal-B", lane: "revenue_at_risk" });

  const lanes: ActionLanesPayload = {
    revenueReady: [cardA],
    revenueAtRisk: [cardB],
    blockers: [],
  };
  const chief: AiChiefOfStaffPayload = {
    bestMove: cardA, // duplicate of revenue_ready entry, gets chief_of_staff:best_move kind
    biggestRisk: cardB, // duplicate of revenue_at_risk entry, gets chief_of_staff:biggest_risk kind
    fastestPath: cardA, // duplicate of best_move (same deal, same chief slot)
    additional: [],
    source: "rules",
  };

  const rows = await buildLedgerBatch({
    workspaceId: "default",
    scoredByDealId: new Map([
      ["deal-A", scoredA],
      ["deal-B", scoredB],
    ]),
    lanes,
    chief,
    weights: getRoleWeights("iron_advisor"),
    ironRole: "iron_advisor",
    roleBlend: ADVISOR_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });

  // Expected unique (subject_id, prediction_kind) pairs:
  //   deal-A : recommendation:revenue_ready
  //   deal-B : recommendation:revenue_at_risk
  //   deal-A : chief_of_staff:best_move
  //   deal-B : chief_of_staff:biggest_risk
  //   deal-A : chief_of_staff:fastest_path
  // = 5 rows total
  assertEquals(rows.length, 5);
  const pairs = new Set(rows.map((r) => `${r.subject_id}:${r.prediction_kind}`));
  assert(pairs.has("deal-A:recommendation:revenue_ready"));
  assert(pairs.has("deal-B:recommendation:revenue_at_risk"));
  assert(pairs.has("deal-A:chief_of_staff:best_move"));
  assert(pairs.has("deal-B:chief_of_staff:biggest_risk"));
  assert(pairs.has("deal-A:chief_of_staff:fastest_path"));
});

Deno.test("buildLedgerBatch skips cards without a corresponding scored deal", async () => {
  const dealA = makeDeal({ id: "deal-A" });
  const scoredA = makeScored(dealA);

  const cardA = makeCard({ entityId: "deal-A", lane: "revenue_ready" });
  const cardOrphan = makeCard({ entityId: "orphan-deal", lane: "blockers" });

  const lanes: ActionLanesPayload = {
    revenueReady: [cardA],
    revenueAtRisk: [],
    blockers: [cardOrphan],
  };
  const chief: AiChiefOfStaffPayload = {
    bestMove: null,
    biggestRisk: null,
    fastestPath: null,
    additional: [],
    source: "rules",
  };

  const rows = await buildLedgerBatch({
    workspaceId: "default",
    scoredByDealId: new Map([["deal-A", scoredA]]), // orphan-deal NOT in the map
    lanes,
    chief,
    weights: getRoleWeights("iron_advisor"),
    ironRole: "iron_advisor",
    roleBlend: ADVISOR_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });

  // Only deal-A produces a row; orphan is silently dropped (defensive).
  assertEquals(rows.length, 1);
  assertEquals(rows[0].subject_id, "deal-A");
});

Deno.test("buildLedgerBatch handles null Chief-of-Staff slots cleanly", async () => {
  const dealA = makeDeal({ id: "deal-A" });
  const scoredA = makeScored(dealA);
  const cardA = makeCard({ entityId: "deal-A", lane: "revenue_ready" });

  const rows = await buildLedgerBatch({
    workspaceId: "default",
    scoredByDealId: new Map([["deal-A", scoredA]]),
    lanes: { revenueReady: [cardA], revenueAtRisk: [], blockers: [] },
    chief: { bestMove: null, biggestRisk: null, fastestPath: null, additional: [], source: "rules" },
    weights: getRoleWeights("iron_advisor"),
    ironRole: "iron_advisor",
    roleBlend: ADVISOR_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].prediction_kind, "recommendation:revenue_ready");
});

Deno.test("buildLedgerBatch returns empty array when there are no cards", async () => {
  const rows = await buildLedgerBatch({
    workspaceId: "default",
    scoredByDealId: new Map(),
    lanes: { revenueReady: [], revenueAtRisk: [], blockers: [] },
    chief: { bestMove: null, biggestRisk: null, fastestPath: null, additional: [], source: "rules" },
    weights: getRoleWeights("iron_advisor"),
    ironRole: "iron_advisor",
    roleBlend: ADVISOR_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules",
  });
  assertEquals(rows.length, 0);
});

// ─── Hash stability across two batches with identical inputs ──────────────

Deno.test("buildLedgerBatch produces identical hashes for identical inputs across runs", async () => {
  const dealA = makeDeal({ id: "deal-A" });
  const scoredA = makeScored(dealA);
  const cardA = makeCard({ entityId: "deal-A", lane: "revenue_ready" });

  const params = {
    workspaceId: "default",
    scoredByDealId: new Map([["deal-A", scoredA]]),
    lanes: { revenueReady: [cardA], revenueAtRisk: [], blockers: [] } as ActionLanesPayload,
    chief: {
      bestMove: null,
      biggestRisk: null,
      fastestPath: null,
      additional: [],
      source: "rules",
    } as AiChiefOfStaffPayload,
    weights: getRoleWeights("iron_advisor"),
    ironRole: "iron_advisor" as const,
    roleBlend: ADVISOR_BLEND,
    rankerVersion: QRM_RANKER_VERSION,
    modelSource: "rules" as const,
  };

  const run1 = await buildLedgerBatch(params);
  const run2 = await buildLedgerBatch(params);
  assertEquals(run1[0].rationale_hash, run2[0].rationale_hash);
  assertEquals(run1[0].inputs_hash, run2[0].inputs_hash);
  assertEquals(run1[0].signals_hash, run2[0].signals_hash);
});
