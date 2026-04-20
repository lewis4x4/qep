/**
 * Deal Intelligence API — Slice 17 (the ML Deal Coach).
 *
 * Turns accumulated data into context the coach rules can reason over:
 *
 *   - Similar-deal outcomes     → "3 comparable RT-135 quotes closed at 22% avg margin."
 *   - Reason intelligence       → "'Competitive response' margin exceptions win 36% vs 'relationship' at 72%."
 *   - Rule acceptance stats     → Rules the rep routinely dismisses are suppressed.
 *   - Personal suppressions     → Per-rep dismissal memory (30-day rolling).
 *
 * Design principles:
 *  - Graceful zero-data: every function has a "not enough data" branch
 *    so the coach still works on day 1 of a new workspace.
 *  - Pure aggregation: the heavy lifting is in helpers you can feed
 *    fixtures into. Supabase wrappers are thin.
 *  - Rolling windows: 90-day default for outcomes + 30-day for
 *    suppressions. Short enough to adapt to seasonality, long enough
 *    to stay statistically useful.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

// ── Types ────────────────────────────────────────────────────────────────

type QuotePackageRow = Database["public"]["Tables"]["quote_packages"]["Row"];
type OutcomeRow      = Database["public"]["Tables"]["qb_quote_outcomes"]["Row"];
type ExceptionRow    = Database["public"]["Tables"]["qb_margin_exceptions"]["Row"];
type ActionRow       = Database["public"]["Tables"]["qb_deal_coach_actions"]["Row"];

export type QuoteOutcome = "won" | "lost" | "expired" | "skipped";

// ── Similar deal outcomes ────────────────────────────────────────────────

export interface SimilarDealsQuery {
  /** The brand on the rep's primary equipment line (free text from draft). */
  brandName: string | null;
  /** The draft's net total in dollars (whole, not cents). */
  netTotal:  number;
  /** Days back to look. Default 90. */
  daysBack?: number;
}

export interface SimilarDealsResult {
  sampleSize:       number;
  /** Wins + losses that actually closed (excludes expired/skipped/ongoing). */
  closedSampleSize: number;
  winRatePct:       number | null;
  /** Average margin_pct across wins only — that's "what margin did comparable deals close at". */
  avgWinMarginPct:  number | null;
  medianWinMarginPct: number | null;
  /** Price band we matched against for transparency. */
  priceBandLow:  number;
  priceBandHigh: number;
}

/**
 * Fetch quote_packages that look like the draft + their outcomes, then
 * aggregate. "Look like" = same brand (case-insensitive) AND net_total
 * within ±35% of the draft's net total.
 */
export async function getSimilarDealOutcomes(
  query: SimilarDealsQuery,
): Promise<SimilarDealsResult> {
  const daysBack = query.daysBack ?? 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const { priceBandLow, priceBandHigh } = computePriceBand(query.netTotal);

  // Pull candidates. We filter on net_total range server-side; brand match
  // is done client-side via equipment JSON because quote_packages doesn't
  // denormalize brand.
  const { data: pkgs } = await supabase
    .from("quote_packages")
    .select("id, equipment, net_total, margin_pct, status, created_at")
    .gte("created_at", cutoff.toISOString())
    .gte("net_total", priceBandLow)
    .lte("net_total", priceBandHigh);

  const rows = ((pkgs ?? []) as Array<Pick<QuotePackageRow,
    "id" | "equipment" | "net_total" | "margin_pct" | "status" | "created_at">>)
    .filter((p) => brandMatches(p.equipment, query.brandName));

  if (rows.length === 0) {
    return {
      sampleSize: 0,
      closedSampleSize: 0,
      winRatePct: null,
      avgWinMarginPct: null,
      medianWinMarginPct: null,
      priceBandLow,
      priceBandHigh,
    };
  }

  // Join outcomes — one fetch, then map.
  const ids = rows.map((r) => r.id);
  const { data: outcomes } = await supabase
    .from("qb_quote_outcomes")
    .select("quote_package_id, outcome")
    .in("quote_package_id", ids);

  const outcomeByPkg = new Map<string, QuoteOutcome>();
  for (const o of (outcomes ?? []) as Pick<OutcomeRow, "quote_package_id" | "outcome">[]) {
    // If a package has multiple outcome rows (reopens), latest row wins —
    // we don't have ordering here, but this fallback is fine for aggregate.
    outcomeByPkg.set(o.quote_package_id, o.outcome as QuoteOutcome);
  }

  // Quote-package status is our secondary signal: status=accepted on a
  // package without a qb_quote_outcomes row is also a win.
  const enriched = rows.map((r) => ({
    marginPct: r.margin_pct,
    outcome:   outcomeByPkg.get(r.id) ?? deriveOutcomeFromStatus(r.status),
  }));

  return aggregateSimilarDeals(enriched, priceBandLow, priceBandHigh);
}

// ── Reason intelligence ──────────────────────────────────────────────────

export interface ReasonStat {
  /** One of the canonical buckets — see REASON_BUCKETS below. */
  bucket:   ReasonBucket;
  samples:  number;
  wins:     number;
  losses:   number;
  winRatePct: number | null;
  /** Average margin erosion in cents on the exception. */
  avgGapCents: number;
}

export type ReasonBucket =
  | "competitive_response"
  | "customer_relationship"
  | "strategic_loss_leader"
  | "volume_commitment"
  | "service_trade_in_offset"
  | "other";

export const REASON_BUCKETS: ReasonBucket[] = [
  "competitive_response",
  "customer_relationship",
  "strategic_loss_leader",
  "volume_commitment",
  "service_trade_in_offset",
  "other",
];

export interface ReasonIntelligence {
  /** Sorted by winRatePct desc (nulls last); only buckets with ≥ MIN_BUCKET_SAMPLES. */
  stats: ReasonStat[];
  /** Total exceptions analysed (all buckets combined). */
  totalSamples: number;
}

/** Bucketing heuristic — exported for tests. */
export function bucketReason(reason: string | null | undefined): ReasonBucket {
  if (!reason) return "other";
  const r = reason.toLowerCase();
  if (/\b(competit|match|beat|underc|rival)/.test(r)) return "competitive_response";
  if (/\b(long[- ]?time|loyal|relationship|longstand|repeat|reference)/.test(r)) return "customer_relationship";
  if (/\b(loss[- ]?leader|gateway|foot in the door|strategic)/.test(r)) return "strategic_loss_leader";
  if (/\b(volume|fleet|multi[- ]?unit|bundle|quantity)/.test(r)) return "volume_commitment";
  if (/\b(service|parts|trade[- ]?in|attach)/.test(r)) return "service_trade_in_offset";
  return "other";
}

const MIN_BUCKET_SAMPLES = 3;

export async function getReasonIntelligence(daysBack = 180): Promise<ReasonIntelligence> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const { data: excs } = await supabase
    .from("qb_margin_exceptions")
    .select("quote_package_id, reason, estimated_gap_cents, created_at")
    .gte("created_at", cutoff.toISOString());

  const exceptionRows = ((excs ?? []) as Pick<ExceptionRow,
    "quote_package_id" | "reason" | "estimated_gap_cents" | "created_at">[]);

  if (exceptionRows.length === 0) {
    return { stats: [], totalSamples: 0 };
  }

  const ids = [...new Set(exceptionRows.map((e) => e.quote_package_id))];
  const { data: outcomes } = await supabase
    .from("qb_quote_outcomes")
    .select("quote_package_id, outcome")
    .in("quote_package_id", ids);

  const outcomeByPkg = new Map<string, QuoteOutcome>();
  for (const o of (outcomes ?? []) as Pick<OutcomeRow, "quote_package_id" | "outcome">[]) {
    outcomeByPkg.set(o.quote_package_id, o.outcome as QuoteOutcome);
  }

  // Fall back to package status when there's no explicit outcome row
  const { data: pkgStatuses } = await supabase
    .from("quote_packages")
    .select("id, status")
    .in("id", ids);
  const statusByPkg = new Map<string, string>();
  for (const p of (pkgStatuses ?? []) as { id: string; status: string }[]) {
    statusByPkg.set(p.id, p.status);
  }

  return aggregateReasonIntelligence(
    exceptionRows.map((e) => ({
      bucket:     bucketReason(e.reason),
      outcome:    outcomeByPkg.get(e.quote_package_id)
                    ?? deriveOutcomeFromStatus(statusByPkg.get(e.quote_package_id) ?? "draft"),
      gapCents:   e.estimated_gap_cents ?? 0,
    })),
  );
}

// ── Rule acceptance stats (for future pruning) ───────────────────────────

export interface RuleAcceptanceStat {
  ruleId:           string;
  timesShown:       number;
  timesApplied:     number;
  timesDismissed:   number;
  /** applied / (applied + dismissed). null if no action recorded yet. */
  acceptanceRatePct: number | null;
}

/**
 * Cap on rows pulled for the adaptive classifier. 5000 × 60 days is
 * generous even for a busy workspace; hitting it means the classifier
 * is operating on a truncated sample, so we'd rather see a real signal
 * than silently misreport. When Slice 18/19 adds a materialized view
 * or RPC for this, the cap goes away.
 */
export const MAX_ACCEPTANCE_ROWS = 5000;

export async function getRuleAcceptanceStats(daysBack = 60): Promise<RuleAcceptanceStat[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const { data: rows } = await supabase
    .from("qb_deal_coach_actions")
    .select("rule_id, action, shown_at")
    .gte("shown_at", cutoff.toISOString())
    .order("shown_at", { ascending: false })
    .limit(MAX_ACCEPTANCE_ROWS);

  return aggregateRuleAcceptance(((rows ?? []) as Pick<ActionRow, "rule_id" | "action">[]));
}

// ── Personal suppression memory ──────────────────────────────────────────

export interface PersonalSuppressionOpts {
  repId: string;
  /** Threshold for "this rep keeps dismissing this rule" → suppress future shows. */
  minDismissals?: number;
  daysBack?: number;
}

/**
 * Returns rule ids this rep has dismissed ≥ minDismissals times in the
 * last `daysBack` days. The coach registry filters these out before
 * evaluating, so the rep stops seeing rules they've told us they don't
 * want.
 */
export async function getPersonalSuppressions(
  opts: PersonalSuppressionOpts,
): Promise<Set<string>> {
  const minDismissals = opts.minDismissals ?? 3;
  const daysBack = opts.daysBack ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const { data: rows } = await supabase
    .from("qb_deal_coach_actions")
    .select("rule_id, action, shown_by, acted_at")
    .eq("shown_by", opts.repId)
    .eq("action", "dismissed")
    .gte("acted_at", cutoff.toISOString());

  const counts = new Map<string, number>();
  for (const r of (rows ?? []) as Pick<ActionRow, "rule_id">[]) {
    counts.set(r.rule_id, (counts.get(r.rule_id) ?? 0) + 1);
  }

  const suppressed = new Set<string>();
  for (const [ruleId, n] of counts) {
    if (n >= minDismissals) suppressed.add(ruleId);
  }
  return suppressed;
}

// ── Pure helpers (exported for tests) ────────────────────────────────────

/**
 * Compute a price band around a target net_total. Default ±35% —
 * wide enough to catch substitutes (30k vs 20k skid steer), narrow
 * enough to exclude grossly-different deal sizes.
 */
export function computePriceBand(
  netTotal: number,
  widthPct = 0.35,
): { priceBandLow: number; priceBandHigh: number } {
  if (!Number.isFinite(netTotal) || netTotal <= 0) {
    return { priceBandLow: 0, priceBandHigh: Number.MAX_SAFE_INTEGER };
  }
  return {
    priceBandLow:  Math.max(0, Math.round(netTotal * (1 - widthPct))),
    priceBandHigh: Math.round(netTotal * (1 + widthPct)),
  };
}

/**
 * Brand match helper — scans the equipment JSON array for any make/model
 * field that contains the target brand name (case-insensitive).
 * Tolerates null/missing brand and missing equipment.
 */
export function brandMatches(
  equipment: QuotePackageRow["equipment"],
  brandName: string | null,
): boolean {
  if (!brandName) return true; // no brand filter = match everything in range
  if (!Array.isArray(equipment)) return false;
  const target = brandName.toLowerCase().trim();
  if (target.length === 0) return true;
  return equipment.some((line) => {
    const obj = line as { make?: string; model?: string };
    const make = (obj.make ?? "").toLowerCase();
    return make.includes(target) || target.includes(make);
  });
}

/** Derive a quote outcome from package status when no explicit row exists. */
export function deriveOutcomeFromStatus(status: string): QuoteOutcome {
  switch (status) {
    case "accepted": return "won";
    case "rejected": return "lost";
    case "expired":  return "expired";
    default:         return "skipped"; // draft, ready, sent, viewed → still in flight
  }
}

/**
 * Aggregate similar-deal samples into the headline stats. Pure.
 */
export function aggregateSimilarDeals(
  rows: Array<{ marginPct: number | null; outcome: QuoteOutcome }>,
  priceBandLow:  number,
  priceBandHigh: number,
): SimilarDealsResult {
  const closed = rows.filter((r) => r.outcome === "won" || r.outcome === "lost");
  const wins   = closed.filter((r) => r.outcome === "won");

  const winMargins = wins
    .map((r) => r.marginPct)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m));

  return {
    sampleSize:       rows.length,
    closedSampleSize: closed.length,
    winRatePct:       closed.length > 0
      ? Math.round((wins.length / closed.length) * 1000) / 10
      : null,
    avgWinMarginPct:     winMargins.length > 0
      ? Math.round((winMargins.reduce((a, b) => a + b, 0) / winMargins.length) * 10) / 10
      : null,
    medianWinMarginPct:  winMargins.length > 0 ? roundToDecimal(medianOf(winMargins), 1) : null,
    priceBandLow,
    priceBandHigh,
  };
}

/**
 * Aggregate margin-exception samples into per-bucket reason stats. Pure.
 */
export function aggregateReasonIntelligence(
  rows: Array<{ bucket: ReasonBucket; outcome: QuoteOutcome; gapCents: number }>,
): ReasonIntelligence {
  if (rows.length === 0) return { stats: [], totalSamples: 0 };

  const buckets = new Map<ReasonBucket, { wins: number; losses: number; samples: number; gapSum: number }>();
  for (const r of rows) {
    const slot = buckets.get(r.bucket) ?? { wins: 0, losses: 0, samples: 0, gapSum: 0 };
    slot.samples += 1;
    slot.gapSum += r.gapCents;
    if (r.outcome === "won") slot.wins += 1;
    else if (r.outcome === "lost") slot.losses += 1;
    buckets.set(r.bucket, slot);
  }

  const stats: ReasonStat[] = [];
  for (const [bucket, v] of buckets) {
    if (v.samples < MIN_BUCKET_SAMPLES) continue;
    const closed = v.wins + v.losses;
    stats.push({
      bucket,
      samples: v.samples,
      wins: v.wins,
      losses: v.losses,
      winRatePct: closed > 0 ? Math.round((v.wins / closed) * 1000) / 10 : null,
      avgGapCents: Math.round(v.gapSum / v.samples),
    });
  }

  stats.sort((a, b) => {
    // Nulls last, then winRate desc
    if (a.winRatePct == null && b.winRatePct == null) return 0;
    if (a.winRatePct == null) return 1;
    if (b.winRatePct == null) return -1;
    return b.winRatePct - a.winRatePct;
  });

  return { stats, totalSamples: rows.length };
}

/** Aggregate rule acceptance given action rows. Pure. */
export function aggregateRuleAcceptance(
  rows: Array<Pick<ActionRow, "rule_id" | "action">>,
): RuleAcceptanceStat[] {
  const byRule = new Map<string, { shown: number; applied: number; dismissed: number }>();
  for (const r of rows) {
    const slot = byRule.get(r.rule_id) ?? { shown: 0, applied: 0, dismissed: 0 };
    slot.shown += 1;
    if (r.action === "applied")   slot.applied   += 1;
    if (r.action === "dismissed") slot.dismissed += 1;
    byRule.set(r.rule_id, slot);
  }

  return [...byRule.entries()].map(([ruleId, v]) => {
    const acted = v.applied + v.dismissed;
    return {
      ruleId,
      timesShown:     v.shown,
      timesApplied:   v.applied,
      timesDismissed: v.dismissed,
      acceptanceRatePct: acted > 0 ? Math.round((v.applied / acted) * 1000) / 10 : null,
    };
  });
}

// ── Numeric helpers ──────────────────────────────────────────────────────

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid)
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[Math.floor(mid)];
}

function roundToDecimal(n: number, d: number): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

// ── Draft-to-query helper ────────────────────────────────────────────────

/**
 * Derive the similar-deals query from a draft + computed net total.
 * Picks the primary equipment line's `make` as the brand signal — reps
 * can only see meaningful "similar deals" when the draft has at least
 * one machine on it.
 *
 * netTotal is expected in DOLLARS (matches DealCoachContext.computed.netTotal
 * and quote_packages.net_total, neither of which use cents).
 */
export function buildSimilarDealsQuery(
  draft: QuoteWorkspaceDraft,
  netTotalDollars: number,
): SimilarDealsQuery | null {
  const first = draft.equipment[0];
  if (!first) return null;
  const brand = (first.make ?? "").trim() || null;
  if (netTotalDollars <= 0) return null;
  return {
    brandName: brand,
    netTotal:  netTotalDollars,
  };
}
