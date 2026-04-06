import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { PartsSubNav } from "../components/PartsSubNav";
import type { ForecastRow } from "../hooks/useDemandForecast";

const RISK_LEVELS = ["all", "critical", "high", "medium", "low", "none"] as const;

const RISK_STYLES: Record<string, { dot: string; text: string }> = {
  critical: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
  high: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  medium: { dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400" },
  low: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  none: { dot: "bg-muted-foreground/30", text: "text-muted-foreground" },
};

function formatMonth(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

export function PartsForecastPage() {
  const [riskFilter, setRiskFilter] = useState<string>("all");

  const forecastQ = useQuery({
    queryKey: ["parts-forecast-full"],
    queryFn: async () => {
      // Try view first
      const { data: viewData, error: viewErr } = await supabase
        .from("parts_forecast_risk_summary")
        .select("*")
        .order("stockout_risk")
        .limit(200);

      if (!viewErr && viewData) return viewData as ForecastRow[];

      // Fallback to direct table
      const { data, error } = await supabase
        .from("parts_demand_forecasts")
        .select("*")
        .order("stockout_risk")
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ForecastRow[];
    },
    staleTime: 5 * 60_000,
  });

  const rows = forecastQ.data ?? [];
  const filtered = riskFilter === "all"
    ? rows
    : rows.filter((r) => r.stockout_risk === riskFilter);

  const riskCounts = new Map<string, number>();
  for (const r of rows) {
    riskCounts.set(r.stockout_risk, (riskCounts.get(r.stockout_risk) ?? 0) + 1);
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demand forecast</h1>
        <p className="text-sm text-muted-foreground mt-1">
          90-day forward projection — predicted demand vs current stock across branches.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RISK_LEVELS.map((level) => {
          const count = level === "all" ? rows.length : (riskCounts.get(level) ?? 0);
          const active = riskFilter === level;
          return (
            <button
              key={level}
              type="button"
              onClick={() => setRiskFilter(level)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {level === "all" ? "All" : level.charAt(0).toUpperCase() + level.slice(1)}
              <span className="tabular-nums opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {forecastQ.isLoading ? (
        <div className="flex justify-center py-16" role="status">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : forecastQ.isError ? (
        <Card className="p-4 text-sm text-destructive border-destructive/40">
          {(forecastQ.error as Error)?.message ?? "Failed to load forecast data."}
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {rows.length === 0
            ? "No forecast data available. Deploy migration 137 and run the parts-demand-forecast cron."
            : `No forecasts match the "${riskFilter}" filter.`}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Part #</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium text-right">Predicted</th>
                <th className="px-3 py-2 font-medium text-right">Range</th>
                <th className="px-3 py-2 font-medium text-right">On Hand</th>
                <th className="px-3 py-2 font-medium text-right">Days Left</th>
                <th className="px-3 py-2 font-medium">Drivers</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const cfg = RISK_STYLES[r.stockout_risk] ?? RISK_STYLES.low;
                const drivers = (r.drivers ?? {}) as Record<string, unknown>;
                const seasonal = typeof drivers.seasonal_factor === "number" ? drivers.seasonal_factor : null;
                const fleet = typeof drivers.fleet_uplift_factor === "number" && drivers.fleet_uplift_factor > 1;
                return (
                  <tr key={`${r.part_number}-${r.branch_id}-${r.forecast_month}-${i}`} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase ${cfg.text}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {r.stockout_risk}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">{r.part_number}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.branch_id}</td>
                    <td className="px-3 py-1.5">{formatMonth(r.forecast_month)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {r.predicted_qty.toFixed(0)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.confidence_low.toFixed(0)}–{r.confidence_high.toFixed(0)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.current_qty_on_hand ?? r.qty_on_hand_at_forecast ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.days_of_stock_remaining != null ? (
                        <span className={
                          r.days_of_stock_remaining <= 7 ? "text-red-600 dark:text-red-400 font-medium" :
                          r.days_of_stock_remaining <= 21 ? "text-amber-600 dark:text-amber-400" : ""
                        }>
                          {r.days_of_stock_remaining}d
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {seasonal != null && seasonal !== 1 && (
                        <span className="mr-1.5">S×{seasonal.toFixed(2)}</span>
                      )}
                      {fleet && (
                        <span className="text-blue-600 dark:text-blue-400">Fleet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
