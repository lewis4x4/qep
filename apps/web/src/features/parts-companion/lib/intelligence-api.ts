// ============================================================
// Parts Intelligence Engine — Phase 2 dashboard API adapter
// ============================================================

import { supabase } from "../../../lib/supabase";

export interface IntelligenceKpis {
  total_parts: number;
  hot_parts: number;
  dead_parts: number;
  stockout_critical: number;
  dead_capital_usd: number;
  margin_erosion_parts: number;
  forecast_coverage: number;
}

export interface StockoutRow {
  part_number: string;
  branch_code: string | null;
  description: string | null;
  on_hand: number | null;
  days_of_stock: number | null;
  stockout_risk: string;
  daily_velocity: number | null;
  list_price: number | null;
}

export interface HotMoverRow {
  part_number: string;
  branch_code: string | null;
  description: string | null;
  history_12mo_sales: number;
  yoy_growth_pct: number | null;
  on_hand: number | null;
  capital_on_hand: number;
}

export interface DeadCapitalRow {
  part_number: string;
  branch_code: string | null;
  description: string | null;
  on_hand: number | null;
  cost_price: number | null;
  capital_on_hand: number;
  dead_pattern: "cooling_down" | "truly_dead";
}

export interface MarginErosionRow {
  part_number: string;
  branch_code: string | null;
  list_price: number | null;
  cost_price: number | null;
  vendor_list_price: number | null;
  margin_pct_on_cost: number | null;
  margin_pct_on_vendor_list: number | null;
}

export interface IntelligenceSummary {
  kpis: IntelligenceKpis;
  stockout_heat: StockoutRow[];
  hot_movers: HotMoverRow[];
  dead_capital: DeadCapitalRow[];
  margin_erosion: MarginErosionRow[];
}

export async function fetchIntelligenceSummary(): Promise<IntelligenceSummary> {
  const { data, error } = await supabase.rpc("parts_intelligence_summary", {
    p_workspace: null,
  });
  if (error) throw error;
  return data as IntelligenceSummary;
}

export async function runSeededForecast(months = 3): Promise<{
  ok: boolean;
  forecasts_written: number;
  batch_id: string;
  elapsed_ms: number;
}> {
  const { data, error } = await supabase.rpc("compute_seeded_forecast", {
    p_workspace: null,
    p_forecast_months: months,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    forecasts_written: number;
    batch_id: string;
    elapsed_ms: number;
  };
}

// ── Predictive Plays (Phase 3.3 moonshot) ──────────────────

export interface PredictivePlay {
  id: string;
  part_number: string;
  part_description: string | null;
  projection_window: "7d" | "14d" | "30d" | "60d" | "90d";
  projected_due_date: string;
  days_until_due: number;
  probability: number;
  reason: string;
  signal_type:
    | "hours_based_interval"
    | "date_based_schedule"
    | "common_wear_pattern"
    | "yoy_demand_spike"
    | "manual_curation"
    | "ai_inferred";
  recommended_order_qty: number;
  projected_revenue: number | null;
  status: "open" | "actioned" | "dismissed" | "expired" | "fulfilled";
  suggested_order_by: string | null;
  customer_name: string | null;
  machine_make: string | null;
  machine_model: string | null;
  machine_hours: number | null;
  current_on_hand_across_branches: number | null;
  suggested_vendor_name: string | null;
}

export interface PredictivePlaysSummary {
  kpis: {
    open_plays: number;
    plays_due_7d: number;
    plays_needing_order: number;
    projected_revenue_90d: number;
    customers_touched: number;
  };
  plays: PredictivePlay[];
}

export async function fetchPredictivePlays(): Promise<PredictivePlaysSummary> {
  const { data, error } = await supabase.rpc("predictive_plays_summary", {
    p_workspace: null,
  });
  if (error) throw error;
  return data as PredictivePlaysSummary;
}

export async function runPredictivePrediction(lookaheadDays = 90): Promise<{
  ok: boolean;
  plays_written: number;
  machines_scanned: number;
  elapsed_ms: number;
}> {
  const { data, error } = await supabase.rpc("predict_parts_needs", {
    p_workspace: null,
    p_lookahead_days: lookaheadDays,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    plays_written: number;
    machines_scanned: number;
    elapsed_ms: number;
  };
}

export async function actionPlay(
  playId: string,
  action: "actioned" | "dismissed" | "fulfilled" | "open",
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("action_predictive_play", {
    p_play_id: playId,
    p_action: action,
    p_note: note ?? null,
  });
  if (error) throw error;
}
