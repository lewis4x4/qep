/**
 * Deno tests for the QRM Honesty Calibration probe scorer functions (P0.6).
 *
 * Run with:
 *   deno test supabase/functions/_shared/qrm-honesty/probes.test.ts
 *
 * Pure-function tests — no DB, no network. Each test constructs fixture
 * rows and asserts the scorer produces the expected observations.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  scoreCloseImminentNoActivity,
  scoreClosedLostNoReason,
  scoreDecayThresholdProximity,
  scoreDepositStateMismatch,
  scoreHighProbNoActivity,
  scoreMarginPassedNoPct,
  scoreProtectedAccountGaming,
  scoreRetroactiveActivity,
  type ClosedLostDealRow,
  type DealWithStageRow,
  type DepositMismatchRow,
  type MarginMismatchRow,
  type RetroactiveActivityRow,
} from "./probes.ts";

const NOW = Date.parse("2026-04-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

// ─── Probe 1: High probability, no activity 14 days ─────────────────────────

Deno.test("scoreHighProbNoActivity flags deals with prob >= 70 and no activity 14d+", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-1", name: "Stale hot deal", last_activity_at: daysAgo(20),
      expected_close_on: null, assigned_rep_id: "rep-1",
      stage_probability: 80, workspace_id: "default",
    },
  ];
  const obs = scoreHighProbNoActivity(rows, NOW);
  assertEquals(obs.length, 1);
  assertEquals(obs[0].observation_type, "high_prob_no_activity_14d");
  assertEquals(obs[0].entity_id, "deal-1");
  assert(obs[0].discrepancy_score > 0 && obs[0].discrepancy_score <= 1);
});

Deno.test("scoreHighProbNoActivity skips deals with recent activity", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-2", name: "Active deal", last_activity_at: daysAgo(5),
      expected_close_on: null, assigned_rep_id: "rep-1",
      stage_probability: 90, workspace_id: "default",
    },
  ];
  assertEquals(scoreHighProbNoActivity(rows, NOW).length, 0);
});

Deno.test("scoreHighProbNoActivity skips deals with low probability", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-3", name: "Low prob stale", last_activity_at: daysAgo(30),
      expected_close_on: null, assigned_rep_id: "rep-1",
      stage_probability: 30, workspace_id: "default",
    },
  ];
  assertEquals(scoreHighProbNoActivity(rows, NOW).length, 0);
});

Deno.test("scoreHighProbNoActivity discrepancy_score clamps at 1.0 for 30+ day gaps", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-4", name: "Very stale", last_activity_at: daysAgo(60),
      expected_close_on: null, assigned_rep_id: "rep-1",
      stage_probability: 75, workspace_id: "default",
    },
  ];
  const obs = scoreHighProbNoActivity(rows, NOW);
  assertEquals(obs[0].discrepancy_score, 1.0);
});

// ─── Probe 2: Close imminent, no activity 14 days ───────────────────────────

Deno.test("scoreCloseImminentNoActivity flags deals closing within 7d with stale activity", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-5", name: "Closing soon", last_activity_at: daysAgo(16),
      expected_close_on: new Date(NOW + 3 * DAY_MS).toISOString().split("T")[0],
      assigned_rep_id: "rep-2", stage_probability: 50, workspace_id: "default",
    },
  ];
  const obs = scoreCloseImminentNoActivity(rows, NOW);
  assertEquals(obs.length, 1);
  assertEquals(obs[0].observation_type, "close_imminent_no_activity");
});

Deno.test("scoreCloseImminentNoActivity skips deals closing beyond 7 days", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-6", name: "Far close", last_activity_at: daysAgo(20),
      expected_close_on: new Date(NOW + 15 * DAY_MS).toISOString().split("T")[0],
      assigned_rep_id: "rep-2", stage_probability: 50, workspace_id: "default",
    },
  ];
  assertEquals(scoreCloseImminentNoActivity(rows, NOW).length, 0);
});

Deno.test("scoreCloseImminentNoActivity skips deals with recent activity", () => {
  const rows: DealWithStageRow[] = [
    {
      id: "deal-7", name: "Active close", last_activity_at: daysAgo(3),
      expected_close_on: new Date(NOW + 2 * DAY_MS).toISOString().split("T")[0],
      assigned_rep_id: "rep-2", stage_probability: 50, workspace_id: "default",
    },
  ];
  assertEquals(scoreCloseImminentNoActivity(rows, NOW).length, 0);
});

// ─── Probe 3: Closed-lost, no loss reason ────────────────────────────────────

Deno.test("scoreClosedLostNoReason flags deals with blank loss_reason", () => {
  const rows: ClosedLostDealRow[] = [
    { id: "deal-8", name: "Lost deal", loss_reason: null, assigned_rep_id: "rep-3", workspace_id: "default" },
    { id: "deal-9", name: "Also lost", loss_reason: "", assigned_rep_id: "rep-3", workspace_id: "default" },
    { id: "deal-10", name: "Documented loss", loss_reason: "Went with competitor", assigned_rep_id: "rep-3", workspace_id: "default" },
  ];
  const obs = scoreClosedLostNoReason(rows);
  assertEquals(obs.length, 2); // deal-8 + deal-9
  assertEquals(obs[0].discrepancy_score, 1.0);
  assertEquals(obs[1].discrepancy_score, 1.0);
});

Deno.test("scoreClosedLostNoReason returns empty for deals with reasons", () => {
  const rows: ClosedLostDealRow[] = [
    { id: "deal-11", name: "Good loss", loss_reason: "Budget cut", assigned_rep_id: "rep-3", workspace_id: "default" },
  ];
  assertEquals(scoreClosedLostNoReason(rows).length, 0);
});

// ─── Probe 4: Deposit state mismatch ─────────────────────────────────────────

Deno.test("scoreDepositStateMismatch flags deals marked verified without deposit row", () => {
  const rows: DepositMismatchRow[] = [
    { id: "deal-12", name: "Phantom deposit", deposit_status: "verified", has_verified_deposit: false, assigned_rep_id: "rep-4", workspace_id: "default" },
  ];
  const obs = scoreDepositStateMismatch(rows);
  assertEquals(obs.length, 1);
  assertEquals(obs[0].discrepancy_score, 1.0);
  assertEquals(obs[0].observation_type, "deposit_state_mismatch");
});

Deno.test("scoreDepositStateMismatch skips deals with matching deposit row", () => {
  const rows: DepositMismatchRow[] = [
    { id: "deal-13", name: "Good deposit", deposit_status: "verified", has_verified_deposit: true, assigned_rep_id: "rep-4", workspace_id: "default" },
  ];
  assertEquals(scoreDepositStateMismatch(rows).length, 0);
});

Deno.test("scoreDepositStateMismatch skips deals not in verified status", () => {
  const rows: DepositMismatchRow[] = [
    { id: "deal-14", name: "Pending deposit", deposit_status: "pending", has_verified_deposit: false, assigned_rep_id: "rep-4", workspace_id: "default" },
  ];
  assertEquals(scoreDepositStateMismatch(rows).length, 0);
});

// ─── Probe 5: Margin passed with null percentage ─────────────────────────────

Deno.test("scoreMarginPassedNoPct flags deals with passed status but null margin_pct", () => {
  const rows: MarginMismatchRow[] = [
    { id: "deal-15", name: "Ghost margin", margin_check_status: "passed", margin_pct: null, assigned_rep_id: "rep-5", workspace_id: "default" },
    { id: "deal-16", name: "Approved ghost", margin_check_status: "approved_by_manager", margin_pct: null, assigned_rep_id: "rep-5", workspace_id: "default" },
  ];
  const obs = scoreMarginPassedNoPct(rows);
  assertEquals(obs.length, 2);
  assertEquals(obs[0].discrepancy_score, 1.0);
});

Deno.test("scoreMarginPassedNoPct skips deals with margin_pct populated", () => {
  const rows: MarginMismatchRow[] = [
    { id: "deal-17", name: "Good margin", margin_check_status: "passed", margin_pct: 15.5, assigned_rep_id: "rep-5", workspace_id: "default" },
  ];
  assertEquals(scoreMarginPassedNoPct(rows).length, 0);
});

// ─── Probe 6: Retroactive activity ──────────────────────────────────────────

Deno.test("scoreRetroactiveActivity flags activities with > 48h gap", () => {
  const createdAt = new Date(NOW - 2 * HOUR_MS).toISOString(); // 2h ago
  const occurredAt = new Date(NOW - 2 * HOUR_MS + 72 * HOUR_MS).toISOString(); // occurred_at is 72h AFTER created_at
  const rows: RetroactiveActivityRow[] = [
    { id: "act-1", occurred_at: occurredAt, created_at: createdAt, created_by: "rep-6", deal_id: "deal-20", workspace_id: "default" },
  ];
  const obs = scoreRetroactiveActivity(rows);
  assertEquals(obs.length, 1);
  assertEquals(obs[0].observation_type, "retroactive_activity");
  assert(obs[0].discrepancy_score > 0);
});

Deno.test("scoreRetroactiveActivity skips activities within 48h gap", () => {
  const createdAt = new Date(NOW - 2 * HOUR_MS).toISOString();
  const occurredAt = new Date(NOW - 2 * HOUR_MS + 24 * HOUR_MS).toISOString(); // only 24h after creation
  const rows: RetroactiveActivityRow[] = [
    { id: "act-2", occurred_at: occurredAt, created_at: createdAt, created_by: "rep-6", deal_id: "deal-21", workspace_id: "default" },
  ];
  assertEquals(scoreRetroactiveActivity(rows).length, 0);
});

Deno.test("scoreRetroactiveActivity discrepancy_score clamps at 1.0 for 168h+ gaps", () => {
  const createdAt = new Date(NOW).toISOString();
  const occurredAt = new Date(NOW + 200 * HOUR_MS).toISOString(); // 200h gap
  const rows: RetroactiveActivityRow[] = [
    { id: "act-3", occurred_at: occurredAt, created_at: createdAt, created_by: "rep-6", deal_id: null, workspace_id: "default" },
  ];
  const obs = scoreRetroactiveActivity(rows);
  assertEquals(obs[0].discrepancy_score, 1.0);
});

// ─── Probe 7 + 8: Stubs ─────────────────────────────────────────────────────

Deno.test("scoreDecayThresholdProximity stub returns empty array", () => {
  assertEquals(scoreDecayThresholdProximity().length, 0);
});

Deno.test("scoreProtectedAccountGaming stub returns empty array", () => {
  assertEquals(scoreProtectedAccountGaming().length, 0);
});
