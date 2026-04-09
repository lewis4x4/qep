/**
 * Deno tests for the QRM Command Center ranker.
 *
 * Run with:
 *   deno test supabase/functions/_shared/qrm-command-center/ranking.test.ts
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  assignLane,
  blendRoleWeights,
  buildPipelinePressure,
  classifyBlocker,
  classifyMetaStage,
  formatRationale,
  getDealSignalState,
  getRoleWeights,
  isBlendTeamScopeEligible,
  narrowRoleBlendRows,
  rankAndAssignLanes,
  rankChiefOfStaff,
  scoreDealForRecommendation,
  scoreDeals,
  scoreDealsWithBlend,
} from "./ranking.ts";
import { isIronRole } from "./types.ts";
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

// ─── Phase 0 P0.5 W2-2 — isIronRole shared narrower ──────────────────────

Deno.test("isIronRole accepts all four valid Iron roles", () => {
  assertEquals(isIronRole("iron_advisor"), true);
  assertEquals(isIronRole("iron_manager"), true);
  assertEquals(isIronRole("iron_woman"), true);
  assertEquals(isIronRole("iron_man"), true);
});

Deno.test("isIronRole rejects unrecognized strings", () => {
  assertEquals(isIronRole("iron_grandmaster"), false);
  assertEquals(isIronRole("manager"), false);
  assertEquals(isIronRole("garbage"), false);
});

Deno.test("isIronRole rejects null and undefined", () => {
  assertEquals(isIronRole(null), false);
  assertEquals(isIronRole(undefined), false);
});

Deno.test("isIronRole rejects empty string", () => {
  assertEquals(isIronRole(""), false);
});

// ─── Phase 0 P0.5 W2-5 — isBlendTeamScopeEligible (manager weight ≥ 0.5) ──

Deno.test("isBlendTeamScopeEligible: pure iron_manager (1.0) is eligible", () => {
  assertEquals(isBlendTeamScopeEligible([{ role: "iron_manager", weight: 1.0 }]), true);
});

Deno.test("isBlendTeamScopeEligible: pure iron_advisor (1.0) is NOT eligible", () => {
  assertEquals(isBlendTeamScopeEligible([{ role: "iron_advisor", weight: 1.0 }]), false);
});

Deno.test("isBlendTeamScopeEligible: 0.5 manager + 0.5 advisor is eligible (boundary)", () => {
  assertEquals(
    isBlendTeamScopeEligible([
      { role: "iron_manager", weight: 0.5 },
      { role: "iron_advisor", weight: 0.5 },
    ]),
    true,
  );
});

Deno.test("isBlendTeamScopeEligible: 0.49 manager + 0.51 advisor is NOT eligible (just below)", () => {
  assertEquals(
    isBlendTeamScopeEligible([
      { role: "iron_manager", weight: 0.49 },
      { role: "iron_advisor", weight: 0.51 },
    ]),
    false,
  );
});

Deno.test("isBlendTeamScopeEligible: two iron_manager rows summing to ≥ 0.5 is eligible", () => {
  // Edge case: a manager could theoretically appear twice in the blend
  // (e.g. covering two absences). The helper sums all manager weights.
  assertEquals(
    isBlendTeamScopeEligible([
      { role: "iron_manager", weight: 0.3 },
      { role: "iron_manager", weight: 0.3 },
    ]),
    true,
  );
});

Deno.test("isBlendTeamScopeEligible: empty blend is NOT eligible", () => {
  assertEquals(isBlendTeamScopeEligible([]), false);
});

// ─── Phase 0 P0.5 — blendRoleWeights + scoreDealsWithBlend ────────────────

Deno.test("blendRoleWeights with single 1.0 entry equals getRoleWeights for that role", () => {
  for (const role of ["iron_advisor", "iron_manager", "iron_woman", "iron_man"] as const) {
    const blended = blendRoleWeights([{ role, weight: 1.0 }]);
    const direct = getRoleWeights(role);
    assertEquals(blended, direct, `blend with single ${role} 1.0 should equal getRoleWeights(${role})`);
  }
});

Deno.test("blendRoleWeights with empty input falls back to ADVISOR_WEIGHTS", () => {
  const blended = blendRoleWeights([]);
  const direct = getRoleWeights("iron_advisor");
  assertEquals(blended, direct);
});

Deno.test("blendRoleWeights linearly combines per-role weights", () => {
  // Manager covering an advisor at 60/40 — every output factor must equal
  // 0.6 * MANAGER + 0.4 * ADVISOR for that factor.
  const blended = blendRoleWeights([
    { role: "iron_manager", weight: 0.6 },
    { role: "iron_advisor", weight: 0.4 },
  ]);
  const m = getRoleWeights("iron_manager");
  const a = getRoleWeights("iron_advisor");
  const eps = 1e-9;
  assert(Math.abs(blended.expectedRevenue - (m.expectedRevenue * 0.6 + a.expectedRevenue * 0.4)) < eps);
  assert(Math.abs(blended.urgencyFromCloseDate - (m.urgencyFromCloseDate * 0.6 + a.urgencyFromCloseDate * 0.4)) < eps);
  assert(Math.abs(blended.stalledPenalty - (m.stalledPenalty * 0.6 + a.stalledPenalty * 0.4)) < eps);
  assert(Math.abs(blended.overdueFollowUp - (m.overdueFollowUp * 0.6 + a.overdueFollowUp * 0.4)) < eps);
  assert(Math.abs(blended.blockerSeverity - (m.blockerSeverity * 0.6 + a.blockerSeverity * 0.4)) < eps);
  assert(Math.abs(blended.voiceHeat - (m.voiceHeat * 0.6 + a.voiceHeat * 0.4)) < eps);
  assert(Math.abs(blended.competitorPressure - (m.competitorPressure * 0.6 + a.competitorPressure * 0.4)) < eps);
  assert(Math.abs(blended.healthScoreTrend - (m.healthScoreTrend * 0.6 + a.healthScoreTrend * 0.4)) < eps);
});

Deno.test("blendRoleWeights drops invalid weights without crashing", () => {
  const blended = blendRoleWeights([
    { role: "iron_advisor", weight: 1.0 },
    // @ts-expect-error — testing runtime guard for non-numeric weight
    { role: "iron_manager", weight: "high" },
    { role: "iron_woman", weight: 0 }, // tombstone
    { role: "iron_man", weight: 1.5 }, // out of range
    { role: "iron_advisor", weight: NaN },
  ]);
  // Only the first row survives → blended should equal advisor weights.
  const direct = getRoleWeights("iron_advisor");
  assertEquals(blended, direct);
});

Deno.test("blendRoleWeights with all-invalid input falls back to ADVISOR_WEIGHTS", () => {
  const blended = blendRoleWeights([
    { role: "iron_advisor", weight: 0 },
    { role: "iron_manager", weight: -0.5 },
  ]);
  assertEquals(blended, getRoleWeights("iron_advisor"));
});

Deno.test("blendRoleWeights does NOT normalize sums (drift is a P0.6 concern)", () => {
  // Sum is 0.6, not 1.0. Result should NOT be scaled up to a "full" weight.
  const blended = blendRoleWeights([
    { role: "iron_manager", weight: 0.3 },
    { role: "iron_advisor", weight: 0.3 },
  ]);
  const m = getRoleWeights("iron_manager");
  const a = getRoleWeights("iron_advisor");
  const expectedExpectedRevenue = m.expectedRevenue * 0.3 + a.expectedRevenue * 0.3;
  const eps = 1e-9;
  assert(Math.abs(blended.expectedRevenue - expectedExpectedRevenue) < eps);
  // Sanity check: blended.expectedRevenue should be < (m.expectedRevenue) * 1.0
  assert(blended.expectedRevenue < m.expectedRevenue);
});

Deno.test("scoreDealsWithBlend matches scoreDeals when blend is single-role 1.0", () => {
  const deal = makeDeal({ lastActivityAt: "2026-03-15T00:00:00.000Z" });
  const signals = new Map<string, DealSignalBundle>();
  const bySingle = scoreDeals([deal], signals, getRoleWeights("iron_manager"), NOW);
  const byBlend = scoreDealsWithBlend([deal], signals, [{ role: "iron_manager", weight: 1.0 }], NOW);
  assertEquals(byBlend.length, bySingle.length);
  assertEquals(byBlend[0].score, bySingle[0].score);
  assertEquals(byBlend[0].deal.id, bySingle[0].deal.id);
});

// ─── narrowRoleBlendRows (Day 9 audit fix) ────────────────────────────────

Deno.test("narrowRoleBlendRows accepts a clean single-role-1.0 row", () => {
  const out = narrowRoleBlendRows([{ iron_role: "iron_advisor", weight: 1.0 }]);
  assertEquals(out.length, 1);
  assertEquals(out[0].role, "iron_advisor");
  assertEquals(out[0].weight, 1.0);
});

Deno.test("narrowRoleBlendRows coerces stringified numeric weights (postgres numeric → JSON string)", () => {
  // Supabase JS client returns Postgres NUMERIC columns as strings by default.
  // The narrower must coerce them to JS numbers without dropping the row.
  const out = narrowRoleBlendRows([{ iron_role: "iron_manager", weight: "0.6" as unknown as number }]);
  assertEquals(out.length, 1);
  assertEquals(out[0].weight, 0.6);
});

Deno.test("narrowRoleBlendRows drops rows with unrecognized iron_role", () => {
  const out = narrowRoleBlendRows([
    { iron_role: "iron_advisor", weight: 0.5 },
    { iron_role: "iron_grandmaster", weight: 0.5 },
    { iron_role: 42 as unknown as string, weight: 0.5 },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].role, "iron_advisor");
});

Deno.test("narrowRoleBlendRows drops rows with bad weights", () => {
  const out = narrowRoleBlendRows([
    { iron_role: "iron_advisor", weight: 0.5 },
    { iron_role: "iron_manager", weight: 0 }, // tombstone
    { iron_role: "iron_woman", weight: -0.1 },
    { iron_role: "iron_man", weight: 1.5 }, // out of range
    { iron_role: "iron_advisor", weight: NaN },
    { iron_role: "iron_manager", weight: "not-a-number" as unknown as number },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].role, "iron_advisor");
});

Deno.test("narrowRoleBlendRows handles empty / null / undefined input", () => {
  assertEquals(narrowRoleBlendRows([]).length, 0);
  assertEquals(narrowRoleBlendRows(null).length, 0);
  assertEquals(narrowRoleBlendRows(undefined).length, 0);
});

Deno.test("narrowRoleBlendRows skips null entries inside the array", () => {
  const out = narrowRoleBlendRows([
    null,
    undefined,
    { iron_role: "iron_advisor", weight: 1.0 },
  ]);
  assertEquals(out.length, 1);
});

Deno.test("narrowRoleBlendRows feeds blendRoleWeights end-to-end (60/40 blend)", () => {
  // The full audit-fix path: raw rows from the view → narrowed → blended.
  // Validates that the byte-identical ranking guarantee from blendRoleWeights
  // tests still holds when the rows come through the narrowing function.
  const rawRows = [
    { iron_role: "iron_manager", weight: "0.6" as unknown as number }, // numeric-as-string
    { iron_role: "iron_advisor", weight: 0.4 },
  ];
  const narrowed = narrowRoleBlendRows(rawRows);
  assertEquals(narrowed.length, 2);
  const blended = blendRoleWeights(narrowed);
  const m = getRoleWeights("iron_manager");
  const a = getRoleWeights("iron_advisor");
  const eps = 1e-9;
  assert(Math.abs(blended.expectedRevenue - (m.expectedRevenue * 0.6 + a.expectedRevenue * 0.4)) < eps);
});

Deno.test("scoreDealsWithBlend produces different ranking than single-role for a 60/40 blend", () => {
  // Construct two deals where the blocker_severity weight matters: a deal
  // with a margin-flagged blocker scores higher under MANAGER weights
  // (blockerSeverity=0.9) than ADVISOR weights (0.6). A 60/40 manager/advisor
  // blend should land between the two.
  const blockedDeal = makeDeal({
    id: "blocked",
    marginCheckStatus: "flagged",
    amount: 80_000,
  });
  const calmDeal = makeDeal({
    id: "calm",
    amount: 80_000,
    expectedCloseOn: "2026-04-09",
  });
  const signals = new Map<string, DealSignalBundle>();

  const advisorScores = scoreDeals([blockedDeal, calmDeal], signals, getRoleWeights("iron_advisor"), NOW);
  const managerScores = scoreDeals([blockedDeal, calmDeal], signals, getRoleWeights("iron_manager"), NOW);
  const blendScores = scoreDealsWithBlend(
    [blockedDeal, calmDeal],
    signals,
    [{ role: "iron_manager", weight: 0.6 }, { role: "iron_advisor", weight: 0.4 }],
    NOW,
  );

  const advisorBlocked = advisorScores.find((s) => s.deal.id === "blocked")!;
  const managerBlocked = managerScores.find((s) => s.deal.id === "blocked")!;
  const blendBlocked = blendScores.find((s) => s.deal.id === "blocked")!;

  // The blend score for the blocked deal must lie strictly between the
  // advisor-only and manager-only scores (manager weight is heavier on
  // blocker_severity, so manager > blend > advisor for this deal).
  assert(blendBlocked.score > advisorBlocked.score, "blend should give blockers more weight than advisor-only");
  assert(blendBlocked.score < managerBlocked.score, "blend should give blockers less weight than manager-only");
});
