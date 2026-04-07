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

const supa = supabase as unknown as {
  rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>;
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string | number) => {
        order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> };
      };
      order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> };
      gte?: (col: string, val: string) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

/** Fetch all enabled metric definitions for a role tab. */
export function useMetricDefinitions(role: "ceo" | "cfo" | "coo") {
  return useQuery({
    queryKey: ["exec", "metric-definitions", role],
    queryFn: async (): Promise<MetricDefinition[]> => {
      const { data, error } = await (supa.from("analytics_metric_definitions").select("*") as unknown as {
        eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: MetricDefinition[] | null; error: unknown }> };
      }).eq("owner_role", role).order("metric_key", { ascending: true });
      if (error) throw new Error(String((error as { message?: string }).message ?? "metric definitions load failed"));
      return data ?? [];
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
      const { data, error } = await supa.rpc<KpiSnapshot[]>("analytics_latest_snapshots", {
        p_metric_keys: metricKeys ?? null,
        p_role_scope: null,
      });
      if (error) throw new Error(String(error.message ?? "snapshot load failed"));
      return data ?? [];
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
      const res = await (supa.from("analytics_alerts").select("*") as unknown as {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: AnalyticsAlertRow[] | null; error: unknown }> };
        };
      }).eq("role_target", role).order("created_at", { ascending: false }).limit(50);
      if (res.error) throw new Error("alerts load failed");
      return (res.data ?? []).filter((r) => r.status !== "resolved" && r.status !== "dismissed");
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Slice 1 fallback values: read live source views directly so the CEO
 * dashboard works before the snapshot runner exists.
 *
 * Returns a map of metric_key -> { value, label, source }. The KPI tile
 * renderer prefers the snapshot if present and only falls back to this map
 * if snapshot is null.
 */
export function useFallbackKpis(role: "ceo" | "cfo" | "coo") {
  return useQuery({
    enabled: role === "ceo",
    queryKey: ["exec", "fallback-kpis", role],
    queryFn: async (): Promise<Record<string, { value: number; label: string; source: string }>> => {
      const out: Record<string, { value: number; label: string; source: string }> = {};

      // 1. weighted_pipeline ← crm_deals_weighted
      try {
        const res = await (supa.from("crm_deals_weighted").select("weighted_amount") as unknown as Promise<{ data: { weighted_amount: number }[] | null; error: unknown }>);
        const total = (res.data ?? []).reduce((acc, row) => acc + Number(row.weighted_amount ?? 0), 0);
        out.weighted_pipeline = { value: total, label: "Live from crm_deals_weighted", source: "crm_deals_weighted" };
      } catch { /* skip */ }

      // 2. enterprise_risk_count ← exec_exception_summary (sum of open critical/error)
      try {
        const res = await (supa.from("exec_exception_summary").select("severity, open_count") as unknown as Promise<{ data: { severity: string; open_count: number }[] | null; error: unknown }>);
        const critical = (res.data ?? []).filter((r) => r.severity === "critical" || r.severity === "error").reduce((a, r) => a + Number(r.open_count ?? 0), 0);
        out.enterprise_risk_count = { value: critical, label: "Open critical exceptions", source: "exec_exception_summary" };
      } catch { /* skip */ }

      // 3. revenue_mtd ← crm_deals where closed_at >= start_of_month + stage.is_closed_won
      //    We approximate via a join through crm_deal_stages.
      try {
        const startOfMonth = new Date();
        startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
        const res = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { gte: (col: string, val: string) => Promise<{ data: { amount: number; margin_amount: number | null; stage: { is_closed_won: boolean } | null }[] | null; error: unknown }> } } })
          .from("crm_deals")
          .select("amount, margin_amount, stage:crm_deal_stages(is_closed_won)")
          .gte("closed_at", startOfMonth.toISOString());
        const rows = (res.data ?? []).filter((r) => r.stage?.is_closed_won);
        const revenue = rows.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
        const margin = rows.reduce((acc, r) => acc + Number(r.margin_amount ?? 0), 0);
        out.revenue_mtd = { value: revenue, label: "Closed-won MTD", source: "crm_deals" };
        out.gross_margin_dollars_mtd = { value: margin, label: "Margin $ MTD", source: "crm_deals.margin_amount" };
        out.gross_margin_pct_mtd = {
          value: revenue > 0 ? (margin / revenue) * 100 : 0,
          label: "Margin / revenue MTD",
          source: "derived",
        };
      } catch { /* skip */ }

      return out;
    },
    staleTime: 60_000,
  });
}
