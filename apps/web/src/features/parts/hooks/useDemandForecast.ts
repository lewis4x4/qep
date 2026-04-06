import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CoverageStatus = "action_required" | "watch" | "covered" | "no_inventory";

export interface ForecastRow {
  workspace_id: string;
  part_number: string;
  branch_id: string;
  forecast_month: string;
  predicted_qty: number;
  confidence_low: number;
  confidence_high: number;
  stockout_risk: string;
  qty_on_hand_at_forecast: number | null;
  current_qty_on_hand: number | null;
  consumption_velocity: number | null;
  current_reorder_point: number | null;
  coverage_status: CoverageStatus;
  days_of_stock_remaining: number | null;
  drivers: Record<string, unknown>;
  computed_at: string;
}

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
        const rows = viewData as ForecastRow[];
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
          const rows: ForecastRow[] = (directData ?? []).map((r) => ({
            workspace_id: r.workspace_id as string,
            part_number: r.part_number as string,
            branch_id: r.branch_id as string,
            forecast_month: r.forecast_month as string,
            predicted_qty: Number(r.predicted_qty),
            confidence_low: Number(r.confidence_low),
            confidence_high: Number(r.confidence_high),
            stockout_risk: r.stockout_risk as string,
            qty_on_hand_at_forecast: r.qty_on_hand_at_forecast as number | null,
            current_qty_on_hand: null,
            consumption_velocity: null,
            current_reorder_point: null,
            coverage_status: (r.stockout_risk === "critical" ? "action_required" : "watch") as CoverageStatus,
            days_of_stock_remaining: null,
            drivers: (r.drivers ?? {}) as Record<string, unknown>,
            computed_at: r.computed_at as string,
          }));

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
