/**
 * QRM Command Center — Signal Bridge adapter (Phase 0 P0.2).
 *
 * Pure functions that map rows from the `deal_signals` SQL view (migration
 * 207) into the `Map<dealId, DealSignalBundle>` shape the ranker consumes.
 *
 * Replaces the inline iteration the Slice 1 edge function does today (5
 * parallel Promise.all queries + manual per-source iteration). Same input
 * data, same output bundle, same observable behavior — but the query path is
 * one read against the view instead of four separate selects, and the
 * source-row → bundle mapping is testable in isolation.
 *
 * Deno-compatible. No DB clients, no IO. Tested against fixture rows.
 *
 * Note: `crm_contacts` and `crm_companies` lookups for headline display
 * still happen as separate queries in the edge function — they are NOT
 * signal data, they are display lookups. This adapter only handles the
 * four signal sources unified by the view.
 */

import type { DealSignalBundle } from "./ranking.ts";

// ─── View row shape ────────────────────────────────────────────────────────

/** Mirrors the projection of the `deal_signals` view in migration 207. */
export interface DealSignalRow {
  deal_id: string;
  signal_source: "anomaly" | "voice" | "deposit" | "competitor";
  signal_subtype: string | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  payload: Record<string, unknown> | null;
  observed_at: string;
  source_record_id: string;
}

// ─── Bundle factory ────────────────────────────────────────────────────────

function emptyBundle(): DealSignalBundle {
  return {
    anomalyTypes: [],
    anomalySeverity: null,
    recentVoiceSentiment: null,
    competitorMentioned: false,
    hasPendingDeposit: false,
    healthScore: null,
  };
}

// ─── Severity ranking (mirrors edge function inline rank) ─────────────────

const SEVERITY_RANK: Record<NonNullable<DealSignalRow["severity"]>, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function isHigherSeverity(
  candidate: NonNullable<DealSignalRow["severity"]>,
  existing: DealSignalBundle["anomalySeverity"],
): boolean {
  if (existing === null) return true;
  return SEVERITY_RANK[candidate] > SEVERITY_RANK[existing];
}

// ─── Voice sentiment validation ───────────────────────────────────────────

function isValidSentiment(
  value: unknown,
): value is "positive" | "neutral" | "negative" {
  return value === "positive" || value === "neutral" || value === "negative";
}

// ─── Time-windowed voice filter ───────────────────────────────────────────

const VOICE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function isWithinVoiceLookback(observedAt: string, nowMs: number): boolean {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= VOICE_LOOKBACK_MS;
}

// ─── Pending deposit predicate ────────────────────────────────────────────

const PENDING_DEPOSIT_STATUSES = new Set(["pending", "requested", "received"]);

// ─── Main reducer ─────────────────────────────────────────────────────────

/**
 * Reduce a list of `deal_signals` view rows into the per-deal bundle map
 * the ranker consumes. The output map's key set is the union of the input
 * `dealIds` (so every deal has a bundle, even one with no signals) plus any
 * additional deal_ids found in the view rows themselves (defensive — should
 * always be a subset of `dealIds` since the caller filters by deal id).
 *
 * Equivalent to the inline iteration in qrm-command-center/index.ts before
 * P0.2 (which read 5 parallel result arrays and built the same map). The
 * Day 3 refactor replaces the 5-query inline path with one query against
 * the view, then calls this single function.
 *
 * @param rows  view rows from `select * from deal_signals where deal_id = any($1)`
 * @param dealIds  deal ids that should appear in the result map regardless of signal presence
 * @param nowMs  current time in ms (default Date.now()) — voice signals older than 14 days are dropped
 */
export function reduceSignalsToBundles(
  rows: readonly DealSignalRow[],
  dealIds: readonly string[],
  nowMs: number = Date.now(),
): Map<string, DealSignalBundle> {
  const bundles = new Map<string, DealSignalBundle>();
  for (const id of dealIds) {
    bundles.set(id, emptyBundle());
  }

  // Track most-recent voice observation per deal so the latest sentiment wins
  // — matches the Slice 1 inline iteration's "rows ordered desc, first non-null
  // sentiment wins" semantics, but works on an unordered input by picking
  // the row with the latest `observed_at` per deal.
  const latestVoiceObserved = new Map<string, number>();

  for (const row of rows) {
    let bundle = bundles.get(row.deal_id);
    if (!bundle) {
      // Defensive: a row referencing a deal not in the requested set
      // (shouldn't happen if the edge function filters correctly, but
      // we don't drop signals silently).
      bundle = emptyBundle();
      bundles.set(row.deal_id, bundle);
    }

    switch (row.signal_source) {
      case "anomaly": {
        const alertType = row.signal_subtype ?? "unknown";
        bundle.anomalyTypes.push(alertType);
        if (row.severity && isHigherSeverity(row.severity, bundle.anomalySeverity)) {
          bundle.anomalySeverity = row.severity;
        }
        break;
      }

      case "voice": {
        // Time-window filter — drop voice older than 14 days regardless of
        // what the SQL query returned.
        if (!isWithinVoiceLookback(row.observed_at, nowMs)) break;

        const observedMs = Date.parse(row.observed_at);
        if (!Number.isFinite(observedMs)) break;

        // Latest voice row wins for sentiment.
        const previousLatest = latestVoiceObserved.get(row.deal_id) ?? -Infinity;
        if (observedMs > previousLatest && isValidSentiment(row.signal_subtype)) {
          bundle.recentVoiceSentiment = row.signal_subtype;
          latestVoiceObserved.set(row.deal_id, observedMs);
        }

        // Competitor mention from voice payload (top-level array) — set the
        // flag if any voice row in the window carries mentions. The dedicated
        // `competitor` source set below is the more reliable path; this is
        // the legacy path for voice rows that contain mentions but never
        // triggered a competitive_mentions row.
        const mentions = row.payload?.["competitor_mentions"];
        if (Array.isArray(mentions) && mentions.length > 0) {
          bundle.competitorMentioned = true;
        }
        break;
      }

      case "deposit": {
        if (
          row.signal_subtype !== null &&
          PENDING_DEPOSIT_STATUSES.has(row.signal_subtype)
        ) {
          bundle.hasPendingDeposit = true;
        }
        break;
      }

      case "competitor": {
        // Any competitor row from the view sets the flag. The view already
        // filters to rows with a real voice_capture link, so a row's mere
        // presence is the signal.
        bundle.competitorMentioned = true;
        break;
      }
    }
  }

  return bundles;
}
