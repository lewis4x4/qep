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

export interface AiPredictionResult {
  ok: boolean;
  machines_processed: number;
  plays_proposed: number;
  plays_grounded: number;
  plays_written: number;
  llm_errors: number;
  grounding_rejections: number;
  cost_cents: number;
  total_tokens_in: number;
  total_tokens_out: number;
  elapsed_ms: number;
  batch_id: string;
}

export async function runAiPredictions(maxMachines = 10): Promise<AiPredictionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const startedAt = new Date(Date.now() - 2_000).toISOString();

  try {
    const { data, error } = await supabase.functions.invoke("parts-predictive-ai", {
      body: { max_machines: maxMachines },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw error;
    return data as AiPredictionResult;
  } catch (err) {
    // The Supabase edge gateway sometimes drops the HTTP connection on calls
    // that take 10-20s (Claude + embedding + grounding chain). The server
    // actually completes successfully and writes to parts_llm_inference_runs.
    // Poll that table for up to 60s to see if the run landed.
    const msg = (err as Error).message || "";
    const looksLikeTransportFailure =
      msg.includes("Failed to send a request") ||
      msg.includes("non-2xx") ||
      msg.includes("network") ||
      msg.includes("Edge Function");

    if (!looksLikeTransportFailure) throw err;

    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 2_000));
      const { data: recentRuns } = await supabase
        .from("parts_llm_inference_runs")
        .select("plays_proposed, plays_grounded, plays_written, tokens_in, tokens_out, cost_usd_cents, elapsed_ms, status, fleet_id, created_at")
        .gte("created_at", startedAt)
        .order("created_at", { ascending: false })
        .limit(20);

      if (recentRuns && recentRuns.length > 0) {
        // Aggregate across any runs that landed in this window
        const agg = recentRuns.reduce(
          (acc: { machines: Set<string>; proposed: number; grounded: number; written: number; tokens_in: number; tokens_out: number; cost_cents: number; elapsed: number }, r: any) => {
            if (r.fleet_id) acc.machines.add(r.fleet_id);
            acc.proposed += r.plays_proposed ?? 0;
            acc.grounded += r.plays_grounded ?? 0;
            acc.written += r.plays_written ?? 0;
            acc.tokens_in += r.tokens_in ?? 0;
            acc.tokens_out += r.tokens_out ?? 0;
            acc.cost_cents += Number(r.cost_usd_cents ?? 0);
            acc.elapsed = Math.max(acc.elapsed, r.elapsed_ms ?? 0);
            return acc;
          },
          { machines: new Set<string>(), proposed: 0, grounded: 0, written: 0, tokens_in: 0, tokens_out: 0, cost_cents: 0, elapsed: 0 },
        );

        return {
          ok: true,
          machines_processed: agg.machines.size,
          plays_proposed: agg.proposed,
          plays_grounded: agg.grounded,
          plays_written: agg.written,
          llm_errors: 0,
          grounding_rejections: agg.proposed - agg.grounded,
          cost_cents: agg.cost_cents,
          total_tokens_in: agg.tokens_in,
          total_tokens_out: agg.tokens_out,
          elapsed_ms: agg.elapsed,
          batch_id: "recovered-from-gateway-timeout",
        } satisfies AiPredictionResult;
      }
    }

    // Polled for 60s, nothing landed — surface the original transport error.
    throw err;
  }
}

export interface ActionPlayResult {
  ok: boolean;
  play_id: string;
  status: string;
  queue_action: "created" | "reused_existing" | "none";
  queue_row_id: string | null;
}

export interface EmbedBackfillResult {
  ok: boolean;
  called_by: string;
  elapsed_ms: number;
  batches: number;
  rows_embedded: number;
  rows_skipped: number;
  rows_errored: number;
  api_calls: number;
  rows_remaining: number | null;
}

export async function runEmbedBackfill(maxBatches = 100): Promise<EmbedBackfillResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const { data, error } = await supabase.functions.invoke("parts-embed-backfill", {
    body: { max_batches: maxBatches },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return data as EmbedBackfillResult;
}

export async function actionPlay(
  playId: string,
  action: "actioned" | "dismissed" | "fulfilled" | "open",
  note?: string,
): Promise<ActionPlayResult> {
  const { data, error } = await supabase.rpc("action_predictive_play", {
    p_play_id: playId,
    p_action: action,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as ActionPlayResult;
}
