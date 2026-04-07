import { supabase } from "@/lib/supabase";

export interface Account360Company {
  id: string;
  name: string;
  workspace_id: string;
  city?: string | null;
  state?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Account360Profile {
  id?: string;
  budget_cycle_month?: number | null;
  fiscal_year_end_month?: number | null;
  health_score?: number | null;
  health_score_components?: Record<string, unknown> | null;
  health_score_updated_at?: string | null;
  last_interaction_at?: string | null;
  lifetime_value?: number | null;
  total_deals?: number | null;
}

export interface Account360FleetItem {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  serial_number: string | null;
  asset_tag: string | null;
  stage_label: string | null;
  eta: string | null;
  stage_updated: string | null;
}

export interface Account360OpenQuote {
  id: string;
  deal_id: string;
  status: string;
  net_total: number | null;
  expires_at: string | null;
  created_at: string;
  deal_name: string | null;
}

export interface Account360ServiceJob {
  id: string;
  current_stage: string;
  customer_problem_summary: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  completed_at: string | null;
  machine_id: string | null;
}

export interface Account360PartsRollup {
  lifetime_total: number;
  order_count: number;
  recent: Array<{
    id: string;
    status: string;
    total: number;
    created_at: string;
  }>;
}

export interface Account360Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  status: string;
}

export interface Account360HealthDelta {
  current_score: number | null;
  components: Record<string, unknown>;
  delta_7d: number | null;
  delta_30d: number | null;
  delta_90d: number | null;
}

export interface Account360ARBlock {
  id: string;
  block_reason: string;
  block_threshold_days: number;
  current_max_aging_days: number | null;
  status: "active" | "overridden" | "cleared";
  override_until: string | null;
  blocked_at: string;
}

export interface Account360Response {
  company: Account360Company;
  profile: Account360Profile | null;
  fleet: Account360FleetItem[];
  open_quotes: Account360OpenQuote[];
  service: Account360ServiceJob[];
  parts: Account360PartsRollup;
  invoices: Account360Invoice[];
  health: Account360HealthDelta | null;
  ar_block: Account360ARBlock | null;
}

/** Single round-trip composite for the Account 360 page. */
export async function fetchAccount360(companyId: string): Promise<Account360Response | null> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Account360Response | null; error: unknown }>;
  }).rpc("get_account_360", { p_company_id: companyId });
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load Account 360"));
  return data;
}

export interface FleetRadarLensItem {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  trade_up_score?: number | null;
  lifetime_parts_spend?: number | null;
  lens: string;
  reason: string;
}

export interface FleetRadarResponse {
  aging: FleetRadarLensItem[];
  expensive: FleetRadarLensItem[];
  trade_up: FleetRadarLensItem[];
  underutilized: FleetRadarLensItem[];
  attachment_upsell: FleetRadarLensItem[];
}

export async function fetchFleetRadar(companyId: string): Promise<FleetRadarResponse | null> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: FleetRadarResponse | null; error: unknown }>;
  }).rpc("get_fleet_radar", { p_company_id: companyId });
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load Fleet Radar"));
  return data;
}
