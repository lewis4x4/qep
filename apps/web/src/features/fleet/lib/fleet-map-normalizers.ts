export interface FleetEquipmentRow {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  company_id: string | null;
  metadata: Record<string, unknown>;
}

export interface FleetTelemetryRow {
  equipment_id: string;
  last_lat: number | null;
  last_lng: number | null;
  last_reading_at: string | null;
}

export interface FleetCoordinate {
  lat: number;
  lng: number;
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

function validYearOrNull(value: unknown): number | null {
  const parsed = finiteNumberOrNull(value);
  if (parsed === null) return null;
  const rounded = Math.trunc(parsed);
  return rounded >= 1900 && rounded <= 2200 ? rounded : null;
}

function validDateStringOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

export function normalizeFleetEquipmentRows(rows: unknown): FleetEquipmentRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    if (!id) return [];

    const make = stringOrNull(row.make);
    const model = stringOrNull(row.model);
    const year = validYearOrNull(row.year);
    const fallbackName = [year, make, model].filter(Boolean).join(" ").trim();

    const explicitName = stringOrNull(row.name);
    const name = explicitName ?? (fallbackName || "Unnamed asset");

    return [{
      id,
      name,
      make,
      model,
      year,
      engine_hours: finiteNumberOrNull(row.engine_hours),
      company_id: stringOrNull(row.company_id),
      metadata: isRecord(row.metadata) ? row.metadata : {},
    }];
  });
}

export function normalizeFleetTelemetryRows(rows: unknown): FleetTelemetryRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const equipmentId = stringOrNull(row.equipment_id);
    if (!equipmentId) return [];

    return [{
      equipment_id: equipmentId,
      last_lat: finiteNumberOrNull(row.last_lat),
      last_lng: finiteNumberOrNull(row.last_lng),
      last_reading_at: validDateStringOrNull(row.last_reading_at),
    }];
  });
}

export function resolveFleetCoordinate(
  equipment: FleetEquipmentRow,
  telemetry: FleetTelemetryRow | undefined,
): FleetCoordinate | null {
  if (telemetry?.last_lat != null && telemetry.last_lng != null) {
    return { lat: telemetry.last_lat, lng: telemetry.last_lng };
  }

  const lat = finiteNumberOrNull(equipment.metadata.lat);
  const lng = finiteNumberOrNull(equipment.metadata.lng);
  return lat != null && lng != null ? { lat, lng } : null;
}
