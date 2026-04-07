/**
 * QEP Moonshot Command Center — value formatters.
 *
 * Centralized so KPI tiles, drill drawers, and exec packets all render
 * the same number the same way.
 */

export type ValueFormat = "currency" | "currency_compact" | "pct" | "number" | "score" | "duration_hours";

export function formatKpiValue(value: number | null | undefined, format: ValueFormat): string {
  if (value == null || Number.isNaN(value)) return "—";
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    case "currency_compact":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    case "pct":
      return `${value.toFixed(1)}%`;
    case "score":
      return Math.round(value).toString();
    case "number":
      return new Intl.NumberFormat("en-US").format(Math.round(value));
    case "duration_hours":
      if (value < 1) return `${Math.round(value * 60)}m`;
      if (value < 24) return `${value.toFixed(1)}h`;
      return `${(value / 24).toFixed(1)}d`;
  }
}

/** Map a metric_key to its preferred display format. */
export function formatForMetric(metricKey: string): ValueFormat {
  if (metricKey.includes("_pct") || metricKey.includes("_rate")) return "pct";
  if (metricKey.includes("revenue") || metricKey.includes("margin_dollars") || metricKey.includes("contribution") || metricKey.includes("pipeline") || metricKey.includes("exposure") || metricKey.includes("collected")) return "currency_compact";
  if (metricKey.includes("score") || metricKey.includes("index")) return "score";
  if (metricKey.includes("count")) return "number";
  if (metricKey.includes("cycle_time") || metricKey.includes("duration")) return "duration_hours";
  return "number";
}

/** Returns "fresh" | "stale" string + minutes since last refresh. */
export function relativeRefresh(calculatedAt: string | null | undefined): string {
  if (!calculatedAt) return "never";
  const ms = Date.now() - new Date(calculatedAt).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
