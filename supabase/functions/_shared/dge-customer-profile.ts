import type { AppRole } from "./dge-auth.ts";

export type PricingPersona =
  | "value_driven"
  | "relationship_loyal"
  | "budget_constrained"
  | "urgency_buyer"
  | null;

export interface CustomerProfileRow {
  id: string;
  hubspot_contact_id: string | null;
  intellidealer_customer_id: string | null;
  customer_name: string;
  company_name: string | null;
  pricing_persona: PricingPersona;
  persona_confidence: number | null;
  persona_model_version: string | null;
  lifetime_value: number | null;
  total_deals: number | null;
  avg_deal_size: number | null;
  avg_discount_pct: number | null;
  avg_days_to_close: number | null;
  attachment_rate: number | null;
  service_contract_rate: number | null;
  fleet_size: number | null;
  seasonal_pattern: string | null;
  last_interaction_at: string | null;
  updated_at: string;
  price_sensitivity_score: number | null;
  metadata: Record<string, unknown> | null;
}

export interface CustomerSignals {
  quote_to_close_ratio: number;
  preferred_financing: string;
  attachment_attach_rate: number;
  service_contract_rate: number;
  seasonal_pattern: string;
}

export interface CustomerFleetUnit {
  make: string;
  model: string;
  year: number;
  hours: number;
  serial: string;
}

export interface CustomerFleet {
  size: number;
  avg_age: number;
  avg_hours: number;
  units: CustomerFleetUnit[];
}

export interface CustomerProfileDto {
  profile_id: string;
  hubspot_contact_id: string | null;
  intellidealer_customer_id: string | null;
  customer_name: string;
  company_name: string | null;
  pricing_persona: PricingPersona;
  persona_confidence: number;
  persona_reasoning: string;
  is_cold_start: boolean;
  total_lifetime_value: number;
  avg_deal_size: number;
  price_sensitivity_score: number;
  last_updated: string;
  model_version: number;
  profile_completeness: number;
  signals?: CustomerSignals;
  fleet?: CustomerFleet;
}

export interface CustomerProfileViewOptions {
  includeFleet: boolean;
  role: AppRole;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseModelVersion(raw: string | null): number {
  if (!raw) return 1;
  const matched = raw.match(/\d+/);
  if (!matched) return 1;
  return Number.parseInt(matched[0], 10) || 1;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computeCompleteness(row: CustomerProfileRow): number {
  const checks = [
    !!row.pricing_persona,
    (row.total_deals ?? 0) > 0,
    (row.lifetime_value ?? 0) > 0,
    row.avg_deal_size !== null,
    row.price_sensitivity_score !== null,
    row.last_interaction_at !== null,
  ];
  const present = checks.filter(Boolean).length;
  return Math.round((present / checks.length) * 100) / 100;
}

function canViewSignals(role: AppRole): boolean {
  return role === "admin" || role === "manager" || role === "owner";
}

export function toCustomerProfileDto(
  row: CustomerProfileRow,
  options: CustomerProfileViewOptions,
): CustomerProfileDto {
  const metadata = asObject(row.metadata);
  const signalsData = asObject(metadata.signals);
  const fleetData = asObject(metadata.fleet);

  const totalDeals = row.total_deals ?? 0;
  const isColdStart = totalDeals < 3;

  const personaConfidence = clamp(asNumber(row.persona_confidence, 0), 0, 1);
  const personaReasoning = asString(
    metadata.persona_reasoning,
    row.pricing_persona
      ? `Profile classified as ${row.pricing_persona.replaceAll("_", " ")}.`
      : "New customer profile with limited historical activity.",
  );

  const dto: CustomerProfileDto = {
    profile_id: row.id,
    hubspot_contact_id: row.hubspot_contact_id,
    intellidealer_customer_id: row.intellidealer_customer_id,
    customer_name: row.customer_name,
    company_name: row.company_name,
    pricing_persona: row.pricing_persona,
    persona_confidence: personaConfidence,
    persona_reasoning: personaReasoning,
    is_cold_start: isColdStart,
    total_lifetime_value: asNumber(row.lifetime_value, 0),
    avg_deal_size: asNumber(row.avg_deal_size, 0),
    price_sensitivity_score: clamp(asNumber(row.price_sensitivity_score, 0), 0, 1),
    last_updated: row.updated_at,
    model_version: parseModelVersion(row.persona_model_version),
    profile_completeness: computeCompleteness(row),
  };

  if (canViewSignals(options.role)) {
    dto.signals = {
      quote_to_close_ratio: clamp(asNumber(signalsData.quote_to_close_ratio, 0), 0, 99),
      preferred_financing: asString(signalsData.preferred_financing, "unknown"),
      attachment_attach_rate: clamp(asNumber(row.attachment_rate, 0), 0, 1),
      service_contract_rate: clamp(asNumber(row.service_contract_rate, 0), 0, 1),
      seasonal_pattern: asString(row.seasonal_pattern, "steady"),
    };
  }

  if (canViewSignals(options.role) && options.includeFleet) {
    const units = Array.isArray(fleetData.units)
      ? fleetData.units
          .map((unit): CustomerFleetUnit | null => {
            const asUnit = asObject(unit);
            const make = asString(asUnit.make);
            const model = asString(asUnit.model);
            if (!make || !model) {
              return null;
            }
            return {
              make,
              model,
              year: asNumber(asUnit.year, 0),
              hours: asNumber(asUnit.hours, 0),
              serial: asString(asUnit.serial, "unknown"),
            };
          })
          .filter((unit): unit is CustomerFleetUnit => unit !== null)
      : [];

    dto.fleet = {
      size: row.fleet_size ?? units.length,
      avg_age: asNumber(fleetData.avg_age, 0),
      avg_hours: asNumber(fleetData.avg_hours, 0),
      units,
    };
  }

  return dto;
}
