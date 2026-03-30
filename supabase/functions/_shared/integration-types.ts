/**
 * Shared TypeScript types for the DGE Integration Abstraction Layer.
 * All 8 integration adapters implement IntegrationAdapter<TConfig, TResult>.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core adapter types
// ─────────────────────────────────────────────────────────────────────────────

export type IntegrationKey =
  | "intellidealer"
  | "ironguides"
  | "rouse"
  | "aemp"
  | "financing"
  | "manufacturer_incentives"
  | "auction_data"
  | "fred_usda";

export type IntegrationStatusEnum =
  | "connected"
  | "pending_credentials"
  | "error"
  | "demo_mode";

export type SyncFrequency =
  | "realtime"
  | "hourly"
  | "every_6_hours"
  | "daily"
  | "weekly"
  | "manual";

export type DataBadge =
  | "LIVE"
  | "DEMO"
  | "ESTIMATED"
  | "STALE_CACHE"
  | "LIMITED_MARKET_DATA"
  | "AI_OFFLINE";

export type FailureReason =
  | "auth_error"
  | "rate_limited"
  | "upstream_timeout"
  | "upstream_5xx"
  | "contract_mismatch";

// ─────────────────────────────────────────────────────────────────────────────
// Integration status row (mirrors DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface IntegrationStatusRow {
  id: string;
  workspace_id: string;
  integration_key: IntegrationKey;
  display_name: string;
  status: IntegrationStatusEnum;
  credentials_encrypted: string | null;
  endpoint_url: string | null;
  auth_type: string;
  sync_frequency: SyncFrequency;
  last_sync_at: string | null;
  last_sync_records: number;
  last_sync_error: string | null;
  last_test_at: string | null;
  last_test_success: boolean | null;
  last_test_latency_ms: number | null;
  last_test_error: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter interface — every integration implements this
// ─────────────────────────────────────────────────────────────────────────────

export interface AdapterConfig {
  credentials?: Record<string, string>;
  endpointUrl?: string;
  config?: Record<string, unknown>;
}

export interface AdapterResult<T> {
  data: T;
  badge: DataBadge;
  isMock: boolean;
  latencyMs: number;
  source: string;
}

export interface IntegrationAdapter<TRequest, TResult> {
  readonly integrationKey: IntegrationKey;
  readonly isMock: boolean;
  execute(request: TRequest, config: AdapterConfig): Promise<AdapterResult<TResult>>;
  testConnection(config: AdapterConfig): Promise<{ success: boolean; latencyMs: number; error?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IntelliDealer types
// ─────────────────────────────────────────────────────────────────────────────

export interface IntelliDealerRequest {
  operation: "inventory" | "inventory_item" | "customers" | "deals";
  updatedSince?: string; // ISO-8601
  stockNumber?: string;
}

export interface IntelliDealerMachine {
  stock_number: string;
  make: string;
  model: string;
  year: number;
  hours: number;
  condition: string;
  list_price: number;
  cost_basis: number;
  inventory_status: string;
}

export interface IntelliDealerCustomer {
  external_id: string;
  name: string;
  segment: string;
}

export interface IntelliDealerDeal {
  external_id: string;
  status: string;
  closed_at: string | null;
}

export interface IntelliDealerResult {
  machines?: IntelliDealerMachine[];
  machine?: IntelliDealerMachine;
  customers?: IntelliDealerCustomer[];
  deals?: IntelliDealerDeal[];
}

// ─────────────────────────────────────────────────────────────────────────────
// IronGuides types
// ─────────────────────────────────────────────────────────────────────────────

export interface IronGuidesRequest {
  make: string;
  model: string;
  year: number;
  hours: number;
  zip?: string;
}

export interface IronGuidesComparable {
  source: string;
  price: number;
  location: string;
}

export interface IronGuidesResult {
  valuation_id: string;
  fair_market_value: number;
  low_estimate: number;
  high_estimate: number;
  confidence: number;
  comparables: IronGuidesComparable[];
  as_of: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rouse Analytics types
// ─────────────────────────────────────────────────────────────────────────────

export interface RouseRequest {
  category: string;
  region: string;
}

export interface RouseResult {
  category: string;
  region: string;
  daily_rate: number;
  weekly_rate: number;
  monthly_rate: number;
  utilization_pct: number;
  as_of: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AEMP 2.0 Telematics types
// ─────────────────────────────────────────────────────────────────────────────

export interface AempRequest {
  operation: "fleet_snapshot" | "unit_detail";
  unitSerial?: string;
  page?: number;
}

export interface AempUnit {
  serial_number: string;
  make: string;
  model: string;
  year: number;
  cumulative_operating_hours: number;
  last_reported_at: string;
  location?: { lat: number; lon: number };
}

export interface AempResult {
  units: AempUnit[];
  total_count: number;
  page: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Financing Partners types
// ─────────────────────────────────────────────────────────────────────────────

export interface FinancingRequest {
  amount: number;
  term_months: number;
  credit_tier?: string;
}

export interface FinancingRate {
  lender_name: string;
  rate_pct: number;
  dealer_holdback_pct: number;
  monthly_payment: number;
  term_months: number;
  credit_tier: string;
}

export interface FinancingResult {
  rates: FinancingRate[];
  as_of: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manufacturer Incentives types
// ─────────────────────────────────────────────────────────────────────────────

export interface IncentivesRequest {
  oem?: string;
  category?: string;
  model?: string;
}

export interface IncentiveProgram {
  oem_name: string;
  program_name: string;
  discount_type: "percentage" | "fixed_amount";
  discount_value: number;
  eligible_categories: string[];
  eligible_models: string[];
  stacking_rules: string;
  start_date: string;
  end_date: string | null;
}

export interface IncentivesResult {
  programs: IncentiveProgram[];
  as_of: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auction Data types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuctionDataRequest {
  make: string;
  model: string;
  yearMin?: number;
  yearMax?: number;
  limit?: number;
}

export interface AuctionResult {
  source: string;
  auction_date: string;
  make: string;
  model: string;
  year: number;
  hours: number;
  hammer_price: number;
  location: string;
  condition: string;
}

export interface AuctionDataResult {
  results: AuctionResult[];
  total_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRED / USDA Economic Data types
// ─────────────────────────────────────────────────────────────────────────────

export interface FredUsdaRequest {
  indicators: string[]; // FRED series IDs e.g. ['HOUST', 'TTLCONS']
  observationsLimit?: number;
}

export interface EconomicObservation {
  indicator_key: string;
  indicator_name: string;
  value: number;
  unit: string;
  observation_date: string;
  series_id: string;
}

export interface FredUsdaResult {
  observations: EconomicObservation[];
  as_of: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Market valuation composite request/result (used by market-valuation fn)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketValuationRequest {
  make: string;
  model: string;
  year: number;
  hours: number;
  condition: string;
  location?: string;
  stock_number?: string;
}

export interface ValuationSourceBreakdown {
  source: string;
  value: number;
  weight: number;
  confidence: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker state (in-memory per Edge Function instance)
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number | null;
  nextProbeAt: number | null;
}
