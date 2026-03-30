export type DataBadge =
  | "LIVE"
  | "DEMO"
  | "ESTIMATED"
  | "STALE_CACHE"
  | "LIMITED_MARKET_DATA"
  | "AI_OFFLINE";

export interface ValuationSourceBreakdown {
  source: string;
  value: number;
  weight: number;
  confidence: number;
}

export interface MarketValuationRequest {
  make: string;
  model: string;
  year: number;
  hours: number;
  condition: string;
  location?: string;
  stock_number?: string;
}

export interface MarketValuationResult {
  id: string;
  estimated_fmv: number;
  low_estimate: number;
  high_estimate: number;
  confidence_score: number;
  source: string;
  source_breakdown: ValuationSourceBreakdown[];
  data_badges: DataBadge[];
  expires_at: string;
}

export interface CustomerBehaviorSignals {
  avg_discount_pct: number | null;
  attachment_rate: number | null;
  service_contract_rate: number | null;
  seasonal_pattern: string | null;
}

export interface CustomerFleetUnit {
  id: string;
  equipment_serial: string | null;
  make: string;
  model: string;
  year: number | null;
  current_hours: number | null;
  predicted_replacement_date: string | null;
  replacement_confidence: number | null;
}

export interface CustomerProfileResponse {
  id: string;
  hubspot_contact_id: string | null;
  intellidealer_customer_id: string | null;
  customer_name: string;
  company_name: string | null;
  pricing_persona: string | null;
  persona_confidence: number;
  persona_reasoning: string | null;
  persona_model_version: string | null;
  total_lifetime_value: number;
  total_deals: number;
  avg_deal_size: number;
  avg_days_to_close: number | null;
  price_sensitivity_score: number;
  fleet_size: number;
  last_interaction_at: string | null;
  updated_at: string;
  data_badges: DataBadge[];
  behavioral_signals?: CustomerBehaviorSignals;
  fleet?: CustomerFleetUnit[];
}
