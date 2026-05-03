/**
 * Deal Cycle Velocity API — descriptive analytics over quote lifecycle
 * timestamps. First predictive-ish admin surface.
 *
 * Slice 12. The roadmap originally scoped this against `qb_quotes_audit`
 * (migration 288), but `qb_quotes` itself is empty today — the Quote
 * Builder V2 still writes to `quote_packages`. So this first version
 * computes directly from columns that already exist:
 *
 *   Stage 1 — draft → sent:   quote_packages.sent_at - created_at
 *   Stage 2 — sent → viewed:  quote_packages.viewed_at - sent_at
 *   Stage 3 — sent → outcome: qb_quote_outcomes.captured_at - sent_at
 *
 * Materialized view + cron are out of scope for this MVP — the query
 * window is 90 days and the aggregation runs client-side on <10k rows,
 * which is well inside budget. Move to a view if the admin page gets
 * slow enough to notice.
 */

import { supabase } from "@/lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────

export interface VelocityFilter {
  /** Days back to include. Null = all-time. Default: 90. */
  daysBack?: number | null;
}

export type QuoteStatus = "draft" | "ready" | "sent" | "viewed" | "accepted" | "rejected" | "expired";

export interface QuoteVelocityRow {
  id: string;
  customer: string | null;
  status: QuoteStatus;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  /** Seconds between created and sent. Null if never sent. */
  draftToSentSec: number | null;
  /** Seconds between sent and viewed. Null if sent but never viewed. */
  sentToViewedSec: number | null;
  /** Seconds between sent and outcome captured. Null if still in flight. */
  sentToOutcomeSec: number | null;
  /** The captured outcome classification (won/lost/expired/skipped), if any. */
  outcome: string | null;
  /** Age of the quote in its current stage, seconds. Used for stalled detection. */
  currentStageAgeSec: number;
}

export interface StageStats {
  /** Count of quotes with a measurable stage duration. */
  n: number;
  medianSec: number | null;
  p90Sec: number | null;
  /** Simple mean for context — median is the primary summary. */
  meanSec: number | null;
}

export interface VelocitySummary {
  totalQuotes: number;
  inFlight: number;
  won: number;
  lost: number;
  draftToSent: StageStats;
  sentToViewed: StageStats;
  sentToOutcome: StageStats;
}

const QUOTE_STATUSES = ["draft", "ready", "sent", "viewed", "accepted", "rejected", "expired"] as const;
const QUOTE_STATUS_SET: ReadonlySet<string> = new Set(QUOTE_STATUSES);

interface NormalizedQuotePackageRow {
  id: string;
  status: QuoteStatus;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  customer_name: string | null;
  customer_company: string | null;
}

interface NormalizedOutcomeRow {
  quote_package_id: string;
  outcome: string;
  captured_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === "string" && QUOTE_STATUS_SET.has(value);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

export function normalizeQuoteVelocityPackageRows(value: unknown): NormalizedQuotePackageRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const createdAt = isValidDateString(row.created_at) ? row.created_at : null;
    if (!id || !createdAt || !isQuoteStatus(row.status)) return [];
    return [{
      id,
      status: row.status,
      created_at: createdAt,
      sent_at: isValidDateString(row.sent_at) ? row.sent_at : null,
      viewed_at: isValidDateString(row.viewed_at) ? row.viewed_at : null,
      customer_name: nullableString(row.customer_name),
      customer_company: nullableString(row.customer_company),
    }];
  });
}

export function normalizeQuoteVelocityOutcomeRows(value: unknown): NormalizedOutcomeRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const quotePackageId = requiredString(row.quote_package_id);
    const outcome = requiredString(row.outcome);
    const capturedAt = isValidDateString(row.captured_at) ? row.captured_at : null;
    return quotePackageId && outcome && capturedAt
      ? [{ quote_package_id: quotePackageId, outcome, captured_at: capturedAt }]
      : [];
  });
}

// ── Query ────────────────────────────────────────────────────────────────

function cutoffIso(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

/**
 * Fetches quotes + latest outcomes in two parallel queries, joins client-side.
 * Returns a unified row per quote with derived stage durations.
 */
export async function getQuoteVelocityRows(
  opts: VelocityFilter = {},
): Promise<QuoteVelocityRow[]> {
  const daysBack = opts.daysBack === undefined ? 90 : opts.daysBack;
  const now = Date.now();

  let quotesQ = supabase
    .from("quote_packages")
    .select("id, status, created_at, sent_at, viewed_at, customer_name, customer_company")
    .order("created_at", { ascending: false });
  if (daysBack != null) {
    quotesQ = quotesQ.gte("created_at", cutoffIso(daysBack));
  }

  const [quotesRes, outcomesRes] = await Promise.all([
    quotesQ,
    supabase
      .from("qb_quote_outcomes")
      .select("quote_package_id, outcome, captured_at")
      .order("captured_at", { ascending: false }),
  ]);

  const quotes = normalizeQuoteVelocityPackageRows(quotesRes.data);
  const outcomeRows = normalizeQuoteVelocityOutcomeRows(outcomesRes.data);

  // Latest outcome per quote (outcomeRows already sorted desc)
  const latestOutcome = new Map<string, { outcome: string; captured_at: string }>();
  for (const o of outcomeRows) {
    if (!latestOutcome.has(o.quote_package_id)) {
      latestOutcome.set(o.quote_package_id, {
        outcome: o.outcome,
        captured_at: o.captured_at,
      });
    }
  }

  return quotes.map((q) => {
    const createdMs = new Date(q.created_at).getTime();
    const sentMs    = q.sent_at ? new Date(q.sent_at).getTime() : null;
    const viewedMs  = q.viewed_at ? new Date(q.viewed_at).getTime() : null;
    const oc        = latestOutcome.get(q.id);
    const closedMs  = oc ? new Date(oc.captured_at).getTime() : null;

    const draftToSentSec   = sentMs != null ? Math.max(0, Math.round((sentMs - createdMs) / 1000)) : null;
    const sentToViewedSec  = sentMs != null && viewedMs != null
      ? Math.max(0, Math.round((viewedMs - sentMs) / 1000))
      : null;
    const sentToOutcomeSec = sentMs != null && closedMs != null
      ? Math.max(0, Math.round((closedMs - sentMs) / 1000))
      : null;

    // Age in current stage — from whichever most-recent event we know about
    const stageAnchorMs = closedMs ?? viewedMs ?? sentMs ?? createdMs;
    const currentStageAgeSec = Math.max(0, Math.round((now - stageAnchorMs) / 1000));

    return {
      id: q.id,
      customer: q.customer_company || q.customer_name || null,
      status: q.status,
      created_at: q.created_at,
      sent_at: q.sent_at,
      viewed_at: q.viewed_at,
      draftToSentSec,
      sentToViewedSec,
      sentToOutcomeSec,
      outcome: oc?.outcome ?? null,
      currentStageAgeSec,
    };
  });
}

// ── Pure aggregation ─────────────────────────────────────────────────────

/** Stage-duration percentile math — pure, exported for tests. */
export function computeStageStats(durationsSec: Array<number | null>): StageStats {
  const clean = durationsSec.filter((d): d is number => d != null && d >= 0);
  if (clean.length === 0) {
    return { n: 0, medianSec: null, p90Sec: null, meanSec: null };
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p90    = percentile(sorted, 0.9);
  const mean   = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  return { n: clean.length, medianSec: median, p90Sec: p90, meanSec: mean };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  // Linear interpolation between closest ranks
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const weight = idx - lo;
  return Math.round(sortedAsc[lo] * (1 - weight) + sortedAsc[hi] * weight);
}

/** Roll the rows up into an overview summary. Pure, exported for tests. */
export function summarizeVelocity(rows: QuoteVelocityRow[]): VelocitySummary {
  const inFlight = rows.filter((r) =>
    r.status === "sent" || r.status === "viewed" || r.status === "ready" || r.status === "draft"
  ).length;
  const won  = rows.filter((r) => r.outcome === "won"  || r.status === "accepted").length;
  const lost = rows.filter((r) => r.outcome === "lost" || r.status === "rejected").length;

  return {
    totalQuotes:  rows.length,
    inFlight,
    won,
    lost,
    draftToSent:    computeStageStats(rows.map((r) => r.draftToSentSec)),
    sentToViewed:   computeStageStats(rows.map((r) => r.sentToViewedSec)),
    sentToOutcome:  computeStageStats(rows.map((r) => r.sentToOutcomeSec)),
  };
}

// ── Stalled detection ────────────────────────────────────────────────────

/** Quotes in an open state that have lingered past a threshold. */
export function findStalledQuotes(
  rows: QuoteVelocityRow[],
  thresholdDays: number = 14,
): QuoteVelocityRow[] {
  const thresholdSec = thresholdDays * 86400;
  return rows
    .filter((r) =>
      (r.status === "sent" || r.status === "viewed") &&
      r.currentStageAgeSec >= thresholdSec,
    )
    .sort((a, b) => b.currentStageAgeSec - a.currentStageAgeSec);
}

// ── Display helpers ──────────────────────────────────────────────────────

/** Human-readable duration: 12s / 3m / 2h / 4d. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
