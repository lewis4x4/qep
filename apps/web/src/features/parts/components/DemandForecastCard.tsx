import { Card } from "@/components/ui/card";
import type { ForecastSummary, ForecastRow } from "../hooks/useDemandForecast";

const RISK_CONFIG: Record<string, { dot: string; text: string; label: string }> = {
  critical: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "Critical" },
  high: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", label: "High" },
  medium: { dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400", label: "Med" },
  low: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400", label: "Low" },
  none: { dot: "bg-muted-foreground/30", text: "text-muted-foreground", label: "None" },
};

function RiskBadge({ risk }: { risk: string }) {
  const cfg = RISK_CONFIG[risk] ?? RISK_CONFIG.low;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase ${cfg.text}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function ForecastMonth({ month }: { month: string }) {
  try {
    const d = new Date(month + "T00:00:00");
    return (
      <span className="text-[10px] font-medium text-muted-foreground">
        {d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
      </span>
    );
  } catch {
    return <span className="text-[10px] text-muted-foreground">{month}</span>;
  }
}

function ForecastRowItem({ row }: { row: ForecastRow }) {
  const drivers = row.drivers ?? {};
  const seasonal = typeof drivers.seasonal_factor === "number" ? drivers.seasonal_factor : null;
  const fleetUp = typeof drivers.fleet_uplift_factor === "number" && drivers.fleet_uplift_factor > 1;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-border/40 pb-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <RiskBadge risk={row.stockout_risk} />
        <span className="font-mono text-xs truncate">{row.part_number}</span>
        <ForecastMonth month={row.forecast_month} />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <span className="text-[10px]">{row.branch_id}</span>
        <span className="tabular-nums font-medium text-foreground">
          {row.predicted_qty.toFixed(0)} predicted
        </span>
        {row.current_qty_on_hand != null && (
          <span className="tabular-nums">
            {row.current_qty_on_hand} on hand
          </span>
        )}
        {row.days_of_stock_remaining != null && (
          <span className={`text-[10px] font-medium tabular-nums ${
            row.days_of_stock_remaining <= 7
              ? "text-red-600 dark:text-red-400"
              : row.days_of_stock_remaining <= 21
                ? "text-amber-600 dark:text-amber-400"
                : ""
          }`}>
            ~{row.days_of_stock_remaining}d left
          </span>
        )}
      </div>

      {(seasonal != null || fleetUp) && (
        <div className="w-full text-[10px] text-muted-foreground pl-5">
          {seasonal != null && seasonal !== 1 && (
            <span>Season ×{seasonal.toFixed(2)}</span>
          )}
          {fleetUp && (
            <span className="ml-2 text-blue-600 dark:text-blue-400">Fleet service signal</span>
          )}
          {row.confidence_low > 0 && (
            <span className="ml-2">
              Range: {row.confidence_low.toFixed(0)}–{row.confidence_high.toFixed(0)}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function DemandForecastCard({
  data,
  isLoading,
  isError,
  errorMessage,
}: {
  data: ForecastSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-medium">Demand forecast (90-day)</h2>
        {data?.mode === "forecast_view" && (
          <span className="text-[10px] text-muted-foreground">
            AI-computed
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Computing forecasts…</p>
      ) : isError ? (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage ?? "Forecast data failed to load."}
        </p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No demand forecast data available. Run the forecast engine or seed data to populate.
        </p>
      ) : (
        <>
          <div className="flex gap-4 mb-3 text-xs">
            {data.criticalRiskCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                <span className="font-semibold tabular-nums">{data.criticalRiskCount}</span>
                <span className="text-muted-foreground">critical</span>
              </div>
            )}
            {data.highRiskCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                <span className="font-semibold tabular-nums">{data.highRiskCount}</span>
                <span className="text-muted-foreground">high risk</span>
              </div>
            )}
            {data.actionRequired > 0 && (
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-red-700" />
                <span className="font-semibold tabular-nums">{data.actionRequired}</span>
                <span className="text-muted-foreground">action needed</span>
              </div>
            )}
            {data.watchCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" />
                <span className="font-semibold tabular-nums">{data.watchCount}</span>
                <span className="text-muted-foreground">watch</span>
              </div>
            )}
          </div>

          <ul className="space-y-1.5 text-xs max-h-64 overflow-y-auto">
            {data.rows.map((r) => (
              <ForecastRowItem
                key={`${r.part_number}-${r.branch_id}-${r.forecast_month}`}
                row={r}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
