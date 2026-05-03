import type {
  CustomerBehaviorSignals,
  CustomerFleetUnit,
  CustomerProfileResponse,
  DataBadge,
  MarketValuationResult,
  ValuationSourceBreakdown,
} from "../types";

export interface EdgeErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export interface VariableBreakdown {
  id: string;
  variable_name: string;
  variable_value: number;
  variable_unit: string;
  weight: number;
  impact_direction: "positive" | "negative" | "neutral";
  description: string;
  display_order: number;
}

export interface Scenario {
  id?: string;
  type: string;
  label: string;
  equipment_price?: number;
  trade_allowance?: number;
  total_deal_value?: number;
  total_margin?: number;
  margin_pct?: number;
  close_probability?: number;
  expected_value?: number;
  reasoning?: string;
  scenario_type?: string;
  dge_variable_breakdown?: VariableBreakdown[];
}

export interface ScenarioResponse {
  scenarios: Array<Scenario & { id: string; scenario_type: string }>;
  selected_scenario: string | null;
}

const DATA_BADGES = new Set<DataBadge>([
  "LIVE",
  "DEMO",
  "ESTIMATED",
  "STALE_CACHE",
  "LIMITED_MARKET_DATA",
  "AI_OFFLINE",
]);

const IMPACT_DIRECTIONS = new Set<VariableBreakdown["impact_direction"]>([
  "positive",
  "negative",
  "neutral",
]);

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

function finiteNumberOrDefault(value: unknown, fallback = 0): number {
  return finiteNumberOrNull(value) ?? fallback;
}

function integerOrNull(value: unknown): number | null {
  const parsed = finiteNumberOrNull(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function validDateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function normalizeDataBadges(value: unknown): DataBadge[] {
  if (!Array.isArray(value)) return [];
  return value.filter((badge): badge is DataBadge => typeof badge === "string" && DATA_BADGES.has(badge as DataBadge));
}

export function getDgeEdgeErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return fallback;
  return stringOrNull(payload.error.message) ?? fallback;
}

function normalizeSourceBreakdown(value: unknown): ValuationSourceBreakdown[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const source = stringOrNull(row.source);
    const value = finiteNumberOrNull(row.value);
    const weight = finiteNumberOrNull(row.weight);
    const confidence = finiteNumberOrNull(row.confidence);
    if (!source || value == null || weight == null || confidence == null) return [];
    return [{ source, value, weight, confidence }];
  });
}

export function normalizeMarketValuationResult(payload: unknown): MarketValuationResult {
  if (!isRecord(payload)) throw new Error("Malformed market valuation response.");

  const id = stringOrNull(payload.id);
  const estimatedFmv = finiteNumberOrNull(payload.estimated_fmv);
  const lowEstimate = finiteNumberOrNull(payload.low_estimate);
  const highEstimate = finiteNumberOrNull(payload.high_estimate);
  const confidenceScore = finiteNumberOrNull(payload.confidence_score);
  const source = stringOrNull(payload.source);
  const expiresAt = validDateStringOrNull(payload.expires_at);

  if (!id || estimatedFmv == null || lowEstimate == null || highEstimate == null || confidenceScore == null || !source || !expiresAt) {
    throw new Error("Malformed market valuation response.");
  }

  return {
    id,
    estimated_fmv: estimatedFmv,
    low_estimate: lowEstimate,
    high_estimate: highEstimate,
    confidence_score: confidenceScore,
    source,
    source_breakdown: normalizeSourceBreakdown(payload.source_breakdown),
    data_badges: normalizeDataBadges(payload.data_badges),
    expires_at: expiresAt,
  };
}

function normalizeBehaviorSignals(value: unknown): CustomerBehaviorSignals | undefined {
  if (!isRecord(value)) return undefined;
  return {
    avg_discount_pct: finiteNumberOrNull(value.avg_discount_pct),
    attachment_rate: finiteNumberOrNull(value.attachment_rate),
    service_contract_rate: finiteNumberOrNull(value.service_contract_rate),
    seasonal_pattern: stringOrNull(value.seasonal_pattern),
  };
}

function normalizeFleetUnits(value: unknown): CustomerFleetUnit[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const make = stringOrNull(row.make);
    const model = stringOrNull(row.model);
    if (!id || !make || !model) return [];

    return [{
      id,
      equipment_serial: stringOrNull(row.equipment_serial),
      make,
      model,
      year: integerOrNull(row.year),
      current_hours: finiteNumberOrNull(row.current_hours),
      predicted_replacement_date: validDateStringOrNull(row.predicted_replacement_date),
      replacement_confidence: finiteNumberOrNull(row.replacement_confidence),
    }];
  });
}

export function normalizeCustomerProfileResponse(payload: unknown): CustomerProfileResponse {
  if (!isRecord(payload)) throw new Error("Malformed customer profile response.");

  const id = stringOrNull(payload.id);
  const customerName = stringOrNull(payload.customer_name);
  const updatedAt = validDateStringOrNull(payload.updated_at);
  if (!id || !customerName || !updatedAt) {
    throw new Error("Malformed customer profile response.");
  }

  const behaviorSignals = normalizeBehaviorSignals(payload.behavioral_signals);
  const fleet = normalizeFleetUnits(payload.fleet);

  return {
    id,
    hubspot_contact_id: stringOrNull(payload.hubspot_contact_id),
    intellidealer_customer_id: stringOrNull(payload.intellidealer_customer_id),
    crm_company_id: stringOrNull(payload.crm_company_id),
    customer_name: customerName,
    company_name: stringOrNull(payload.company_name),
    industry: stringOrNull(payload.industry),
    region: stringOrNull(payload.region),
    pricing_persona: stringOrNull(payload.pricing_persona),
    persona_confidence: finiteNumberOrDefault(payload.persona_confidence),
    persona_reasoning: stringOrNull(payload.persona_reasoning),
    persona_model_version: stringOrNull(payload.persona_model_version),
    total_lifetime_value: finiteNumberOrDefault(payload.total_lifetime_value),
    total_deals: finiteNumberOrDefault(payload.total_deals),
    avg_deal_size: finiteNumberOrDefault(payload.avg_deal_size),
    avg_days_to_close: finiteNumberOrNull(payload.avg_days_to_close),
    price_sensitivity_score: finiteNumberOrDefault(payload.price_sensitivity_score),
    fleet_size: finiteNumberOrDefault(payload.fleet_size),
    budget_cycle_month: integerOrNull(payload.budget_cycle_month),
    budget_cycle_notes: stringOrNull(payload.budget_cycle_notes),
    fiscal_year_end_month: integerOrNull(payload.fiscal_year_end_month),
    notes: stringOrNull(payload.notes),
    last_interaction_at: validDateStringOrNull(payload.last_interaction_at),
    updated_at: updatedAt,
    data_badges: normalizeDataBadges(payload.data_badges),
    tax_regulatory: isRecord(payload.tax_regulatory)
      ? {
          ein: stringOrNull(payload.tax_regulatory.ein) ?? "",
          ein_masked: payload.tax_regulatory.ein_masked === true,
        }
      : undefined,
    behavioral_signals: behaviorSignals,
    fleet,
  };
}

function normalizeVariableBreakdown(value: unknown): VariableBreakdown[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const name = stringOrNull(row.variable_name);
    if (!id || !name) return [];
    const impact = stringOrNull(row.impact_direction);

    return [{
      id,
      variable_name: name,
      variable_value: finiteNumberOrDefault(row.variable_value),
      variable_unit: stringOrNull(row.variable_unit) ?? "raw",
      weight: finiteNumberOrDefault(row.weight),
      impact_direction: impact && IMPACT_DIRECTIONS.has(impact as VariableBreakdown["impact_direction"])
        ? impact as VariableBreakdown["impact_direction"]
        : "neutral",
      description: stringOrNull(row.description) ?? "",
      display_order: integerOrNull(row.display_order) ?? 0,
    }];
  });
}

function normalizeScenarioRow(row: unknown): Scenario | null {
  if (!isRecord(row)) return null;
  const scenarioType = stringOrNull(row.scenario_type) ?? stringOrNull(row.type);
  if (!scenarioType) return null;

  return {
    id: stringOrNull(row.id) ?? undefined,
    scenario_type: stringOrNull(row.scenario_type) ?? undefined,
    type: stringOrNull(row.type) ?? scenarioType,
    label: stringOrNull(row.label) ?? scenarioType,
    equipment_price: finiteNumberOrNull(row.equipment_price) ?? undefined,
    trade_allowance: finiteNumberOrNull(row.trade_allowance) ?? undefined,
    total_deal_value: finiteNumberOrNull(row.total_deal_value) ?? undefined,
    total_margin: finiteNumberOrNull(row.total_margin) ?? undefined,
    margin_pct: finiteNumberOrNull(row.margin_pct) ?? undefined,
    close_probability: finiteNumberOrNull(row.close_probability) ?? undefined,
    expected_value: finiteNumberOrNull(row.expected_value) ?? undefined,
    reasoning: stringOrNull(row.reasoning) ?? undefined,
    dge_variable_breakdown: normalizeVariableBreakdown(row.dge_variable_breakdown),
  };
}

export function normalizeDgeScenarioList(payload: unknown): Scenario[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.scenarios)
      ? payload.scenarios
      : [];

  return rows.flatMap((row) => {
    const scenario = normalizeScenarioRow(row);
    return scenario ? [scenario] : [];
  });
}

export function normalizeDgeScenarioResponse(payload: unknown): ScenarioResponse {
  if (!isRecord(payload)) return { scenarios: [], selected_scenario: null };

  const scenarios = normalizeDgeScenarioList(payload).flatMap((scenario) => {
    return scenario.id && scenario.scenario_type
      ? [{ ...scenario, id: scenario.id, scenario_type: scenario.scenario_type }]
      : [];
  });

  return {
    scenarios,
    selected_scenario: stringOrNull(payload.selected_scenario),
  };
}
