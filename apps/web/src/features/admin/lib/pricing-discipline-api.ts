/**
 * Pricing Discipline API — Slice 15.
 *
 * Service layer for qb_margin_thresholds + qb_margin_exceptions.
 * Reads: admin rollup, threshold lookup during save.
 * Writes: admin threshold CRUD, exception logging at save-time.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type MarginThresholdRow =
  Database["public"]["Tables"]["qb_margin_thresholds"]["Row"];
export type MarginThresholdInsert =
  Database["public"]["Tables"]["qb_margin_thresholds"]["Insert"];
export type MarginExceptionRow =
  Database["public"]["Tables"]["qb_margin_exceptions"]["Row"];

// ── Lookups ─────────────────────────────────────────────────────────────

/**
 * Returns the applicable minimum margin_pct for the given brandId:
 *   1. brand-specific row if one exists
 *   2. workspace default (brand_id IS NULL) if set
 *   3. null (no floor configured → everything passes)
 */
export async function getApplicableThreshold(
  brandId: string | null,
): Promise<{ threshold: MarginThresholdRow | null; source: "brand" | "default" | "none" }> {
  // Try brand-specific first
  if (brandId) {
    const { data } = await supabase
      .from("qb_margin_thresholds")
      .select("*")
      .eq("brand_id", brandId)
      .maybeSingle();
    if (data) return { threshold: data as MarginThresholdRow, source: "brand" };
  }
  // Fall back to workspace default
  const { data } = await supabase
    .from("qb_margin_thresholds")
    .select("*")
    .is("brand_id", null)
    .maybeSingle();
  if (data) return { threshold: data as MarginThresholdRow, source: "default" };
  return { threshold: null, source: "none" };
}

// ── Admin CRUD ──────────────────────────────────────────────────────────

export async function listThresholds(): Promise<MarginThresholdRow[]> {
  const { data, error } = await supabase
    .from("qb_margin_thresholds")
    .select("*, qb_brands!brand_id(id, name, code)")
    .order("brand_id", { ascending: true, nullsFirst: true });
  if (error) return [];
  return (data ?? []) as MarginThresholdRow[];
}

export async function upsertThreshold(
  input: {
    id?: string;
    workspaceId: string;
    brandId: string | null;
    minMarginPct: number;
    notes?: string | null;
    updatedBy?: string | null;
  },
): Promise<{ ok: true; row: MarginThresholdRow } | { error: string }> {
  const payload: MarginThresholdInsert = {
    id:             input.id,
    workspace_id:   input.workspaceId,
    brand_id:       input.brandId,
    min_margin_pct: input.minMarginPct,
    notes:          input.notes ?? null,
    updated_by:     input.updatedBy ?? null,
  };
  const { data, error } = await supabase
    .from("qb_margin_thresholds")
    .upsert(payload, { onConflict: input.id ? "id" : undefined })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to save threshold" };
  return { ok: true, row: data as MarginThresholdRow };
}

export async function deleteThreshold(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_margin_thresholds")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ── Exception logging ───────────────────────────────────────────────────

export async function logMarginException(input: {
  workspaceId: string;
  quotePackageId: string;
  brandId: string | null;
  quotedMarginPct: number;
  thresholdMarginPct: number;
  estimatedGapCents: number | null;
  reason: string;
  repId: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_margin_exceptions")
    .insert({
      workspace_id:         input.workspaceId,
      quote_package_id:     input.quotePackageId,
      brand_id:             input.brandId,
      quoted_margin_pct:    input.quotedMarginPct,
      threshold_margin_pct: input.thresholdMarginPct,
      estimated_gap_cents:  input.estimatedGapCents,
      reason:               input.reason.trim().slice(0, 500),
      rep_id:               input.repId,
    });
  if (error) return { error: error.message };
  return { ok: true };
}

// ── Rollup ──────────────────────────────────────────────────────────────

export interface ExceptionRollupFilter {
  daysBack?: number | null;
}

export interface ExceptionRollup {
  total: number;
  /** Average delta in percentage points below floor (negative number). */
  avgDeltaPts: number | null;
  /** Sum of estimated gap in cents (total margin erosion). */
  totalEstimatedGapCents: number;
  byRep:   Array<{ repId: string | null; count: number; avgDeltaPts: number }>;
  byBrand: Array<{ brandId: string | null; count: number; avgDeltaPts: number }>;
  recent:  MarginExceptionRow[];
}

export async function getExceptionRollup(
  opts: ExceptionRollupFilter = {},
): Promise<ExceptionRollup> {
  const daysBack = opts.daysBack === undefined ? 90 : opts.daysBack;
  let q = supabase
    .from("qb_margin_exceptions")
    .select("*")
    .order("created_at", { ascending: false });
  if (daysBack != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    q = q.gte("created_at", cutoff.toISOString());
  }
  const { data } = await q;
  const rows = (data ?? []) as MarginExceptionRow[];
  return aggregateExceptions(rows);
}

/** Pure aggregation — exported for tests. */
export function aggregateExceptions(rows: MarginExceptionRow[]): ExceptionRollup {
  if (rows.length === 0) {
    return {
      total: 0,
      avgDeltaPts: null,
      totalEstimatedGapCents: 0,
      byRep: [],
      byBrand: [],
      recent: [],
    };
  }

  let deltaSum = 0;
  let gapSum = 0;
  const byRepMap = new Map<string | null, { count: number; deltaSum: number }>();
  const byBrandMap = new Map<string | null, { count: number; deltaSum: number }>();

  for (const r of rows) {
    const delta = Number(r.delta_pts);
    deltaSum += delta;
    gapSum += r.estimated_gap_cents ?? 0;
    const repKey = r.rep_id;
    const brandKey = r.brand_id;
    const repSlot = byRepMap.get(repKey) ?? { count: 0, deltaSum: 0 };
    byRepMap.set(repKey, { count: repSlot.count + 1, deltaSum: repSlot.deltaSum + delta });
    const brandSlot = byBrandMap.get(brandKey) ?? { count: 0, deltaSum: 0 };
    byBrandMap.set(brandKey, { count: brandSlot.count + 1, deltaSum: brandSlot.deltaSum + delta });
  }

  return {
    total: rows.length,
    avgDeltaPts: Math.round((deltaSum / rows.length) * 10) / 10,
    totalEstimatedGapCents: gapSum,
    byRep: [...byRepMap.entries()]
      .map(([repId, v]) => ({ repId, count: v.count, avgDeltaPts: Math.round((v.deltaSum / v.count) * 10) / 10 }))
      .sort((a, b) => b.count - a.count),
    byBrand: [...byBrandMap.entries()]
      .map(([brandId, v]) => ({ brandId, count: v.count, avgDeltaPts: Math.round((v.deltaSum / v.count) * 10) / 10 }))
      .sort((a, b) => b.count - a.count),
    recent: rows.slice(0, 50),
  };
}

// ── Pure helpers ────────────────────────────────────────────────────────

/**
 * Check whether a quote's margin is under the applicable threshold.
 * Returns undefined when no threshold applies — callers should treat that
 * as "no floor, pass through".
 */
export function isUnderThreshold(
  quotedPct: number | null,
  thresholdPct: number | null,
): boolean {
  if (thresholdPct == null) return false;
  if (quotedPct == null || !Number.isFinite(quotedPct)) return false;
  return quotedPct < thresholdPct;
}

/**
 * Estimate the dollar gap between the quoted margin and the floor. Used to
 * snapshot `estimated_gap_cents` on the exception row so the rollup can
 * show "$X of erosion this quarter" without re-computing from snapshots.
 */
export function estimateMarginGapCents(
  netTotalCents: number,
  quotedPct: number,
  thresholdPct: number,
): number {
  if (netTotalCents <= 0) return 0;
  const deltaPct = thresholdPct - quotedPct;
  if (deltaPct <= 0) return 0;
  return Math.round(netTotalCents * (deltaPct / 100));
}
