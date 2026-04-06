import { supabase } from "@/lib/supabase";

const HEALTH_REFRESH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health-score-refresh`;

export type SourceDepartment = "sales" | "service" | "parts" | "finance" | "portal";
export type TargetDepartment = "sales" | "service" | "parts" | "finance" | "portal" | "management";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "pending" | "routed" | "acknowledged" | "resolved";

export interface CrossDepartmentAlert {
  id: string;
  workspace_id: string;
  source_department: SourceDepartment;
  target_department: TargetDepartment;
  customer_profile_id: string | null;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  context_entity_type: string | null;
  context_entity_id: string | null;
  status: AlertStatus;
  routed_to_user_id: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface HealthScoreComponents {
  deal_velocity: number;
  service_engagement: number;
  parts_revenue: number;
  financial_health: number;
  signals?: {
    parts_spend_30d?: number;
    parts_spend_90d?: number;
    service_visits_90d?: number;
    avg_days_to_pay?: number | null;
    quote_close_ratio?: number | null;
    won_deals_365d?: number;
    lost_deals_365d?: number;
  };
}

export interface CustomerHealthProfile {
  id: string;
  customer_name: string;
  company_name: string | null;
  health_score: number | null;
  health_score_components: HealthScoreComponents | null;
  health_score_updated_at: string | null;
  pricing_persona?: string | null;
  lifetime_value?: number | null;
}

export interface RevenueByMakeModelRow {
  make: string;
  model: string;
  unit_count: number;
  total_lifetime_revenue: number;
  avg_lifetime_revenue_per_unit: number;
}

export interface HealthRefreshSummary {
  total_scored: number;
  avg_score: number;
  distribution: {
    excellent: number;
    good: number;
    fair: number;
    at_risk: number;
  };
  top_customers: Array<{ health_score: number; customer_name: string }>;
}

export interface HealthRefreshRunResult {
  ok: boolean;
  scores_refreshed: number;
  alerts_generated: number;
}

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
  return res.json();
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
  return res.json();
}

/** Fetch cross-department alerts directly (RLS enforces workspace + role). */
export async function fetchCrossDepartmentAlerts(params?: {
  targetDepartment?: TargetDepartment;
  status?: AlertStatus;
  limit?: number;
}): Promise<CrossDepartmentAlert[]> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => unknown;
        order: (c: string, o: Record<string, boolean>) => unknown;
        limit: (n: number) => unknown;
      };
    };
  };

  let query: unknown = sb.from("cross_department_alerts").select("*");
  if (params?.targetDepartment) {
    query = (query as { eq: (c: string, v: string) => unknown }).eq("target_department", params.targetDepartment);
  }
  if (params?.status) {
    query = (query as { eq: (c: string, v: string) => unknown }).eq("status", params.status);
  }
  query = (query as { order: (c: string, o: Record<string, boolean>) => unknown }).order("created_at", { ascending: false });
  query = (query as { limit: (n: number) => unknown }).limit(params?.limit ?? 50);

  const { data, error } = await (query as Promise<{ data: CrossDepartmentAlert[] | null; error: unknown }>);
  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to load alerts";
    throw new Error(msg);
  }
  return data ?? [];
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

  const { error } = await (supabase as unknown as {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: unknown }>;
      };
    };
  })
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
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        not: (c: string, op: string, v: null) => {
          order: (c: string, o: Record<string, boolean>) => {
            limit: (n: number) => Promise<{ data: CustomerHealthProfile[] | null; error: unknown }>;
          };
        };
      };
    };
  })
    .from("customer_profiles_extended")
    .select("id, customer_name, company_name, health_score, health_score_components, health_score_updated_at, pricing_persona, lifetime_value")
    .not("health_score", "is", null)
    .order("health_score", { ascending: false })
    .limit(limit);

  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to load customer profiles";
    throw new Error(msg);
  }
  return data ?? [];
}

/** Fetch revenue-by-make/model aggregate view (Ryan's inventory decision data). */
export async function fetchRevenueByMakeModel(limit = 20): Promise<RevenueByMakeModelRow[]> {
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        order: (c: string, o: Record<string, boolean>) => {
          limit: (n: number) => Promise<{ data: RevenueByMakeModelRow[] | null; error: unknown }>;
        };
      };
    };
  })
    .from("revenue_by_make_model")
    .select("*")
    .order("total_lifetime_revenue", { ascending: false })
    .limit(limit);

  if (error) {
    const msg = (error as { message?: string })?.message ?? "Failed to load revenue data";
    throw new Error(msg);
  }
  return data ?? [];
}
