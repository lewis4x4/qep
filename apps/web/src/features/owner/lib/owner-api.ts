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
import {
  normalizeBranchStackRows,
  normalizeOwnerAskAnythingResponse,
  normalizeOwnerDashboardSummary,
  normalizeOwnerEventFeed,
  normalizeOwnerMarginExceptionRows,
  normalizeOwnerMorningBrief,
  normalizeOwnershipHealthScore,
  normalizePredictiveInterventionsResponse,
  normalizeTeamSignalsResponse,
  type OwnerAskAnythingMessage,
  type OwnerAskAnythingResponse,
  type OwnerDashboardSummary,
  type OwnerEventFeed,
  type OwnerMarginApprovalStatus,
  type OwnerMarginExceptionRow,
  type OwnerMorningBrief,
  type OwnershipHealthScore,
  type PredictiveInterventionsResponse,
  type BranchStackRow,
  type TeamSignalsResponse,
} from "./owner-api-normalizers";

export type {
  BranchStackRow,
  OwnerAskAnythingMessage,
  OwnerAskAnythingResponse,
  OwnerDashboardSummary,
  OwnerEvent,
  OwnerEventFeed,
  OwnerMarginApprovalStatus,
  OwnerMarginExceptionRow,
  OwnerMorningBrief,
  OwnershipHealthScore,
  PredictiveIntervention,
  PredictiveInterventionsResponse,
  TeamSignalRep,
  TeamSignalsResponse,
} from "./owner-api-normalizers";

const MARGIN_EXCEPTION_COLUMNS =
  "exception_id, workspace_id, exception_created_at, quote_package_id, brand_id, brand_code, brand_name, rep_id, rep_name, quoted_margin_pct, threshold_margin_pct, delta_pts, estimated_gap_cents, reason, approval_case_id, quote_number, customer_name, customer_company, branch_name, net_total, approval_margin_pct, approval_status, assigned_to, assigned_to_name, assigned_role, decided_by, decided_by_name, decided_at, decision_note";

export interface OwnerMarginExceptionFilters {
  startDate?: string | null;
  endDate?: string | null;
  repId?: string | null;
  approvalStatus?: OwnerMarginApprovalStatus | "no_approval" | null;
  limit?: number;
}

function clampMarginExceptionLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(500, Math.max(1, Math.trunc(limit ?? 100)));
}

// ── RPC: owner_dashboard_summary ───────────────────────────────────────────
export async function fetchOwnerDashboardSummary(): Promise<OwnerDashboardSummary> {
  const { data, error } = await supabase.rpc("owner_dashboard_summary", {
    p_workspace: null,
  });
  if (error) throw new Error(`owner_dashboard_summary: ${error.message}`);
  return normalizeOwnerDashboardSummary(data);
}

// ── RPC: compute_ownership_health_score ───────────────────────────────────
export async function fetchOwnershipHealthScore(): Promise<OwnershipHealthScore> {
  const { data, error } = await supabase.rpc("compute_ownership_health_score", {
    p_workspace: null,
  });
  if (error) throw new Error(`compute_ownership_health_score: ${error.message}`);
  return normalizeOwnershipHealthScore(data);
}

// ── RPC: owner_event_feed ─────────────────────────────────────────────────
export async function fetchOwnerEventFeed(hoursBack = 24): Promise<OwnerEventFeed> {
  const { data, error } = await supabase.rpc("owner_event_feed", {
    p_workspace: null,
    p_hours_back: hoursBack,
  });
  if (error) throw new Error(`owner_event_feed: ${error.message}`);
  return normalizeOwnerEventFeed(data);
}

// ── View: v_branch_stack_ranking ──────────────────────────────────────────
export async function fetchBranchStackRanking(): Promise<BranchStackRow[]> {
  const { data, error } = await supabase
    .from("v_branch_stack_ranking")
    .select("*")
    .order("inventory_value", { ascending: false });
  if (error) throw new Error(`v_branch_stack_ranking: ${error.message}`);
  return normalizeBranchStackRows(data);
}

// ── View: v_margin_exceptions ─────────────────────────────────────────────
export async function fetchOwnerMarginExceptions(
  filters: OwnerMarginExceptionFilters = {},
): Promise<OwnerMarginExceptionRow[]> {
  let query = supabase
    .from("v_margin_exceptions")
    .select(MARGIN_EXCEPTION_COLUMNS)
    .order("exception_created_at", { ascending: false });

  if (filters.startDate) {
    query = query.gte("exception_created_at", filters.startDate);
  }
  if (filters.endDate) {
    query = query.lte("exception_created_at", filters.endDate);
  }
  if (filters.repId) {
    query = query.eq("rep_id", filters.repId);
  }
  if (filters.approvalStatus === "no_approval") {
    query = query.is("approval_status", null);
  } else if (filters.approvalStatus) {
    query = query.eq("approval_status", filters.approvalStatus);
  }

  const { data, error } = await query.limit(clampMarginExceptionLimit(filters.limit));
  if (error) throw new Error(`v_margin_exceptions: ${error.message}`);
  return normalizeOwnerMarginExceptionRows(data);
}

// ── Edge: owner-morning-brief ─────────────────────────────────────────────
export async function fetchOwnerMorningBrief(
  opts: { refresh?: boolean } = {},
): Promise<OwnerMorningBrief> {
  const { data, error } = await supabase.functions.invoke<OwnerMorningBrief>(
    "owner-morning-brief",
    { body: { refresh: opts.refresh === true } },
  );
  if (error) throw new Error(`owner-morning-brief: ${error.message}`);
  if (!data) throw new Error("owner-morning-brief: empty response");
  const normalized = normalizeOwnerMorningBrief(data);
  if (!normalized) throw new Error("owner-morning-brief: malformed response");
  return normalized;
}

// ── Edge: owner-ask-anything ──────────────────────────────────────────────
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
  const normalized = normalizeOwnerAskAnythingResponse(data);
  if (!normalized) throw new Error("owner-ask-anything: malformed response");
  return normalized;
}

// ── Edge: owner-predictive-interventions ─────────────────────────────────
export async function fetchPredictiveInterventions(): Promise<PredictiveInterventionsResponse> {
  const { data, error } = await supabase.functions.invoke<PredictiveInterventionsResponse>(
    "owner-predictive-interventions",
    { body: {} },
  );
  if (error) throw new Error(`owner-predictive-interventions: ${error.message}`);
  if (!data) throw new Error("owner-predictive-interventions: empty response");
  return normalizePredictiveInterventionsResponse(data);
}

// ── RPC: owner_team_signals ──────────────────────────────────────────────
export async function fetchOwnerTeamSignals(limit = 12): Promise<TeamSignalsResponse> {
  const { data, error } = await supabase.rpc("owner_team_signals", {
    p_workspace: null,
    p_limit: limit,
  });
  if (error) throw new Error(`owner_team_signals: ${error.message}`);
  return normalizeTeamSignalsResponse(data);
}
