// ============================================================
// Replenish Queue Review API (Slice 2.7)
// ============================================================

import { supabase } from "../../../lib/supabase";
import {
  normalizeApprovedRowsResult,
  normalizeOrderedRowsResult,
  normalizeRejectedRowsResult,
  normalizeReplenishRows,
  normalizeReplenishSummary,
  normalizeUpdatedQtyResult,
} from "./replenish-api-normalizers";

export type QueueStatus =
  | "pending"
  | "scheduled"
  | "auto_approved"
  | "approved"
  | "rejected"
  | "ordered"
  | "expired";

export type SourceType =
  | "rop_triggered"
  | "predictive_play"
  | "manual_entry"
  | "api_import";

export interface ReplenishRow {
  id: string;
  part_number: string;
  branch_id: string;
  qty_on_hand: number;
  reorder_point: number;
  recommended_qty: number;
  selected_vendor_id: string | null;
  vendor_name: string | null;
  vendor_selection_reason: string | null;
  estimated_unit_cost: number | null;
  estimated_total: number | null;
  status: QueueStatus;
  scheduled_for: string | null;
  forecast_driven: boolean;
  forecast_covered_days: number | null;
  vendor_price_corroborated: boolean;
  cdk_vendor_list_price: number | null;
  potential_overpay_flag: boolean;
  source_type: SourceType;
  originating_play_id: string | null;
  po_reference: string | null;
  part_description: string | null;
  live_on_hand: number | null;
  current_list_price: number | null;

  // Predictive-play breadcrumb
  play_reason: string | null;
  play_projected_due: string | null;
  play_probability: number | null;
  customer_machine_make: string | null;
  customer_machine_model: string | null;
  customer_machine_hours: number | null;
  customer_name: string | null;

  created_at: string;
  ordered_at: string | null;
  approved_at: string | null;
}

export interface ReplenishSummary {
  kpis: {
    pending: number;
    scheduled: number;
    auto_approved: number;
    approved: number;
    ordered: number;
    overpay_flags: number;
    from_predictive: number;
    total_draft_value: number;
  };
  by_vendor: Array<{
    vendor_name: string;
    selected_vendor_id: string | null;
    item_count: number;
    total_usd: number;
    next_order_date: string | null;
    overpay_items: number;
    play_items: number;
    pending_items: number;
    scheduled_items: number;
    auto_approved_items: number;
  }>;
}

// ── reads ──────────────────────────────────────────────────

export async function fetchReplenishSummary(): Promise<ReplenishSummary> {
  const { data, error } = await supabase.rpc("replenish_queue_summary_v2");
  if (error) throw error;
  return normalizeReplenishSummary(data);
}

export async function fetchReplenishRows(
  opts: { vendorId?: string | null; statuses?: QueueStatus[]; limit?: number } = {}
): Promise<ReplenishRow[]> {
  let q = supabase
    .from("v_replenish_queue_enriched")
    .select("*")
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (opts.vendorId !== undefined) {
    if (opts.vendorId === null) {
      q = q.is("selected_vendor_id", null);
    } else {
      q = q.eq("selected_vendor_id", opts.vendorId);
    }
  }
  if (opts.statuses && opts.statuses.length > 0) {
    q = q.in("status", opts.statuses);
  } else {
    q = q.in("status", ["pending", "scheduled", "auto_approved", "approved"]);
  }
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return normalizeReplenishRows(data);
}

// ── mutations ──────────────────────────────────────────────

export async function approveRows(ids: string[]): Promise<{ approved_count: number }> {
  const { data, error } = await supabase.rpc("approve_replenish_rows", { p_ids: ids });
  if (error) throw error;
  return normalizeApprovedRowsResult(data);
}

export async function rejectRows(ids: string[], reason?: string): Promise<{ rejected_count: number }> {
  const { data, error } = await supabase.rpc("reject_replenish_rows", {
    p_ids: ids,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return normalizeRejectedRowsResult(data);
}

export async function markOrdered(ids: string[], poReference?: string): Promise<{ ordered_count: number }> {
  const { data, error } = await supabase.rpc("mark_replenish_ordered", {
    p_ids: ids,
    p_po_reference: poReference ?? null,
  });
  if (error) throw error;
  return normalizeOrderedRowsResult(data);
}

export async function updateQty(id: string, newQty: number): Promise<{ new_qty: number; new_total: number }> {
  const { data, error } = await supabase.rpc("update_replenish_qty", {
    p_id: id,
    p_new_qty: newQty,
  });
  if (error) throw error;
  return normalizeUpdatedQtyResult(data);
}
