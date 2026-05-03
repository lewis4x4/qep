import type { CustomerHealthProfile } from "@/features/nervous-system/lib/nervous-system-api";
import type { Json } from "@/lib/database.types";

export interface CompanyHit {
  id: string;
  name: string | null;
  dba: string | null;
  legacy_customer_number: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
}

export interface EquipmentHit {
  id: string;
  serial_number: string | null;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  condition: string | null;
  engine_hours: number | null;
  last_inspection_at: string | null;
  next_service_due_at: string | null;
  location_description: string | null;
  company: {
    id: string;
    name: string | null;
    dba: string | null;
    phone: string | null;
  } | null;
}

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

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function isJsonRecord(value: Json | null | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonNumber(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeCompanyHits(rows: unknown): CompanyHit[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    if (!id) return [];
    return [{
      id,
      name: stringOrNull(value.name),
      dba: stringOrNull(value.dba),
      legacy_customer_number: stringOrNull(value.legacy_customer_number),
      phone: stringOrNull(value.phone),
      city: stringOrNull(value.city),
      state: stringOrNull(value.state),
    }];
  });
}

function normalizeEquipmentCompany(value: unknown): EquipmentHit["company"] {
  const row = firstRecord(value);
  const id = requiredString(row?.id);
  if (!row || !id) return null;
  return {
    id,
    name: stringOrNull(row.name),
    dba: stringOrNull(row.dba),
    phone: stringOrNull(row.phone),
  };
}

export function normalizeEquipmentHits(rows: unknown): EquipmentHit[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    if (!id) return [];
    return [{
      id,
      serial_number: stringOrNull(value.serial_number),
      name: stringOrNull(value.name),
      make: stringOrNull(value.make),
      model: stringOrNull(value.model),
      year: numberOrNull(value.year),
      condition: stringOrNull(value.condition),
      engine_hours: numberOrNull(value.engine_hours),
      last_inspection_at: stringOrNull(value.last_inspection_at),
      next_service_due_at: stringOrNull(value.next_service_due_at),
      location_description: stringOrNull(value.location_description),
      company: normalizeEquipmentCompany(value.company),
    }];
  });
}

export function normalizeCustomerHealthProfiles(rows: unknown): CustomerHealthProfile[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    if (!id) return [];
    const componentsSource = value.health_score_components as Json | null | undefined;
    const components = isJsonRecord(componentsSource)
      ? {
          deal_velocity: readJsonNumber(componentsSource.deal_velocity),
          service_engagement: readJsonNumber(componentsSource.service_engagement),
          parts_revenue: readJsonNumber(componentsSource.parts_revenue),
          financial_health: readJsonNumber(componentsSource.financial_health),
        }
      : null;

    return [{
      id,
      customer_name: requiredString(value.customer_name) ?? requiredString(value.company_name) ?? "Unnamed customer",
      company_name: stringOrNull(value.company_name),
      health_score: numberOrNull(value.health_score),
      health_score_components: components,
      health_score_updated_at: stringOrNull(value.health_score_updated_at),
      pricing_persona: stringOrNull(value.pricing_persona),
      lifetime_value: numberOrNull(value.lifetime_value),
    }];
  });
}
