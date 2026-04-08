/**
 * Deno tests for the QRM Command Center ranker.
 *
 * Run with:
 *   deno test supabase/functions/_shared/qrm-command-center/ranking.test.ts
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  assignLane,
  buildPipelinePressure,
  classifyBlocker,
  classifyMetaStage,
  formatRationale,
  getDealSignalState,
  getRoleWeights,
  rankAndAssignLanes,
  rankChiefOfStaff,
  scoreDealForRecommendation,
  scoreDeals,
} from "./ranking.ts";
import type {
  ContactCompanyLookup,
  DealSignalBundle,
  RankableDeal,
} from "./ranking.ts";

const NOW = Date.parse("2026-04-07T12:00:00.000Z");

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

function emptySignals(): DealSignalBundle {
  return {
    anomalyTypes: [],
    anomalySeverity: null,
    recentVoiceSentiment: null,
    competitorMentioned: false,
    hasPendingDeposit: false,
    healthScore: null,
  };
}

const lookups: ContactCompanyLookup = {
  companies: new Map([["company-1", "Smith Logging"], ["company-2", "Jones Land Clearing"]]),
  contacts: new Map([["contact-1", "Marie Smith"], ["contact-2", "Tom Jones"]]),
};

// ─── getDealSignalState ────────────────────────────────────────────────────

Deno.test("getDealSignalState marks deals stalled past 7 days", () => {
  const deal = makeDeal({ lastActivityAt: "2026-03-25T00:00:00.000Z" });
  const state = getDealSignalState(deal, NOW);
  assertEquals(state.isStalled, true);
  assert(state.daysSinceLastActivity !== null && state.daysSinceLastActivity >= 7);
});

Deno.test("getDealSignalState flags overdue follow-ups", () => {
  const deal = makeDeal({ nextFollowUpAt: "2026-04-01T00:00:00.000Z" });
  const state = getDealSignalState(deal, NOW);
  assertEquals(state.isOverdueFollowUp, true);
});

// ─── classifyBlocker ───────────────────────────────────────────────────────

Deno.test("classifyBlocker returns deposit_missing only when both flags align", () => {
  const dealPending = makeDeal({ depositStatus: "pending" });
  const sigsNoActiveDeposit = emptySignals();
  assertEquals(classifyBlocker(dealPending, sigsNoActiveDeposit), null);

  const sigsWithDeposit = { ...emptySignals(), hasPendingDeposit: true };
  assertEquals(classifyBlocker(dealPending, sigsWithDeposit), "deposit_missing");
});

Deno.test("classifyBlocker returns margin_flagged when status is flagged", () => {
  const deal = makeDeal({ marginCheckStatus: "flagged" });
  assertEquals(classifyBlocker(deal, emptySignals()), "margin_flagged");
});

// ─── scoreDealForRecommendation ────────────────────────────────────────────

Deno.test("scoreDealForRecommendation produces higher scores for stalled overdue deals", () => {
  const calm = makeDeal({ id: "calm" });
  const heated = makeDeal({
    id: "heated",
    lastActivityAt: "2026-03-15T00:00:00.000Z",
    nextFollowUpAt: "2026-04-01T00:00:00.000Z",
  });
  const weights = getRoleWeights("iron_advisor");
  const ctx = { nowTime: NOW, maxOpenAmount: 100_000, weights };
  const calmScore = scoreDealForRecommendation(calm, emptySignals(), ctx).score;
  const heatedScore = scoreDealForRecommendation(heated, emptySignals(), ctx).score;
  assert(heatedScore > calmScore, `expected heated > calm; got ${heatedScore} vs ${calmScore}`);
});

Deno.test("scoreDealForRecommendation rationale never contains 'CRM'", () => {
  const deal = makeDeal({ lastActivityAt: "2026-03-15T00:00:00.000Z" });
  const ctx = { nowTime: NOW, maxOpenAmount: 100_000, weights: getRoleWeights("iron_advisor") };
  const result = scoreDealForRecommendation(deal, emptySignals(), ctx);
  for (const line of result.rationale) {
    assert(!/(^|[^A-Za-z])CRM(?![A-Za-z])/.test(line), `rationale leaked 'CRM': ${line}`);
  }
});

// ─── assignLane ────────────────────────────────────────────────────────────

Deno.test("assignLane routes blockers first", () => {
  const deal = makeDeal({ marginCheckStatus: "flagged" });
  const state = getDealSignalState(deal, NOW);
  const blocker = classifyBlocker(deal, emptySignals());
  assertEquals(assignLane(deal, emptySignals(), state, blocker, NOW), "blockers");
});

Deno.test("assignLane routes stalled deals to revenue_at_risk", () => {
  const deal = makeDeal({ lastActivityAt: "2026-03-15T00:00:00.000Z" });
  const state = getDealSignalState(deal, NOW);
  assertEquals(assignLane(deal, emptySignals(), state, null, NOW), "revenue_at_risk");
});

Deno.test("assignLane routes hot near-close deals to revenue_ready", () => {
  const deal = makeDeal({
    expectedCloseOn: "2026-04-10",
    stageProbability: 0.8,
    lastActivityAt: "2026-04-06T00:00:00.000Z",
  });
  const state = getDealSignalState(deal, NOW);
  assertEquals(assignLane(deal, emptySignals(), state, null, NOW), "revenue_ready");
});

// ─── rankAndAssignLanes + rankChiefOfStaff ────────────────────────────────

Deno.test("rankAndAssignLanes + rankChiefOfStaff produces a coherent picks set", () => {
  const deals: RankableDeal[] = [
    makeDeal({ id: "ready", expectedCloseOn: "2026-04-09", stageProbability: 0.7, amount: 50_000 }),
    makeDeal({ id: "stalled", lastActivityAt: "2026-03-15T00:00:00.000Z", amount: 30_000, expectedCloseOn: "2026-05-30" }),
    makeDeal({ id: "blocked", marginCheckStatus: "flagged", amount: 90_000, expectedCloseOn: "2026-04-25" }),
  ];
  const signals = new Map<string, DealSignalBundle>();
  const scored = scoreDeals(deals, signals, getRoleWeights("iron_advisor"), NOW);
  const lanes = rankAndAssignLanes(scored, lookups, NOW, "2026-04-07T12:00:00.000Z");

  assertEquals(lanes.blockers[0]?.entityId, "blocked");
  assertEquals(lanes.revenueReady[0]?.entityId, "ready");
  assertEquals(lanes.revenueAtRisk[0]?.entityId, "stalled");

  const chief = rankChiefOfStaff(scored, lanes);
  assertEquals(chief.bestMove?.entityId, "ready");
  assertEquals(chief.biggestRisk?.entityId, "blocked");
  assertEquals(chief.fastestPath?.entityId, "ready");
  assertEquals(chief.source, "rules");
});

// ─── classifyMetaStage ────────────────────────────────────────────────────

Deno.test("classifyMetaStage groups by sort_order", () => {
  assertEquals(
    classifyMetaStage({ id: "s1", name: "New Lead", sortOrder: 1, isClosedWon: false, isClosedLost: false }),
    "early_funnel",
  );
  assertEquals(
    classifyMetaStage({ id: "s2", name: "Quote Sent", sortOrder: 7, isClosedWon: false, isClosedLost: false }),
    "quote_validation",
  );
  assertEquals(
    classifyMetaStage({ id: "s3", name: "Funded", sortOrder: 13, isClosedWon: false, isClosedLost: false }),
    "close_funding",
  );
  assertEquals(
    classifyMetaStage({ id: "s4", name: "Closed Won", sortOrder: 21, isClosedWon: true, isClosedLost: false }),
    "post_sale",
  );
});

// ─── buildPipelinePressure ────────────────────────────────────────────────

Deno.test("buildPipelinePressure computes per-stage rollups and risk states", () => {
  const stages = [
    { id: "s-quote", name: "Quote Sent", sortOrder: 7, isClosedWon: false, isClosedLost: false },
    { id: "s-close", name: "Close & Fund", sortOrder: 13, isClosedWon: false, isClosedLost: false },
  ];
  const deals = [
    makeDeal({ id: "d1", stageId: "s-quote", lastActivityAt: "2026-03-15T00:00:00.000Z", amount: 40_000, stageProbability: 0.5 }),
    makeDeal({ id: "d2", stageId: "s-quote", lastActivityAt: "2026-04-06T00:00:00.000Z", amount: 60_000, stageProbability: 0.5 }),
    makeDeal({ id: "d3", stageId: "s-close", lastActivityAt: "2026-04-01T00:00:00.000Z", amount: 100_000, stageProbability: 0.85 }),
  ];
  const result = buildPipelinePressure(stages, deals, NOW);
  assertEquals(result.totals.openCount, 3);
  assertEquals(result.totals.openAmount, 200_000);
  const quoteBucket = result.stages.find((b) => b.id === "s-quote");
  assertEquals(quoteBucket?.count, 2);
  assert((quoteBucket?.stuckCount ?? 0) >= 1);
});

// ─── formatRationale ──────────────────────────────────────────────────────

Deno.test("formatRationale rewrites bare 'CRM' to 'QRM'", () => {
  assertEquals(formatRationale("Stalled in CRM for 9 days"), "Stalled in QRM for 9 days");
  assertEquals(formatRationale("Open CRM, then close"), "Open QRM, then close");
});

Deno.test("formatRationale leaves substrings like 'scrambler' alone", () => {
  assertEquals(formatRationale("scrambler running"), "scrambler running");
  assertEquals(formatRationale("microcrm not a token"), "microcrm not a token");
});
