/**
 * Owner Dashboard API — typed client over the three new RPCs and
 * three new edge functions that power /owner.
 *
 * - owner_dashboard_summary()        → Tier 3 KPI grid
 * - compute_ownership_health_score() → Tier 1 health dial
 * - owner_event_feed()               → feeds morning brief prompt
 * - owner-morning-brief              → Claude narrative
 * - owner-ask-anything               → Claude w/ tool use
 * - owner-predictive-interventions   → forward-looking scenarios
 */
import { supabase } from "@/lib/supabase";

// ── RPC: owner_dashboard_summary ───────────────────────────────────────────
export interface OwnerDashboardSummary {
  generated_at: string;
  workspace_id: string;
  revenue: {
    today: number;
    mtd: number;
    prev_month_same_day: number;
    mtd_vs_prev_pct: number | null;
  };
  pipeline: {
    weighted_total: number;
    at_risk_count: number;
  };
  parts: {
    total_catalog: number;
    dead_capital_usd: number;
    stockout_critical: number;
    predictive_revenue_open: number;
    predictive_open_plays: number;
    replenish_pending: number;
    margin_erosion_flags: number;
    last_import_at: string | null;
  };
  finance: {
    ar_aged_90_plus: number;
  };
}

export async function fetchOwnerDashboardSummary(): Promise<OwnerDashboardSummary> {
  const { data, error } = await supabase.rpc("owner_dashboard_summary", {
    p_workspace: null,
  });
  if (error) throw new Error(`owner_dashboard_summary: ${error.message}`);
  return data as OwnerDashboardSummary;
}

// ── RPC: compute_ownership_health_score ───────────────────────────────────
export interface OwnershipHealthScore {
  score: number;
  generated_at: string;
  dimensions: {
    parts: number;
    sales: number;
    service: number;
    rental: number;
    finance: number;
  };
  weights: Record<string, number>;
  tier: "excellent" | "healthy" | "attention" | "critical";
}

export async function fetchOwnershipHealthScore(): Promise<OwnershipHealthScore> {
  const { data, error } = await supabase.rpc("compute_ownership_health_score", {
    p_workspace: null,
  });
  if (error) throw new Error(`compute_ownership_health_score: ${error.message}`);
  return data as OwnershipHealthScore;
}

// ── RPC: owner_event_feed ─────────────────────────────────────────────────
export interface OwnerEvent {
  type: string;
  at: string;
  summary: string;
  amount?: number;
  revenue?: number;
  id?: string;
}

export interface OwnerEventFeed {
  since: string;
  count: number;
  events: OwnerEvent[];
}

export async function fetchOwnerEventFeed(hoursBack = 24): Promise<OwnerEventFeed> {
  const { data, error } = await supabase.rpc("owner_event_feed", {
    p_workspace: null,
    p_hours_back: hoursBack,
  });
  if (error) throw new Error(`owner_event_feed: ${error.message}`);
  return data as OwnerEventFeed;
}

// ── View: v_branch_stack_ranking ──────────────────────────────────────────
export interface BranchStackRow {
  workspace_id: string;
  branch_code: string;
  parts_count: number;
  inventory_value: number;
  dead_parts: number;
  at_reorder_count: number;
  dead_pct: number;
  inventory_quartile: number;
  dead_parts_quartile_asc: number;
  reorder_quartile_asc: number;
}

export async function fetchBranchStackRanking(): Promise<BranchStackRow[]> {
  const { data, error } = await supabase
    .from("v_branch_stack_ranking")
    .select("*")
    .order("inventory_value", { ascending: false });
  if (error) throw new Error(`v_branch_stack_ranking: ${error.message}`);
  return (data ?? []) as BranchStackRow[];
}

// ── Edge: owner-morning-brief ─────────────────────────────────────────────
export interface OwnerMorningBrief {
  brief: string;
  generated_at: string;
  cached?: boolean;
  model?: string;
}

export async function fetchOwnerMorningBrief(
  opts: { refresh?: boolean } = {},
): Promise<OwnerMorningBrief> {
  const { data, error } = await supabase.functions.invoke<OwnerMorningBrief>(
    "owner-morning-brief",
    { body: { refresh: opts.refresh === true } },
  );
  if (error) throw new Error(`owner-morning-brief: ${error.message}`);
  if (!data) throw new Error("owner-morning-brief: empty response");
  return data;
}

// ── Edge: owner-ask-anything ──────────────────────────────────────────────
export interface OwnerAskAnythingMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
}

export interface OwnerAskAnythingResponse {
  answer: string;
  tool_trace: { tool: string; input: unknown; result: unknown }[];
  model?: string;
  elapsed_ms?: number;
}

export async function askOwnerAnything(
  question: string,
  history: OwnerAskAnythingMessage[] = [],
): Promise<OwnerAskAnythingResponse> {
  const { data, error } = await supabase.functions.invoke<OwnerAskAnythingResponse>(
    "owner-ask-anything",
    { body: { question, history } },
  );
  if (error) throw new Error(`owner-ask-anything: ${error.message}`);
  if (!data) throw new Error("owner-ask-anything: empty response");
  return data;
}

// ── Edge: owner-predictive-interventions ─────────────────────────────────
export interface PredictiveIntervention {
  title: string;
  projection: string;
  rationale: string;
  impact_usd?: number;
  horizon_days?: number;
  severity: "high" | "medium" | "low";
  action: {
    label: string;
    route: string;
  };
}

export interface PredictiveInterventionsResponse {
  interventions: PredictiveIntervention[];
  generated_at: string;
  model?: string;
}

export async function fetchPredictiveInterventions(): Promise<PredictiveInterventionsResponse> {
  const { data, error } = await supabase.functions.invoke<PredictiveInterventionsResponse>(
    "owner-predictive-interventions",
    { body: {} },
  );
  if (error) throw new Error(`owner-predictive-interventions: ${error.message}`);
  if (!data) throw new Error("owner-predictive-interventions: empty response");
  return data;
}

// ── RPC: owner_team_signals ──────────────────────────────────────────────
export interface TeamSignalRep {
  rep_name: string;
  rep_id: string | null;
  ytd_wins: number;
  ytd_bookings: number;
  open_deals: number;
  close_rate_pct: number | null;
  avg_close_days: number | null;
}

export interface TeamSignalsResponse {
  generated_at: string;
  workspace_id: string;
  reps: TeamSignalRep[];
}

export async function fetchOwnerTeamSignals(limit = 12): Promise<TeamSignalsResponse> {
  const { data, error } = await supabase.rpc("owner_team_signals", {
    p_workspace: null,
    p_limit: limit,
  });
  if (error) throw new Error(`owner_team_signals: ${error.message}`);
  return data as TeamSignalsResponse;
}
