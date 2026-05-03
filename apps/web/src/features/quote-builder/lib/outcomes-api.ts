/**
 * Quote outcomes API — read/write for qb_quote_outcomes (migration 303).
 *
 * Slice 10 — Win/Loss Learning Loop. The capture drawer writes; the admin
 * rollup tab reads aggregations.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type QuoteOutcomeRow  = Database["public"]["Tables"]["qb_quote_outcomes"]["Row"];
export type QuoteOutcomeInsert = Database["public"]["Tables"]["qb_quote_outcomes"]["Insert"];

export type OutcomeClassification = "won" | "lost" | "expired" | "skipped";

export type OutcomeReason =
  | "price"
  | "timing"
  | "relationship"
  | "service_credit"
  | "financing"
  | "competitor"
  | "spec_mismatch"
  | "other";

export type PriceSensitivity = "primary" | "secondary" | "none";

const OUTCOMES = new Set<OutcomeClassification>(["won", "lost", "expired", "skipped"]);
const OUTCOME_REASONS = new Set<OutcomeReason>([
  "price",
  "timing",
  "relationship",
  "service_credit",
  "financing",
  "competitor",
  "spec_mismatch",
  "other",
]);
const PRICE_SENSITIVITIES = new Set<PriceSensitivity>(["primary", "secondary", "none"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  const normalized = stringOrNull(value)?.trim();
  return normalized ? normalized : null;
}

function outcomeOrNull(value: unknown): OutcomeClassification | null {
  return typeof value === "string" && OUTCOMES.has(value as OutcomeClassification)
    ? value as OutcomeClassification
    : null;
}

function reasonOrNull(value: unknown): OutcomeReason | null {
  return typeof value === "string" && OUTCOME_REASONS.has(value as OutcomeReason)
    ? value as OutcomeReason
    : null;
}

function priceSensitivityOrNull(value: unknown): PriceSensitivity | null {
  return typeof value === "string" && PRICE_SENSITIVITIES.has(value as PriceSensitivity)
    ? value as PriceSensitivity
    : null;
}

export function normalizeQuoteOutcomeRow(value: unknown): QuoteOutcomeRow | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const workspaceId = requiredString(value.workspace_id);
  const quotePackageId = requiredString(value.quote_package_id);
  const outcome = outcomeOrNull(value.outcome);
  const capturedAt = requiredString(value.captured_at);
  const createdAt = requiredString(value.created_at);
  if (!id || !workspaceId || !quotePackageId || !outcome || !capturedAt || !createdAt) return null;
  return {
    id,
    workspace_id: workspaceId,
    quote_package_id: quotePackageId,
    outcome,
    reason: reasonOrNull(value.reason),
    reason_details: stringOrNull(value.reason_details),
    competitor: stringOrNull(value.competitor),
    price_sensitivity: priceSensitivityOrNull(value.price_sensitivity),
    captured_by: stringOrNull(value.captured_by),
    captured_at: capturedAt,
    created_at: createdAt,
  };
}

export function normalizeOutcomeRollupRows(rows: unknown): Array<{ outcome: OutcomeClassification; reason: OutcomeReason | null }> {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const outcome = outcomeOrNull(value.outcome);
    if (!outcome) return [];
    return [{ outcome, reason: reasonOrNull(value.reason) }];
  });
}

export interface CaptureOutcomeInput {
  quotePackageId: string;
  workspaceId: string;
  outcome: OutcomeClassification;
  reason?: OutcomeReason | null;
  reasonDetails?: string | null;
  competitor?: string | null;
  priceSensitivity?: PriceSensitivity | null;
  capturedBy?: string | null;
}

export async function captureQuoteOutcome(
  input: CaptureOutcomeInput,
): Promise<{ ok: true; outcome: QuoteOutcomeRow } | { error: string }> {
  const { data, error } = await supabase
    .from("qb_quote_outcomes")
    .insert({
      workspace_id:      input.workspaceId,
      quote_package_id:  input.quotePackageId,
      outcome:           input.outcome,
      reason:            input.reason ?? null,
      reason_details:    input.reasonDetails?.trim() || null,
      competitor:        input.competitor?.trim() || null,
      price_sensitivity: input.priceSensitivity ?? null,
      captured_by:       input.capturedBy ?? null,
    } satisfies QuoteOutcomeInsert)
    .select("*")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to capture outcome" };
  }

  // Mirror the outcome into quote_packages.status so the list view stays
  // consistent. Only applies to concrete outcomes — 'skipped' leaves the
  // status untouched so the rep can re-record later.
  const statusMap: Record<OutcomeClassification, string | null> = {
    won:     "accepted",
    lost:    "rejected",
    expired: "expired",
    skipped: null,
  };
  const targetStatus = statusMap[input.outcome];
  if (targetStatus) {
    // Non-blocking — an RLS denial here shouldn't roll back the outcome row.
    // We log and proceed; the outcome is still captured.
    await supabase
      .from("quote_packages")
      .update({ status: targetStatus })
      .eq("id", input.quotePackageId);
  }

  const outcome = normalizeQuoteOutcomeRow(data);
  if (!outcome) return { error: "Captured outcome returned malformed row" };
  return { ok: true, outcome };
}

/**
 * Latest outcome for a given quote, if any. Useful to avoid re-prompting
 * a rep who already recorded or dismissed the capture.
 */
export async function getLatestOutcomeForQuote(
  quotePackageId: string,
): Promise<QuoteOutcomeRow | null> {
  const { data } = await supabase
    .from("qb_quote_outcomes")
    .select("*")
    .eq("quote_package_id", quotePackageId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalizeQuoteOutcomeRow(data);
}

// ── Admin rollup aggregations ────────────────────────────────────────────────

export interface OutcomeRollupFilter {
  /** Days back to include. Null = all-time. Default: 90. */
  daysBack?: number | null;
}

export interface OutcomeRollup {
  total: number;
  won: number;
  lost: number;
  expired: number;
  skipped: number;
  /** Win rate excluding skipped rows (since skipped has no outcome). */
  winRatePct: number | null;
  /** Skip-rate — what fraction of captures were dismissed. */
  skipRatePct: number | null;
  /** Reason frequencies across won + lost (not expired/skipped). */
  reasonCounts: Record<OutcomeReason, number>;
  /** Most common reason names sorted by count. */
  topReasons: Array<{ reason: OutcomeReason; count: number }>;
}

const EMPTY_REASON_COUNTS: Record<OutcomeReason, number> = {
  price: 0, timing: 0, relationship: 0, service_credit: 0,
  financing: 0, competitor: 0, spec_mismatch: 0, other: 0,
};

export async function getOutcomeRollup(
  opts: OutcomeRollupFilter = {},
): Promise<OutcomeRollup> {
  const daysBack = opts.daysBack === undefined ? 90 : opts.daysBack;
  let q = supabase
    .from("qb_quote_outcomes")
    .select("outcome, reason, captured_at");
  if (daysBack != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    q = q.gte("captured_at", cutoff.toISOString());
  }
  const { data } = await q;
  return aggregateOutcomes(normalizeOutcomeRollupRows(data));
}

/**
 * Pure aggregation — exported for tests.
 */
export function aggregateOutcomes(
  rows: Array<{ outcome: OutcomeClassification; reason: OutcomeReason | null }>,
): OutcomeRollup {
  const counts = { won: 0, lost: 0, expired: 0, skipped: 0 };
  const reasonCounts: Record<OutcomeReason, number> = { ...EMPTY_REASON_COUNTS };

  for (const row of rows) {
    counts[row.outcome]++;
    // Only count reasons on won/lost rows (expired + skipped are outcome-only)
    if ((row.outcome === "won" || row.outcome === "lost") && row.reason) {
      reasonCounts[row.reason]++;
    }
  }

  const total = rows.length;
  const resolved = counts.won + counts.lost;
  const winRatePct = resolved > 0 ? Math.round((counts.won / resolved) * 100) : null;
  const skipRatePct = total > 0 ? Math.round((counts.skipped / total) * 100) : null;

  const topReasons = Object.entries(reasonCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason: reason as OutcomeReason, count }));

  return {
    total,
    won: counts.won,
    lost: counts.lost,
    expired: counts.expired,
    skipped: counts.skipped,
    winRatePct,
    skipRatePct,
    reasonCounts,
    topReasons,
  };
}

// ── Display helpers ──────────────────────────────────────────────────────────

export const REASON_LABELS: Record<OutcomeReason, string> = {
  price:           "Price",
  timing:          "Timing",
  relationship:    "Relationship",
  service_credit:  "Service credit",
  financing:       "Financing",
  competitor:      "Competitor",
  spec_mismatch:   "Spec mismatch",
  other:           "Other",
};

export const REASON_ORDER: OutcomeReason[] = [
  "price", "timing", "competitor", "financing",
  "relationship", "service_credit", "spec_mismatch", "other",
];
