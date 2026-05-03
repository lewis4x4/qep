import type { HealthTier, SupplierHealthRow, SupplierHealthSummary } from "./supplier-health-api";

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

function healthTier(value: unknown): HealthTier {
  return value === "green" || value === "yellow" || value === "red" ? value : "yellow";
}

export function normalizeSupplierHealthSummary(value: unknown): SupplierHealthSummary {
  const record = objectValue(value);
  const counts = objectValue(record.counts);
  return {
    generated_at: stringValue(record.generated_at),
    workspace_id: stringValue(record.workspace_id, "default"),
    counts: {
      green: numberValue(counts.green) ?? 0,
      yellow: numberValue(counts.yellow) ?? 0,
      red: numberValue(counts.red) ?? 0,
      total: numberValue(counts.total) ?? 0,
    },
    red_vendors: normalizeSupplierHealthRiskRows(record.red_vendors),
    top_price_creep: normalizeSupplierHealthPriceCreepRows(record.top_price_creep),
    lowest_fill_rate: normalizeSupplierHealthFillRateRows(record.lowest_fill_rate),
    rows: normalizeSupplierHealthRows(record.rows),
  };
}

export function normalizeSupplierHealthRows(rows: unknown): SupplierHealthRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeSupplierHealthRow).filter((row): row is SupplierHealthRow => row !== null);
}

function normalizeSupplierHealthRow(value: unknown): SupplierHealthRow | null {
  if (!isRecord(value)) return null;
  const vendorId = nullableString(value.vendor_id);
  const vendorName = nullableString(value.vendor_name);
  if (!vendorId || !vendorName) return null;
  return {
    vendor_id: vendorId,
    vendor_name: vendorName,
    supplier_type: nullableString(value.supplier_type),
    avg_lead_time_hours: numberValue(value.avg_lead_time_hours),
    responsiveness_score: numberValue(value.responsiveness_score),
    profile_fill_rate: numberValue(value.profile_fill_rate),
    price_competitiveness: numberValue(value.price_competitiveness),
    profile_composite_score: numberValue(value.profile_composite_score),
    catalog_parts: numberValue(value.catalog_parts) ?? 0,
    parts_compared: numberValue(value.parts_compared),
    parts_up: numberValue(value.parts_up),
    parts_up_more_than_5pct: numberValue(value.parts_up_more_than_5pct),
    price_change_pct_yoy: numberValue(value.price_change_pct_yoy),
    replenish_items_90d: numberValue(value.replenish_items_90d),
    replenish_items_ordered: numberValue(value.replenish_items_ordered),
    fill_rate_pct_90d: numberValue(value.fill_rate_pct_90d),
    avg_approve_to_order_hours: numberValue(value.avg_approve_to_order_hours),
    last_price_file_at: nullableString(value.last_price_file_at),
    days_since_last_price_file: numberValue(value.days_since_last_price_file),
    health_tier: healthTier(value.health_tier),
  };
}

function normalizeSupplierHealthRiskRows(rows: unknown): SupplierHealthSummary["red_vendors"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const vendorId = nullableString(value.vendor_id);
    const vendorName = nullableString(value.vendor_name);
    if (!vendorId || !vendorName) return null;
    return {
      vendor_id: vendorId,
      vendor_name: vendorName,
      price_change_pct_yoy: numberValue(value.price_change_pct_yoy),
      fill_rate_pct_90d: numberValue(value.fill_rate_pct_90d),
      days_since_last_price_file: numberValue(value.days_since_last_price_file),
      health_tier: healthTier(value.health_tier),
    };
  }).filter((row): row is SupplierHealthSummary["red_vendors"][number] => row !== null);
}

function normalizeSupplierHealthPriceCreepRows(rows: unknown): SupplierHealthSummary["top_price_creep"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const vendorId = nullableString(value.vendor_id);
    const vendorName = nullableString(value.vendor_name);
    if (!vendorId || !vendorName) return null;
    return {
      vendor_id: vendorId,
      vendor_name: vendorName,
      price_change_pct_yoy: numberValue(value.price_change_pct_yoy),
      parts_up_more_than_5pct: numberValue(value.parts_up_more_than_5pct),
      parts_compared: numberValue(value.parts_compared),
    };
  }).filter((row): row is SupplierHealthSummary["top_price_creep"][number] => row !== null);
}

function normalizeSupplierHealthFillRateRows(rows: unknown): SupplierHealthSummary["lowest_fill_rate"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const vendorId = nullableString(value.vendor_id);
    const vendorName = nullableString(value.vendor_name);
    if (!vendorId || !vendorName) return null;
    return {
      vendor_id: vendorId,
      vendor_name: vendorName,
      fill_rate_pct_90d: numberValue(value.fill_rate_pct_90d),
      replenish_items_90d: numberValue(value.replenish_items_90d),
      replenish_items_ordered: numberValue(value.replenish_items_ordered),
    };
  }).filter((row): row is SupplierHealthSummary["lowest_fill_rate"][number] => row !== null);
}
