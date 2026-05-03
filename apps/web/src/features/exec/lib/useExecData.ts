/**
 * QEP Moonshot Command Center — data hooks.
 *
 * Slice 1: KPI cards read latest snapshots via the `analytics_latest_snapshots`
 * RPC. When no snapshot exists yet (Slice 2 ships the runner), the
 * useFallbackKpis hook reads directly from the existing exec_* views from
 * migration 166 + crm_deals_weighted so the page is functional today.
 *
 * Snapshots take precedence over fallbacks once they exist.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { KpiSnapshot, MetricDefinition, AnalyticsAlertRow } from "./types";
import { normalizeAnalyticsAlertRows, normalizeKpiSnapshots, normalizeMetricDefinitions } from "./exec-row-normalizers";

/** Fetch all enabled metric definitions for a role tab. */
export function useMetricDefinitions(role: "ceo" | "cfo" | "coo") {
  return useQuery({
    queryKey: ["exec", "metric-definitions", role],
    queryFn: async (): Promise<MetricDefinition[]> => {
      const { data, error } = await supabase
        .from("analytics_metric_definitions")
        .select("*")
        .eq("owner_role", role)
        .order("metric_key", { ascending: true });
      if (error) throw new Error(error.message ?? "metric definitions load failed");
      return normalizeMetricDefinitions(data);
    },
    staleTime: 5 * 60_000,
  });
}

/** Fetch the latest snapshot per metric_key (RPC). */
export function useLatestSnapshots(metricKeys: string[] | undefined) {
  return useQuery({
    enabled: !!metricKeys && metricKeys.length > 0,
    queryKey: ["exec", "latest-snapshots", metricKeys?.join(",")],
    queryFn: async (): Promise<KpiSnapshot[]> => {
      const { data, error } = await supabase.rpc("analytics_latest_snapshots", {
        p_metric_keys: metricKeys ?? null,
        p_role_scope: null,
      });
      if (error) throw new Error(String(error.message ?? "snapshot load failed"));
      return normalizeKpiSnapshots(data);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Open analytics_alerts for a role tab. */
export function useExecAlerts(role: "ceo" | "cfo" | "coo") {
  return useQuery({
    queryKey: ["exec", "alerts", role],
    queryFn: async (): Promise<AnalyticsAlertRow[]> => {
      const res = await supabase
        .from("analytics_alerts")
        .select("*")
        .eq("role_target", role)
        .order("created_at", { ascending: false })
        .limit(50);
      if (res.error) throw new Error("alerts load failed");
      return normalizeAnalyticsAlertRows(res.data).filter((r) => r.status !== "resolved" && r.status !== "dismissed");
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Slice 1 fallback values via the `analytics_quick_kpi` RPC (mig 193).
 *
 * Server-side aggregation replaces the prior whole-table fetches that
 * pulled every crm_deals_weighted row to the browser. Each metric is one
 * stable RPC call that returns a numeric scalar. RLS on the underlying
 * tables enforces workspace + owner-only access; the RPC short-circuits
 * to null for non-owners.
 */
const FALLBACK_KEYS = [
  "weighted_pipeline",
  "enterprise_risk_count",
  "revenue_mtd",
  "gross_margin_dollars_mtd",
  "gross_margin_pct_mtd",
] as const;

export function useFallbackKpis(role: "ceo" | "cfo" | "coo") {
  return useQuery({
    enabled: role === "ceo",
    queryKey: ["exec", "fallback-kpis", role],
    queryFn: async (): Promise<Record<string, { value: number; label: string; source: string }>> => {
      const results = await Promise.all(
        FALLBACK_KEYS.map(async (key) => {
          try {
            const { data } = await supabase.rpc("analytics_quick_kpi", { p_metric_key: key });
            const numeric = typeof data === "number" ? data : Number(data ?? 0);
            return [key, { value: numeric, label: "Live (server agg)", source: "analytics_quick_kpi" }] as const;
          } catch {
            return null;
          }
        })
      );
      const out: Record<string, { value: number; label: string; source: string }> = {};
      for (const r of results) {
        if (r) out[r[0]] = r[1];
      }
      return out;
    },
    staleTime: 60_000,
  });
}
