import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { normalizeForecastRows, type ForecastRow } from "../lib/parts-row-normalizers";

export type { CoverageStatus, ForecastRow } from "../lib/parts-row-normalizers";

export interface ForecastSummary {
  rows: ForecastRow[];
  actionRequired: number;
  watchCount: number;
  criticalRiskCount: number;
  highRiskCount: number;
  totalForecasted: number;
  mode: "forecast_view" | "fallback";
}

export function useDemandForecast() {
  return useQuery({
    queryKey: ["parts-demand-forecast-summary"],
    queryFn: async (): Promise<ForecastSummary> => {
      // Try the risk summary view first (requires migration 137 + 136)
      const { data: viewData, error: viewError } = await supabase
        .from("parts_forecast_risk_summary")
        .select("*")
        .in("coverage_status", ["action_required", "watch"])
        .order("stockout_risk")
        .limit(60);

      if (!viewError && viewData) {
        const rows = normalizeForecastRows(viewData);
        return {
          rows,
          actionRequired: rows.filter((r) => r.coverage_status === "action_required").length,
          watchCount: rows.filter((r) => r.coverage_status === "watch").length,
          criticalRiskCount: rows.filter((r) => r.stockout_risk === "critical").length,
          highRiskCount: rows.filter((r) => r.stockout_risk === "high").length,
          totalForecasted: rows.length,
          mode: "forecast_view",
        };
      }

      // Fallback: try direct table if view doesn't exist
      try {
        const { data: directData, error: directError } = await supabase
          .from("parts_demand_forecasts")
          .select("*")
          .in("stockout_risk", ["high", "critical"])
          .order("stockout_risk")
          .limit(60);

        if (!directError && directData) {
          const rows = normalizeForecastRows(directData, { fallbackFromRisk: true });

          return {
            rows,
            actionRequired: rows.filter((r) => r.coverage_status === "action_required").length,
            watchCount: rows.filter((r) => r.coverage_status === "watch").length,
            criticalRiskCount: rows.filter((r) => r.stockout_risk === "critical").length,
            highRiskCount: rows.filter((r) => r.stockout_risk === "high").length,
            totalForecasted: rows.length,
            mode: "fallback",
          };
        }
      } catch { /* table may not exist */ }

      return {
        rows: [],
        actionRequired: 0,
        watchCount: 0,
        criticalRiskCount: 0,
        highRiskCount: 0,
        totalForecasted: 0,
        mode: "fallback",
      };
    },
    staleTime: 5 * 60_000,
  });
}
