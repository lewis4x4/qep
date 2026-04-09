/**
 * Revenue Reality Board — unit tests.
 *
 * Pure-function tests against fixture data. No DB, no IO.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRevenueRealityBoard, getEffectiveProbability } from "./revenue-reality.ts";
import type { DealSignalBundle, RankableDeal } from "./ranking.ts";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const NOW = new Date("2026-04-09T12:00:00Z").getTime();
const DAY_MS = 86_400_000;

function makeDeal(overrides: Partial<RankableDeal> = {}): RankableDeal {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Test Deal",
    amount: overrides.amount ?? 100_000,
    stageId: overrides.stageId ?? "stage-1",
    stageName: overrides.stageName ?? "Qualification",
    stageProbability: overrides.stageProbability ?? 0.5,
    expectedCloseOn: overrides.expectedCloseOn ?? null,
    nextFollowUpAt: overrides.nextFollowUpAt ?? null,
    lastActivityAt: overrides.lastActivityAt ?? new Date(NOW - 2 * DAY_MS).toISOString(),
    createdAt: overrides.createdAt ?? new Date(NOW - 30 * DAY_MS).toISOString(),
    depositStatus: overrides.depositStatus ?? null,
    marginCheckStatus: overrides.marginCheckStatus ?? null,
    primaryContactId: null,
    companyId: null,
    assignedRepId: null,
    dgeScore: overrides.dgeScore ?? null,
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

function signalsMap(entries: Array<[string, DealSignalBundle]>): Map<string, DealSignalBundle> {
  return new Map(entries);
}

// ─── getEffectiveProbability tests ─────────────────────────────────────────

Deno.test("getEffectiveProbability: returns stageProbability when no DGE", () => {
  const { prob, dgeUsed } = getEffectiveProbability(0.6, 100_000, null);
  assertEquals(prob, 0.6);
  assertEquals(dgeUsed, false);
});

Deno.test("getEffectiveProbability: blends when DGE available", () => {
  // dgeScore=80000, amount=100000 → dgeProb=0.8
  // blend = 0.6*0.5 + 0.4*0.8 = 0.30 + 0.32 = 0.62
  const { prob, dgeUsed } = getEffectiveProbability(0.5, 100_000, 80_000);
  assertEquals(Math.round(prob * 100) / 100, 0.62);
  assertEquals(dgeUsed, true);
});

Deno.test("getEffectiveProbability: clamps to 1 when dgeScore > amount", () => {
  // dgeScore=200000, amount=100000 → dgeProb=clamp(2.0)=1.0
  // blend = 0.6*0.5 + 0.4*1.0 = 0.30 + 0.40 = 0.70
  const { prob, dgeUsed } = getEffectiveProbability(0.5, 100_000, 200_000);
  assertEquals(prob, 0.7);
  assertEquals(dgeUsed, true);
});

Deno.test("getEffectiveProbability: falls back when amount is 0", () => {
  const { prob, dgeUsed } = getEffectiveProbability(0.5, 0, 80_000);
  assertEquals(prob, 0.5);
  assertEquals(dgeUsed, false);
});

Deno.test("getEffectiveProbability: falls back when dgeScore is 0", () => {
  const { prob, dgeUsed } = getEffectiveProbability(0.5, 100_000, 0);
  assertEquals(prob, 0.5);
  assertEquals(dgeUsed, false);
});

// ─── buildRevenueRealityBoard tests ────────────────────────────────────────

Deno.test("empty deals returns zero-value payload", () => {
  const result = buildRevenueRealityBoard([], new Map(), NOW);
  assertEquals(result.openPipeline, 0);
  assertEquals(result.weightedRevenue, 0);
  assertEquals(result.closable7d, 0);
  assertEquals(result.closable30d, 0);
  assertEquals(result.atRisk, 0);
  assertEquals(result.marginAtRisk, 0);
  assertEquals(result.stalledQuotes.count, 0);
  assertEquals(result.blockedByType.length, 0);
  assertEquals(result.dgeAvailability, "none");
});

Deno.test("openPipeline sums all deal amounts", () => {
  const deals = [
    makeDeal({ amount: 50_000 }),
    makeDeal({ amount: 75_000 }),
    makeDeal({ amount: 25_000 }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  assertEquals(result.openPipeline, 150_000);
});

Deno.test("weightedRevenue without DGE equals sum(amount * stageProbability)", () => {
  const deals = [
    makeDeal({ amount: 100_000, stageProbability: 0.5 }),
    makeDeal({ amount: 200_000, stageProbability: 0.3 }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  // 100000*0.5 + 200000*0.3 = 50000 + 60000 = 110000
  assertEquals(result.weightedRevenue, 110_000);
  assertEquals(result.dgeAvailability, "none");
});

Deno.test("weightedRevenue with DGE blends correctly", () => {
  const deals = [
    makeDeal({ amount: 100_000, stageProbability: 0.5, dgeScore: 80_000 }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  // effectiveProb = 0.6*0.5 + 0.4*(80000/100000) = 0.30 + 0.32 = 0.62
  // weightedRevenue = 100000 * 0.62 = 62000
  assertEquals(result.weightedRevenue, 62_000);
  assertEquals(result.dgeBlendedDealCount, 1);
  assertEquals(result.dgeAvailability, "full");
});

Deno.test("closable7d includes only deals within 7-day window with prob >= 0.5", () => {
  const closeSoon = new Date(NOW + 3 * DAY_MS).toISOString(); // 3 days from now
  const closeLater = new Date(NOW + 20 * DAY_MS).toISOString(); // 20 days from now

  const deals = [
    makeDeal({ amount: 100_000, stageProbability: 0.6, expectedCloseOn: closeSoon }),
    makeDeal({ amount: 200_000, stageProbability: 0.6, expectedCloseOn: closeLater }),
    makeDeal({ amount: 50_000, stageProbability: 0.3, expectedCloseOn: closeSoon }), // prob < 0.5
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  // Only deal 1 qualifies for 7d: 100000 * 0.6 = 60000
  assertEquals(result.closable7d, 60_000);
  // Both deal 1 and deal 2 qualify for 30d: 60000 + 200000*0.6 = 60000 + 120000 = 180000
  assertEquals(result.closable30d, 180_000);
});

Deno.test("atRisk accumulates stalled deals", () => {
  const deals = [
    makeDeal({
      amount: 100_000,
      stageProbability: 0.5,
      lastActivityAt: new Date(NOW - 10 * DAY_MS).toISOString(), // 10 days = stalled (>7d)
    }),
    makeDeal({
      amount: 200_000,
      stageProbability: 0.5,
      lastActivityAt: new Date(NOW - 2 * DAY_MS).toISOString(), // 2 days = active
    }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  // Only deal 1 is at risk: 100000 * 0.5 = 50000
  assertEquals(result.atRisk, 50_000);
});

Deno.test("atRisk accumulates overdue follow-up deals", () => {
  const deals = [
    makeDeal({
      amount: 80_000,
      stageProbability: 0.4,
      nextFollowUpAt: new Date(NOW - 1 * DAY_MS).toISOString(), // overdue
    }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  assertEquals(result.atRisk, 32_000); // 80000 * 0.4
});

Deno.test("marginAtRisk sums flagged deal values", () => {
  const deals = [
    makeDeal({ amount: 150_000, marginCheckStatus: "flagged" }),
    makeDeal({ amount: 100_000, marginCheckStatus: "passed" }),
    makeDeal({ amount: 50_000, marginCheckStatus: "flagged" }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  assertEquals(result.marginAtRisk, 200_000);
});

Deno.test("stalledQuotes counts deals with >14 days no activity", () => {
  const deals = [
    makeDeal({
      amount: 100_000,
      lastActivityAt: new Date(NOW - 20 * DAY_MS).toISOString(), // 20 days = stalled quote
    }),
    makeDeal({
      amount: 50_000,
      lastActivityAt: new Date(NOW - 10 * DAY_MS).toISOString(), // 10 days = not stalled quote
    }),
    makeDeal({
      amount: 75_000,
      lastActivityAt: new Date(NOW - 15 * DAY_MS).toISOString(), // 15 days = stalled quote
    }),
  ];
  const result = buildRevenueRealityBoard(deals, new Map(), NOW);
  assertEquals(result.stalledQuotes.count, 2);
  assertEquals(result.stalledQuotes.totalValue, 175_000);
});

Deno.test("blockedByType groups by blocker kind", () => {
  const d1 = makeDeal({ amount: 100_000, depositStatus: "pending" });
  const d2 = makeDeal({ amount: 80_000, marginCheckStatus: "flagged" });
  const d3 = makeDeal({ amount: 60_000, depositStatus: "pending" });

  const signals = signalsMap([
    [d1.id, { ...emptySignals(), hasPendingDeposit: true }],
    [d2.id, emptySignals()],
    [d3.id, { ...emptySignals(), hasPendingDeposit: true }],
  ]);

  const result = buildRevenueRealityBoard([d1, d2, d3], signals, NOW);
  assertEquals(result.blockedByType.length, 2);

  const deposit = result.blockedByType.find((b) => b.type === "deposit_missing");
  const margin = result.blockedByType.find((b) => b.type === "margin_flagged");
  assertEquals(deposit?.count, 2);
  assertEquals(deposit?.totalValue, 160_000);
  assertEquals(margin?.count, 1);
  assertEquals(margin?.totalValue, 80_000);
});

Deno.test("dgeAvailability reflects coverage levels", () => {
  // All have DGE
  const allDge = [
    makeDeal({ dgeScore: 50_000 }),
    makeDeal({ dgeScore: 60_000 }),
  ];
  assertEquals(buildRevenueRealityBoard(allDge, new Map(), NOW).dgeAvailability, "full");

  // Some have DGE
  const someDge = [
    makeDeal({ dgeScore: 50_000 }),
    makeDeal({ dgeScore: null }),
  ];
  assertEquals(buildRevenueRealityBoard(someDge, new Map(), NOW).dgeAvailability, "partial");

  // None have DGE
  const noDge = [
    makeDeal({ dgeScore: null }),
    makeDeal({ dgeScore: null }),
  ];
  assertEquals(buildRevenueRealityBoard(noDge, new Map(), NOW).dgeAvailability, "none");
});
