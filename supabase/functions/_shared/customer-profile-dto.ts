import type { UserRole } from "./dge-auth.ts";
import type { DataBadge } from "./integration-types.ts";

export interface CustomerProfileRow {
  id: string;
  hubspot_contact_id: string | null;
  intellidealer_customer_id: string | null;
  customer_name: string;
  company_name: string | null;
  pricing_persona: string | null;
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
  price_sensitivity_score: number | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

export interface FleetRow {
  id: string;
  equipment_serial: string | null;
  make: string;
  model: string;
  year: number | null;
  current_hours: number | null;
  predicted_replacement_date: string | null;
  replacement_confidence: number | null;
}

interface MapperInput {
  row: CustomerProfileRow;
  role: UserRole | null;
  isServiceRole: boolean;
  includeFleet: boolean;
  fleet: FleetRow[];
  dataBadges?: DataBadge[];
}

function parseDataBadges(value: unknown): DataBadge[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<DataBadge>();
  for (const item of value) {
    if (
      item === "LIVE" ||
      item === "DEMO" ||
      item === "ESTIMATED" ||
      item === "STALE_CACHE" ||
      item === "LIMITED_MARKET_DATA" ||
      item === "AI_OFFLINE"
    ) {
      unique.add(item);
    }
  }
  return [...unique];
}

function withFallbackDataBadges(
  metadataBadges: DataBadge[],
  explicitBadges: DataBadge[] | undefined,
): DataBadge[] {
  const merged = [...metadataBadges, ...(explicitBadges ?? [])];
  if (merged.length === 0) return ["DEMO"];
  return [...new Set(merged)];
}

function canSeeManagerFields(
  role: UserRole | null,
  isServiceRole: boolean,
): boolean {
  if (isServiceRole) return true;
  return role === "admin" || role === "manager" || role === "owner";
}

export function mapCustomerProfileDto(
  input: MapperInput,
): Record<string, unknown> {
  const metadata = input.row.metadata ?? {};
  const personaReasoning = typeof metadata.persona_reasoning === "string"
    ? metadata.persona_reasoning
    : null;
  const metadataBadges = parseDataBadges(metadata.data_badges);
  const dataBadges = withFallbackDataBadges(metadataBadges, input.dataBadges);
  const managerFieldsVisible = canSeeManagerFields(
    input.role,
    input.isServiceRole,
  );

  return {
    id: input.row.id,
    hubspot_contact_id: input.row.hubspot_contact_id,
    intellidealer_customer_id: input.row.intellidealer_customer_id,
    customer_name: input.row.customer_name,
    company_name: input.row.company_name,
    pricing_persona: input.row.pricing_persona,
    persona_confidence: input.row.persona_confidence ?? 0,
    persona_reasoning: personaReasoning,
    persona_model_version: input.row.persona_model_version,
    total_lifetime_value: input.row.lifetime_value ?? 0,
    total_deals: input.row.total_deals ?? 0,
    avg_deal_size: input.row.avg_deal_size ?? 0,
    avg_days_to_close: input.row.avg_days_to_close,
    price_sensitivity_score: input.row.price_sensitivity_score ?? 0,
    fleet_size: input.row.fleet_size ?? 0,
    last_interaction_at: input.row.last_interaction_at,
    updated_at: input.row.updated_at,
    data_badges: dataBadges,
    behavioral_signals: managerFieldsVisible
      ? {
        avg_discount_pct: input.row.avg_discount_pct,
        attachment_rate: input.row.attachment_rate,
        service_contract_rate: input.row.service_contract_rate,
        seasonal_pattern: input.row.seasonal_pattern,
      }
      : undefined,
    fleet: managerFieldsVisible && input.includeFleet ? input.fleet : undefined,
  };
}
