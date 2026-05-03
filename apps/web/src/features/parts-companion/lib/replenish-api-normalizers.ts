import type { QueueStatus, ReplenishRow, ReplenishSummary, SourceType } from "./replenish-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function queueStatus(value: unknown): QueueStatus {
  return value === "pending" ||
    value === "scheduled" ||
    value === "auto_approved" ||
    value === "approved" ||
    value === "rejected" ||
    value === "ordered" ||
    value === "expired"
    ? value
    : "pending";
}

function sourceType(value: unknown): SourceType {
  return value === "rop_triggered" ||
    value === "predictive_play" ||
    value === "manual_entry" ||
    value === "api_import"
    ? value
    : "manual_entry";
}

export function normalizeReplenishSummary(value: unknown): ReplenishSummary {
  const record = objectValue(value);
  const kpis = objectValue(record.kpis);
  return {
    kpis: {
      pending: numberValue(kpis.pending) ?? 0,
      scheduled: numberValue(kpis.scheduled) ?? 0,
      auto_approved: numberValue(kpis.auto_approved) ?? 0,
      approved: numberValue(kpis.approved) ?? 0,
      ordered: numberValue(kpis.ordered) ?? 0,
      overpay_flags: numberValue(kpis.overpay_flags) ?? 0,
      from_predictive: numberValue(kpis.from_predictive) ?? 0,
      total_draft_value: numberValue(kpis.total_draft_value) ?? 0,
    },
    by_vendor: Array.isArray(record.by_vendor)
      ? record.by_vendor.map(normalizeReplenishVendorSummary).filter((row): row is ReplenishSummary["by_vendor"][number] => row !== null)
      : [],
  };
}

function normalizeReplenishVendorSummary(value: unknown): ReplenishSummary["by_vendor"][number] | null {
  if (!isRecord(value)) return null;
  return {
    vendor_name: stringValue(value.vendor_name, "Unassigned vendor"),
    selected_vendor_id: nullableString(value.selected_vendor_id),
    item_count: numberValue(value.item_count) ?? 0,
    total_usd: numberValue(value.total_usd) ?? 0,
    next_order_date: nullableString(value.next_order_date),
    overpay_items: numberValue(value.overpay_items) ?? 0,
    play_items: numberValue(value.play_items) ?? 0,
    pending_items: numberValue(value.pending_items) ?? 0,
    scheduled_items: numberValue(value.scheduled_items) ?? 0,
    auto_approved_items: numberValue(value.auto_approved_items) ?? 0,
  };
}

export function normalizeReplenishRows(rows: unknown): ReplenishRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeReplenishRow).filter((row): row is ReplenishRow => row !== null);
}

function normalizeReplenishRow(value: unknown): ReplenishRow | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const partNumber = nullableString(value.part_number);
  const branchId = nullableString(value.branch_id);
  const createdAt = nullableString(value.created_at);
  if (!id || !partNumber || !branchId || !createdAt) return null;
  return {
    id,
    part_number: partNumber,
    branch_id: branchId,
    qty_on_hand: numberValue(value.qty_on_hand) ?? 0,
    reorder_point: numberValue(value.reorder_point) ?? 0,
    recommended_qty: numberValue(value.recommended_qty) ?? 0,
    selected_vendor_id: nullableString(value.selected_vendor_id),
    vendor_name: nullableString(value.vendor_name),
    vendor_selection_reason: nullableString(value.vendor_selection_reason),
    estimated_unit_cost: numberValue(value.estimated_unit_cost),
    estimated_total: numberValue(value.estimated_total),
    status: queueStatus(value.status),
    scheduled_for: nullableString(value.scheduled_for),
    forecast_driven: booleanValue(value.forecast_driven),
    forecast_covered_days: numberValue(value.forecast_covered_days),
    vendor_price_corroborated: booleanValue(value.vendor_price_corroborated),
    cdk_vendor_list_price: numberValue(value.cdk_vendor_list_price),
    potential_overpay_flag: booleanValue(value.potential_overpay_flag),
    source_type: sourceType(value.source_type),
    originating_play_id: nullableString(value.originating_play_id),
    po_reference: nullableString(value.po_reference),
    part_description: nullableString(value.part_description),
    live_on_hand: numberValue(value.live_on_hand),
    current_list_price: numberValue(value.current_list_price),
    play_reason: nullableString(value.play_reason),
    play_projected_due: nullableString(value.play_projected_due),
    play_probability: numberValue(value.play_probability),
    customer_machine_make: nullableString(value.customer_machine_make),
    customer_machine_model: nullableString(value.customer_machine_model),
    customer_machine_hours: numberValue(value.customer_machine_hours),
    customer_name: nullableString(value.customer_name),
    created_at: createdAt,
    ordered_at: nullableString(value.ordered_at),
    approved_at: nullableString(value.approved_at),
  };
}

export function normalizeApprovedRowsResult(value: unknown): { approved_count: number } {
  return { approved_count: numberValue(objectValue(value).approved_count) ?? 0 };
}

export function normalizeRejectedRowsResult(value: unknown): { rejected_count: number } {
  return { rejected_count: numberValue(objectValue(value).rejected_count) ?? 0 };
}

export function normalizeOrderedRowsResult(value: unknown): { ordered_count: number } {
  return { ordered_count: numberValue(objectValue(value).ordered_count) ?? 0 };
}

export function normalizeUpdatedQtyResult(value: unknown): { new_qty: number; new_total: number } {
  const record = objectValue(value);
  return {
    new_qty: numberValue(record.new_qty) ?? 0,
    new_total: numberValue(record.new_total) ?? 0,
  };
}
