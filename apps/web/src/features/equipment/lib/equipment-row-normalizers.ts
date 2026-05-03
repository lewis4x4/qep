export interface EquipmentPartsOrderRow {
  id: string;
  status: string;
  total: number | null;
  estimated_delivery: string | null;
  tracking_number: string | null;
  created_at: string;
}

export interface EquipmentTelematicsRow {
  provider: string;
  device_serial: string | null;
  last_hours: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_reading_at: string | null;
  is_active: boolean;
}

export interface EquipmentDocumentRow {
  id: string;
  title: string;
  document_type: string;
  file_url: string;
  customer_visible: boolean;
  updated_at: string;
}

export interface LifecycleSummaryRow {
  predicted_replacement_date: string | null;
  replacement_confidence: number | null;
  customer_health_score: number | null;
  revenue_breakdown: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanOrDefault(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function validDateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

export function hasNonNullRecordValue(value: unknown, key: string): boolean {
  return isRecord(value) && value[key] != null;
}

export function normalizeEquipmentPartsOrderRows(rows: unknown): EquipmentPartsOrderRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const createdAt = validDateStringOrNull(row.created_at);
    if (!id || !createdAt) return [];

    return [{
      id,
      status: stringOrNull(row.status) ?? "unknown",
      total: finiteNumberOrNull(row.total),
      estimated_delivery: validDateStringOrNull(row.estimated_delivery),
      tracking_number: stringOrNull(row.tracking_number),
      created_at: createdAt,
    }];
  });
}

export function normalizeEquipmentTelematicsRows(rows: unknown): EquipmentTelematicsRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const provider = stringOrNull(row.provider);
    const deviceSerial = stringOrNull(row.device_serial);
    const lastHours = finiteNumberOrNull(row.last_hours);
    const lastLat = finiteNumberOrNull(row.last_lat);
    const lastLng = finiteNumberOrNull(row.last_lng);
    const lastReadingAt = validDateStringOrNull(row.last_reading_at);
    if (!provider && !deviceSerial && lastHours == null && lastLat == null && lastLng == null && !lastReadingAt) return [];

    return [{
      provider: provider ?? "Unknown provider",
      device_serial: deviceSerial,
      last_hours: lastHours,
      last_lat: lastLat,
      last_lng: lastLng,
      last_reading_at: lastReadingAt,
      is_active: booleanOrDefault(row.is_active),
    }];
  });
}

export function normalizeEquipmentDocumentRows(rows: unknown): EquipmentDocumentRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const fileUrl = stringOrNull(row.file_url);
    const updatedAt = validDateStringOrNull(row.updated_at);
    if (!id || !fileUrl || !updatedAt) return [];

    return [{
      id,
      title: stringOrNull(row.title) ?? "Equipment document",
      document_type: stringOrNull(row.document_type) ?? "document",
      file_url: fileUrl,
      customer_visible: booleanOrDefault(row.customer_visible),
      updated_at: updatedAt,
    }];
  });
}

export function normalizeLifecycleSummary(row: unknown): LifecycleSummaryRow | null {
  if (!isRecord(row)) return null;

  return {
    predicted_replacement_date: validDateStringOrNull(row.predicted_replacement_date),
    replacement_confidence: finiteNumberOrNull(row.replacement_confidence),
    customer_health_score: finiteNumberOrNull(row.customer_health_score),
    revenue_breakdown: isRecord(row.revenue_breakdown) ? row.revenue_breakdown : null,
  };
}
