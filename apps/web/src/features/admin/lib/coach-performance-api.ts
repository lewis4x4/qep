/**
 * Coach Performance API — Slice 18.
 *
 * Admin visibility into "is the Deal Coach actually helping?". Rolls
 * up three source tables into one dashboard payload:
 *
 *   - qb_deal_coach_actions → per-rule show/apply/dismiss counts.
 *   - quote_packages status → win/loss correlation with rule acceptance.
 *   - Per-rep roll-up of dismissal activity → leaderboard of reps the
 *     coach isn't landing with.
 *
 * Adaptive preview: the returned `wouldSuppressAt(threshold)` +
 * `wouldDemoteAt(threshold)` helpers let the admin slide acceptance
 * thresholds and see which rules would flip under the new policy —
 * before the runtime picks it up. That gives the operator a safety
 * net for tuning without shipping a config change blind.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type ActionRow = Database["public"]["Tables"]["qb_deal_coach_actions"]["Row"];
type CoachActionRollupRow = Pick<ActionRow, "rule_id" | "action" | "shown_by" | "shown_at" | "quote_package_id">;
type PackageStatusRow = { id: string; status: string };
type ProfileDisplayRow = {
  id: string;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
};

// ── Types ────────────────────────────────────────────────────────────────

export interface RulePerformanceRow {
  ruleId:             string;
  timesShown:         number;
  timesApplied:       number;
  timesDismissed:     number;
  timesUnresolved:    number;  // shown but no apply/dismiss yet
  acceptanceRatePct:  number | null;
  /** win/(wins+losses) among packages this rule was SHOWN on. */
  winRateWhenShownPct: number | null;
  /** win/(wins+losses) among packages this rule was APPLIED on. */
  winRateWhenAppliedPct: number | null;
  /** Uplift in pts: winRateWhenAppliedPct - winRateWhenShownPct. Null when either is null. */
  upliftPts:          number | null;
}

export interface RepDismissalRow {
  repId:            string;
  displayName:      string | null;
  dismissalCount:   number;
  distinctRules:    number;
  /** The rule this rep most frequently dismisses. */
  topDismissedRule: string | null;
}

export interface CoachPerformanceSummary {
  totalActions:   number;
  totalApplied:   number;
  totalDismissed: number;
  acceptedPct:    number | null;
  rules:          RulePerformanceRow[];
  repDismissals:  RepDismissalRow[];
  /** ISO timestamps — window the rollup covers. */
  windowFrom:     string;
  windowTo:       string;
  /** True when the underlying action query hit MAX_ACTION_ROWS and the
   *  rollup is computed over a truncated sample. Admin UI should warn. */
  truncated:      boolean;
  /** Non-null when an upstream query errored — lets the page surface
   *  "Couldn't load coach performance" instead of silently showing zeros. */
  error:          string | null;
}

/**
 * Cap on the action-row fetch. At 5k rows across 90 days, even a
 * chatty workspace stays well within Supabase's per-request budget.
 * Setting a value > 1000 lifts the default REST-API limit so we don't
 * silently truncate small data sets. When the cap is hit we surface it
 * on the returned summary so admin can widen the window if needed.
 */
export const MAX_ACTION_ROWS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isValidDateString(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

export function normalizeCoachActionRows(value: unknown): CoachActionRollupRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const ruleId = requiredString(row.rule_id);
    const shownAt = requiredString(row.shown_at);
    const quotePackageId = requiredString(row.quote_package_id);
    if (!ruleId || !shownAt || !isValidDateString(shownAt) || !quotePackageId) return [];
    return [{
      rule_id: ruleId,
      action: nullableString(row.action),
      shown_by: nullableString(row.shown_by),
      shown_at: shownAt,
      quote_package_id: quotePackageId,
    }];
  });
}

export function normalizePackageStatusRows(value: unknown): PackageStatusRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const status = requiredString(row.status);
    return id && status ? [{ id, status }] : [];
  });
}

export function normalizeProfileDisplayRows(value: unknown): ProfileDisplayRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    if (!id) return [];
    return [{
      id,
      display_name: nullableString(row.display_name),
      full_name: nullableString(row.full_name),
      email: nullableString(row.email),
    }];
  });
}

// ── Public API ───────────────────────────────────────────────────────────

export async function getCoachPerformanceSummary(
  daysBack = 90,
): Promise<CoachPerformanceSummary> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  const emptyBase = {
    totalActions: 0, totalApplied: 0, totalDismissed: 0, acceptedPct: null,
    rules: [], repDismissals: [],
    windowFrom: from.toISOString(), windowTo: to.toISOString(),
    truncated: false, error: null as string | null,
  };

  // Pull actions joined to package status so we can compute win-rate
  // uplift in one pass. MAX_ACTION_ROWS lifts the Postgrest default
  // 1000-row cap — without this the rollup could silently truncate in
  // a busy workspace.
  const { data: actions, error: actionsErr } = await supabase
    .from("qb_deal_coach_actions")
    .select("rule_id, action, shown_by, shown_at, quote_package_id")
    .gte("shown_at", from.toISOString())
    .order("shown_at", { ascending: false })
    .limit(MAX_ACTION_ROWS);

  if (actionsErr) {
    return { ...emptyBase, error: actionsErr.message };
  }

  const actionRows = normalizeCoachActionRows(actions);

  if (actionRows.length === 0) return emptyBase;

  const truncated = actionRows.length === MAX_ACTION_ROWS;

  // Batch-fetch statuses for just the packages referenced
  const pkgIds = [...new Set(actionRows.map((a) => a.quote_package_id))];
  const { data: pkgs, error: pkgsErr } = await supabase
    .from("quote_packages")
    .select("id, status")
    .in("id", pkgIds);

  if (pkgsErr) {
    return { ...emptyBase, error: pkgsErr.message };
  }

  const statusByPkg = new Map<string, string>();
  for (const p of normalizePackageStatusRows(pkgs)) {
    statusByPkg.set(p.id, p.status);
  }

  // Batch-fetch rep profile display names
  const repIds = [...new Set(actionRows.map((a) => a.shown_by).filter((v): v is string => !!v))];
  const nameByRep = new Map<string, string>();
  if (repIds.length > 0) {
    const { data: profiles, error: profilesErr } = await supabase
      .from("profiles")
      .select("id, display_name, full_name, email")
      .in("id", repIds);
    // A profile fetch failure is non-fatal — we fall back to raw IDs.
    if (!profilesErr) {
      for (const p of normalizeProfileDisplayRows(profiles)) {
        nameByRep.set(p.id, p.display_name ?? p.full_name ?? p.email ?? p.id);
      }
    }
  }

  const summary = aggregateCoachPerformance(actionRows, statusByPkg, nameByRep, from, to);
  return { ...summary, truncated, error: null };
}

// ── Pure aggregator (exported for tests) ─────────────────────────────────

export function aggregateCoachPerformance(
  actions: Array<Pick<CoachActionRollupRow, "rule_id" | "action" | "shown_by" | "quote_package_id">>,
  statusByPkg: Map<string, string>,
  nameByRep: Map<string, string>,
  windowFrom: Date,
  windowTo:   Date,
): CoachPerformanceSummary {
  // ── Per-rule rollup ───────────────────────────────────────────────────
  const byRule = new Map<string, {
    shown: number; applied: number; dismissed: number;
    winsShown: number; lossesShown: number;
    winsApplied: number; lossesApplied: number;
  }>();

  for (const a of actions) {
    const slot = byRule.get(a.rule_id) ?? {
      shown: 0, applied: 0, dismissed: 0,
      winsShown: 0, lossesShown: 0, winsApplied: 0, lossesApplied: 0,
    };
    slot.shown += 1;
    const isApplied = a.action === "applied";
    const isDismissed = a.action === "dismissed";
    if (isApplied) slot.applied += 1;
    if (isDismissed) slot.dismissed += 1;

    const status = statusByPkg.get(a.quote_package_id);
    if (status === "accepted") {
      slot.winsShown += 1;
      if (isApplied) slot.winsApplied += 1;
    } else if (status === "rejected") {
      slot.lossesShown += 1;
      if (isApplied) slot.lossesApplied += 1;
    }
    byRule.set(a.rule_id, slot);
  }

  const rules: RulePerformanceRow[] = [...byRule.entries()].map(([ruleId, v]) => {
    const acted = v.applied + v.dismissed;
    const closedShown = v.winsShown + v.lossesShown;
    const closedApplied = v.winsApplied + v.lossesApplied;
    const winRateWhenShown   = closedShown   > 0 ? (v.winsShown   / closedShown)   * 100 : null;
    const winRateWhenApplied = closedApplied > 0 ? (v.winsApplied / closedApplied) * 100 : null;
    return {
      ruleId,
      timesShown:       v.shown,
      timesApplied:     v.applied,
      timesDismissed:   v.dismissed,
      timesUnresolved:  v.shown - acted,
      acceptanceRatePct:      acted > 0 ? round1((v.applied / acted) * 100) : null,
      winRateWhenShownPct:    winRateWhenShown   != null ? round1(winRateWhenShown)   : null,
      winRateWhenAppliedPct:  winRateWhenApplied != null ? round1(winRateWhenApplied) : null,
      upliftPts:
        winRateWhenShown != null && winRateWhenApplied != null
          ? round1(winRateWhenApplied - winRateWhenShown)
          : null,
    };
  });
  rules.sort((a, b) => b.timesShown - a.timesShown);

  // ── Per-rep dismissal rollup ─────────────────────────────────────────
  const byRep = new Map<string, { total: number; byRule: Map<string, number> }>();
  for (const a of actions) {
    if (a.action !== "dismissed" || !a.shown_by) continue;
    const slot = byRep.get(a.shown_by) ?? { total: 0, byRule: new Map() };
    slot.total += 1;
    slot.byRule.set(a.rule_id, (slot.byRule.get(a.rule_id) ?? 0) + 1);
    byRep.set(a.shown_by, slot);
  }
  const repDismissals: RepDismissalRow[] = [...byRep.entries()]
    .map(([repId, v]) => {
      let topRule: string | null = null;
      let topCount = 0;
      for (const [ruleId, count] of v.byRule) {
        if (count > topCount) { topRule = ruleId; topCount = count; }
      }
      return {
        repId,
        displayName:      nameByRep.get(repId) ?? null,
        dismissalCount:   v.total,
        distinctRules:    v.byRule.size,
        topDismissedRule: topRule,
      };
    })
    .sort((a, b) => b.dismissalCount - a.dismissalCount);

  // ── Headline totals ───────────────────────────────────────────────────
  let totalApplied = 0, totalDismissed = 0;
  for (const a of actions) {
    if (a.action === "applied")   totalApplied   += 1;
    if (a.action === "dismissed") totalDismissed += 1;
  }
  const totalActed = totalApplied + totalDismissed;

  return {
    totalActions:   actions.length,
    totalApplied,
    totalDismissed,
    acceptedPct:    totalActed > 0 ? round1((totalApplied / totalActed) * 100) : null,
    rules,
    repDismissals,
    windowFrom:     windowFrom.toISOString(),
    windowTo:       windowTo.toISOString(),
    // These two are filled in by the Supabase wrapper. Pure aggregation
    // never knows about truncation or upstream errors, so defaults here.
    truncated:      false,
    error:          null,
  };
}

// ── Adaptive preview helpers ─────────────────────────────────────────────

/** Rules that WOULD be suppressed at the given acceptance threshold. Pure. */
export function wouldSuppressAt(
  rules: RulePerformanceRow[],
  thresholdPct: number,
  minConfidence: number,
): RulePerformanceRow[] {
  return rules.filter((r) =>
    r.timesShown >= minConfidence
    && r.acceptanceRatePct != null
    && r.acceptanceRatePct < thresholdPct,
  );
}

/** Rules that WOULD be demoted between the two thresholds. Pure. */
export function wouldDemoteAt(
  rules: RulePerformanceRow[],
  suppressBelow: number,
  demoteBelow: number,
  minConfidence: number,
): RulePerformanceRow[] {
  return rules.filter((r) =>
    r.timesShown >= minConfidence
    && r.acceptanceRatePct != null
    && r.acceptanceRatePct >= suppressBelow
    && r.acceptanceRatePct < demoteBelow,
  );
}

// ── Numeric helpers ──────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
