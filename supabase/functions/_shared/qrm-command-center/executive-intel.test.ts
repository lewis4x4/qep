/**
 * Executive Intelligence Layer v1 — unit tests.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildExecutiveIntel,
  type ExecDealRow,
  type ProspectingKpiRow,
  type MarginDailyRow,
  type BranchRow,
} from "./executive-intel.ts";

const NOW = new Date("2026-04-09T12:00:00Z").getTime();
const DAY_MS = 86_400_000;

function makeDeal(overrides: Partial<ExecDealRow> = {}): ExecDealRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    amount: "amount" in overrides ? (overrides.amount as number | null) : 100_000,
    stage_id: overrides.stage_id ?? "s1",
    deposit_status: "deposit_status" in overrides ? (overrides.deposit_status as string | null) : null,
    margin_check_status: "margin_check_status" in overrides ? (overrides.margin_check_status as string | null) : null,
    margin_pct: "margin_pct" in overrides ? (overrides.margin_pct as number | null) : 15,
    expected_close_on: "expected_close_on" in overrides ? (overrides.expected_close_on as string | null) : "2026-05-01",
    last_activity_at: overrides.last_activity_at ?? new Date(NOW - 3 * DAY_MS).toISOString(),
    assigned_rep_id: overrides.assigned_rep_id ?? "rep-1",
    stage_probability: overrides.stage_probability ?? 0.5,
  };
}

function makeKpi(overrides: Partial<ProspectingKpiRow> = {}): ProspectingKpiRow {
  return {
    rep_id: overrides.rep_id ?? "rep-1",
    kpi_date: overrides.kpi_date ?? "2026-04-08",
    total_visits: overrides.total_visits ?? 5,
    positive_visits: overrides.positive_visits ?? 3,
    target_met: overrides.target_met ?? true,
    consecutive_days_met: overrides.consecutive_days_met ?? 3,
    opportunities_created: overrides.opportunities_created ?? 1,
    quotes_generated: overrides.quotes_generated ?? 1,
    profiles: overrides.profiles ?? { full_name: "John Smith" },
  };
}

// ─── Non-elevated ──────────────────────────────────────────────────────────

Deno.test("non-elevated returns empty payload", () => {
  const result = buildExecutiveIntel([makeDeal()], [makeKpi()], [], [], false, NOW);
  assertEquals(result.isElevatedView, false);
  assertEquals(result.topReps.length, 0);
  assertEquals(result.forecast.activeDeals, 0);
});

// ─── Forecast confidence ───────────────────────────────────────────────────

Deno.test("forecast: healthy pipeline scores Strong", () => {
  const deals = [
    makeDeal({ last_activity_at: new Date(NOW - 2 * DAY_MS).toISOString(), deposit_status: "verified" }),
    makeDeal({ last_activity_at: new Date(NOW - DAY_MS).toISOString() }),
  ];
  const result = buildExecutiveIntel(deals, [], [], [], true, NOW);
  assertEquals(result.forecast.confidenceLabel, "Strong");
  assertEquals(result.forecast.confidenceScore >= 70, true);
  assertEquals(result.forecast.activeDeals, 2);
});

Deno.test("forecast: stale deals with pending deposits score lower", () => {
  const deals = [
    makeDeal({ last_activity_at: new Date(NOW - 20 * DAY_MS).toISOString(), deposit_status: "pending" }),
    makeDeal({ last_activity_at: new Date(NOW - 18 * DAY_MS).toISOString(), deposit_status: "pending", expected_close_on: null }),
    makeDeal({ last_activity_at: new Date(NOW - 16 * DAY_MS).toISOString(), margin_check_status: "flagged" }),
  ];
  const result = buildExecutiveIntel(deals, [], [], [], true, NOW);
  assertEquals(result.forecast.confidenceScore < 70, true);
});

Deno.test("forecast: weighted pipeline computed correctly", () => {
  const deals = [
    makeDeal({ amount: 100_000, stage_probability: 0.5 }),
    makeDeal({ amount: 200_000, stage_probability: 0.3 }),
  ];
  const result = buildExecutiveIntel(deals, [], [], [], true, NOW);
  assertEquals(result.forecast.weightedPipeline, 110_000); // 50k + 60k
  assertEquals(result.forecast.rawPipeline, 300_000);
});

// ─── Rep performance ───────────────────────────────────────────────────────

Deno.test("rep performance aggregates and sorts by visits", () => {
  const kpis = [
    makeKpi({ rep_id: "r1", total_visits: 8, profiles: { full_name: "Rep A" } }),
    makeKpi({ rep_id: "r1", total_visits: 5, profiles: { full_name: "Rep A" } }),
    makeKpi({ rep_id: "r2", total_visits: 12, profiles: { full_name: "Rep B" } }),
  ];
  const result = buildExecutiveIntel([], kpis, [], [], true, NOW);
  assertEquals(result.topReps.length, 2);
  assertEquals(result.topReps[0].repName, "Rep A"); // 13 total
  assertEquals(result.topReps[0].visits7d, 13);
  assertEquals(result.topReps[1].repName, "Rep B"); // 12 total
});

// ─── Margin pressure ──────────────────────────────────────────────────────

Deno.test("margin pressure counts flagged deals", () => {
  const deals = [
    makeDeal({ margin_check_status: "flagged", amount: 200_000 }),
    makeDeal({ margin_check_status: "flagged", amount: 150_000 }),
    makeDeal({ margin_check_status: "passed" }),
  ];
  const margin: MarginDailyRow[] = [
    { day: "2026-04-08", margin_dollars: 5000, median_margin: 14.2, negative_margin_deal_count: 1 },
    { day: "2026-04-07", margin_dollars: 3000, median_margin: 12.0, negative_margin_deal_count: 0 },
  ];
  const result = buildExecutiveIntel(deals, [], margin, [], true, NOW);
  assertEquals(result.marginPressure.flaggedDealCount, 2);
  assertEquals(result.marginPressure.flaggedDealValue, 350_000);
  assertEquals(result.marginPressure.negativeMarginCloses30d, 1);
  assertEquals(result.marginPressure.medianMarginPct30d, 13.1); // avg of 14.2 and 12.0
});

// ─── Branch health ─────────────────────────────────────────────────────────

Deno.test("branch health returns active branches", () => {
  const branches: BranchRow[] = [
    { id: "b1", display_name: "Charleston", is_active: true },
    { id: "b2", display_name: "Beckley", is_active: true },
    { id: "b3", display_name: "Closed Branch", is_active: false },
  ];
  const result = buildExecutiveIntel([], [], [], branches, true, NOW);
  assertEquals(result.branchHealth.length, 2);
  assertEquals(result.branchHealth[0].branchName, "Charleston");
});

// ─── Empty data ────────────────────────────────────────────────────────────

Deno.test("empty data returns zero-value elevated payload", () => {
  const result = buildExecutiveIntel([], [], [], [], true, NOW);
  assertEquals(result.isElevatedView, true);
  assertEquals(result.forecast.activeDeals, 0);
  assertEquals(result.forecast.confidenceScore, 100); // no penalties
  assertEquals(result.topReps.length, 0);
  assertEquals(result.marginPressure.flaggedDealCount, 0);
});
