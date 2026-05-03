import { supabase } from "@/lib/supabase";
import {
  normalizeCrossDepartmentAlerts,
  normalizeCustomerHealthProfiles,
  normalizeHealthRefreshRunResult,
  normalizeHealthRefreshSummary,
  normalizeRevenueByMakeModelRows,
  type AlertStatus,
  type CrossDepartmentAlert,
  type CustomerHealthProfile,
  type HealthRefreshRunResult,
  type HealthRefreshSummary,
  type RevenueByMakeModelRow,
  type TargetDepartment,
} from "./nervous-system-normalizers";

export type {
  AlertSeverity,
  AlertStatus,
  CrossDepartmentAlert,
  CustomerHealthProfile,
  HealthRefreshRunResult,
  HealthRefreshSummary,
  HealthScoreComponents,
  RevenueByMakeModelRow,
  SourceDepartment,
  TargetDepartment,
} from "./nervous-system-normalizers";

const HEALTH_REFRESH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health-score-refresh`;

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchHealthDistribution(): Promise<HealthRefreshSummary> {
  const res = await fetch(HEALTH_REFRESH_URL, {
    method: "GET",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load health distribution" }));
    throw new Error((err as { error?: string }).error ?? `Failed to load (${res.status})`);
  }
  const normalized = normalizeHealthRefreshSummary(await res.json());
  if (!normalized) throw new Error("Health distribution returned malformed payload");
  return normalized;
}

export async function runHealthRefresh(): Promise<HealthRefreshRunResult> {
  const res = await fetch(HEALTH_REFRESH_URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ source: "manual" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Health refresh failed" }));
    throw new Error((err as { error?: string }).error ?? `Refresh failed (${res.status})`);
  }
  const normalized = normalizeHealthRefreshRunResult(await res.json());
  if (!normalized) throw new Error("Health refresh returned malformed payload");
  return normalized;
}

/** Fetch cross-department alerts directly (RLS enforces workspace + role). */
export async function fetchCrossDepartmentAlerts(params?: {
  targetDepartment?: TargetDepartment;
  status?: AlertStatus;
  limit?: number;
}): Promise<CrossDepartmentAlert[]> {
  let query = supabase.from("cross_department_alerts").select("*");
  if (params?.targetDepartment) {
    query = query.eq("target_department", params.targetDepartment);
  }
  if (params?.status) {
    query = query.eq("status", params.status);
  }
  query = query.order("created_at", { ascending: false });
  query = query.limit(params?.limit ?? 50);

  const { data, error } = await query;
  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to load alerts";
    throw new Error(msg);
  }
  return normalizeCrossDepartmentAlerts(data);
}

/** Update an alert's status (acknowledge, resolve). */
export async function updateAlertStatus(alertId: string, status: AlertStatus, resolutionNotes?: string): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === "resolved") {
    updates.resolved_at = new Date().toISOString();
  }
  if (resolutionNotes) {
    updates.resolution_notes = resolutionNotes;
  }

  const { error } = await supabase
    .from("cross_department_alerts")
    .update(updates)
    .eq("id", alertId);

  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to update alert";
    throw new Error(msg);
  }
}

/** Fetch top customers by health score. */
export async function fetchTopCustomerProfiles(limit = 20): Promise<CustomerHealthProfile[]> {
  const { data, error } = await supabase
    .from("customer_profiles_extended")
    .select("id, customer_name, company_name, health_score, health_score_components, health_score_updated_at, pricing_persona, lifetime_value")
    .not("health_score", "is", null)
    .order("health_score", { ascending: false })
    .limit(limit);

  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to load customer profiles";
    throw new Error(msg);
  }
  return normalizeCustomerHealthProfiles(data);
}

/** Fetch revenue-by-make/model aggregate view (Ryan's inventory decision data). */
export async function fetchRevenueByMakeModel(limit = 20): Promise<RevenueByMakeModelRow[]> {
  const { data, error } = await supabase
    .from("revenue_by_make_model")
    .select("*")
    .order("total_lifetime_revenue", { ascending: false })
    .limit(limit);

  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to load revenue data";
    throw new Error(msg);
  }
  return normalizeRevenueByMakeModelRows(data);
}
