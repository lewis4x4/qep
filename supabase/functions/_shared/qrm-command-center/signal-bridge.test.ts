/**
 * Deno tests for the QRM Command Center signal bridge adapter (Phase 0 P0.2).
 *
 * Run with:
 *   deno test supabase/functions/_shared/qrm-command-center/signal-bridge.test.ts
 *
 * The bridge adapter is the contract between the SQL view (`deal_signals`,
 * migration 207) and the ranker. These tests pin the contract: every code
 * path the Slice 1 inline iteration handled MUST be reproduced by the
 * adapter, against fixture rows shaped exactly like the view's projection.
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  reduceSignalsToBundles,
  type DealSignalRow,
} from "./signal-bridge.ts";

// 2026-04-08 12:00 UTC — fixture "now" so observed_at math is deterministic.
const NOW = Date.parse("2026-04-08T12:00:00.000Z");

function isoMsAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── empty input ──────────────────────────────────────────────────────────

Deno.test("reduceSignalsToBundles returns one empty bundle per deal id", () => {
  const result = reduceSignalsToBundles([], ["deal-a", "deal-b"], NOW);
  assertEquals(result.size, 2);
  const a = result.get("deal-a");
  assert(a !== undefined);
  assertEquals(a.anomalyTypes, []);
  assertEquals(a.anomalySeverity, null);
  assertEquals(a.recentVoiceSentiment, null);
  assertEquals(a.competitorMentioned, false);
  assertEquals(a.hasPendingDeposit, false);
  assertEquals(a.healthScore, null);
});

// ─── anomaly source ───────────────────────────────────────────────────────

Deno.test("anomaly rows accumulate alert_type and pick highest severity", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "anomaly",
      signal_subtype: "stalling_deal",
      severity: "medium",
      payload: { alert_type: "stalling_deal", severity: "medium" },
      observed_at: isoMsAgo(2 * DAY_MS),
      source_record_id: "anom-1",
    },
    {
      deal_id: "d1",
      signal_source: "anomaly",
      signal_subtype: "overdue_follow_up",
      severity: "high",
      payload: { alert_type: "overdue_follow_up", severity: "high" },
      observed_at: isoMsAgo(1 * DAY_MS),
      source_record_id: "anom-2",
    },
  ];
  const result = reduceSignalsToBundles(rows, ["d1"], NOW);
  const bundle = result.get("d1");
  assert(bundle !== undefined);
  assertEquals(bundle.anomalyTypes, ["stalling_deal", "overdue_follow_up"]);
  assertEquals(bundle.anomalySeverity, "high");
});

Deno.test("critical anomaly severity beats high", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "anomaly",
      signal_subtype: "pricing_anomaly",
      severity: "high",
      payload: null,
      observed_at: isoMsAgo(0),
      source_record_id: "anom-1",
    },
    {
      deal_id: "d1",
      signal_source: "anomaly",
      signal_subtype: "pipeline_risk",
      severity: "critical",
      payload: null,
      observed_at: isoMsAgo(0),
      source_record_id: "anom-2",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.anomalySeverity, "critical");
});

// ─── voice source ─────────────────────────────────────────────────────────

Deno.test("most-recent voice row wins for sentiment", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "negative",
      severity: null,
      payload: {},
      observed_at: isoMsAgo(5 * DAY_MS),
      source_record_id: "v-1",
    },
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "positive",
      severity: null,
      payload: {},
      observed_at: isoMsAgo(1 * DAY_MS),
      source_record_id: "v-2",
    },
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "neutral",
      severity: null,
      payload: {},
      observed_at: isoMsAgo(3 * DAY_MS),
      source_record_id: "v-3",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.recentVoiceSentiment, "positive");
});

Deno.test("voice rows older than 14 days are dropped", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "negative",
      severity: null,
      payload: {},
      observed_at: isoMsAgo(20 * DAY_MS),
      source_record_id: "v-old",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.recentVoiceSentiment, null);
});

Deno.test("voice payload competitor_mentions array sets the flag", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "neutral",
      severity: null,
      payload: { competitor_mentions: ["Deere", "CAT"] },
      observed_at: isoMsAgo(2 * DAY_MS),
      source_record_id: "v-1",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.competitorMentioned, true);
});

Deno.test("voice payload empty competitor_mentions does NOT set the flag", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "positive",
      severity: null,
      payload: { competitor_mentions: [] },
      observed_at: isoMsAgo(1 * DAY_MS),
      source_record_id: "v-1",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.competitorMentioned, false);
});

// ─── deposit source ───────────────────────────────────────────────────────

Deno.test("deposit row with status=pending sets hasPendingDeposit", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "deposit",
      signal_subtype: "pending",
      severity: "high",
      payload: { status: "pending" },
      observed_at: isoMsAgo(0),
      source_record_id: "dep-1",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.hasPendingDeposit, true);
});

Deno.test("deposit row with status=verified does NOT set hasPendingDeposit", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "deposit",
      signal_subtype: "verified",
      severity: "low",
      payload: { status: "verified" },
      observed_at: isoMsAgo(0),
      source_record_id: "dep-1",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.hasPendingDeposit, false);
});

// ─── competitor source ────────────────────────────────────────────────────

Deno.test("competitor row presence sets competitorMentioned", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "competitor",
      signal_subtype: "Deere",
      severity: "high",
      payload: { competitor_name: "Deere", sentiment: "negative" },
      observed_at: isoMsAgo(7 * DAY_MS),
      source_record_id: "cm-1",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.competitorMentioned, true);
});

// ─── multi-source aggregation (the realistic case) ────────────────────────

Deno.test("multi-source aggregation produces a coherent bundle per deal", () => {
  const rows: DealSignalRow[] = [
    // d1 — anomaly + voice positive + pending deposit
    {
      deal_id: "d1",
      signal_source: "anomaly",
      signal_subtype: "stalling_deal",
      severity: "medium",
      payload: null,
      observed_at: isoMsAgo(3 * DAY_MS),
      source_record_id: "a-1",
    },
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "positive",
      severity: null,
      payload: { competitor_mentions: [] },
      observed_at: isoMsAgo(1 * DAY_MS),
      source_record_id: "v-1",
    },
    {
      deal_id: "d1",
      signal_source: "deposit",
      signal_subtype: "pending",
      severity: "high",
      payload: null,
      observed_at: isoMsAgo(0),
      source_record_id: "d-1",
    },
    // d2 — competitor + voice negative
    {
      deal_id: "d2",
      signal_source: "competitor",
      signal_subtype: "CAT",
      severity: "high",
      payload: null,
      observed_at: isoMsAgo(6 * DAY_MS),
      source_record_id: "c-1",
    },
    {
      deal_id: "d2",
      signal_source: "voice",
      signal_subtype: "negative",
      severity: null,
      payload: {},
      observed_at: isoMsAgo(2 * DAY_MS),
      source_record_id: "v-2",
    },
  ];
  const result = reduceSignalsToBundles(rows, ["d1", "d2", "d3"], NOW);

  const d1 = result.get("d1")!;
  assertEquals(d1.anomalyTypes, ["stalling_deal"]);
  assertEquals(d1.anomalySeverity, "medium");
  assertEquals(d1.recentVoiceSentiment, "positive");
  assertEquals(d1.hasPendingDeposit, true);
  assertEquals(d1.competitorMentioned, false);

  const d2 = result.get("d2")!;
  assertEquals(d2.anomalyTypes, []);
  assertEquals(d2.anomalySeverity, null);
  assertEquals(d2.recentVoiceSentiment, "negative");
  assertEquals(d2.hasPendingDeposit, false);
  assertEquals(d2.competitorMentioned, true);

  const d3 = result.get("d3")!;
  assertEquals(d3.anomalyTypes, []);
  assertEquals(d3.competitorMentioned, false);
  assertEquals(d3.hasPendingDeposit, false);
});

// ─── defensive: row referencing unrequested deal id is still kept ─────────

Deno.test("row for unrequested deal is preserved in result map", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "unexpected-deal",
      signal_source: "anomaly",
      signal_subtype: "pipeline_risk",
      severity: "high",
      payload: null,
      observed_at: isoMsAgo(0),
      source_record_id: "a-1",
    },
  ];
  const result = reduceSignalsToBundles(rows, ["d1"], NOW);
  // Both deals are in the map: the requested one (empty) and the unexpected
  // one (with the signal). Adapter does not silently drop signals.
  assertEquals(result.size, 2);
  assertEquals(result.get("d1")?.anomalyTypes, []);
  assertEquals(result.get("unexpected-deal")?.anomalyTypes, ["pipeline_risk"]);
});

// ─── invalid sentiment is ignored, not crashed on ─────────────────────────

Deno.test("voice row with invalid sentiment value is ignored cleanly", () => {
  const rows: DealSignalRow[] = [
    {
      deal_id: "d1",
      signal_source: "voice",
      signal_subtype: "very_happy", // not in the validator's allow list
      severity: null,
      payload: {},
      observed_at: isoMsAgo(1 * DAY_MS),
      source_record_id: "v-1",
    },
  ];
  const bundle = reduceSignalsToBundles(rows, ["d1"], NOW).get("d1")!;
  assertEquals(bundle.recentVoiceSentiment, null);
});
