import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCustomerPartsIntel } from "../hooks/useCustomerPartsIntel";

function dollars(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function trendBadge(trend: string) {
  const map: Record<string, { label: string; cls: string }> = {
    growing: { label: "Growing", cls: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" },
    stable: { label: "Stable", cls: "border-border text-muted-foreground" },
    declining: { label: "Declining", cls: "border-amber-500/30 text-amber-600 dark:text-amber-400" },
    new: { label: "New customer", cls: "border-blue-500/30 text-blue-600 dark:text-blue-400" },
    churned: { label: "Churned", cls: "border-red-500/30 text-red-600 dark:text-red-400" },
  };
  const cfg = map[trend] ?? map.stable;
  return <Badge variant="outline" className={`text-[10px] ${cfg.cls}`}>{cfg.label}</Badge>;
}

function churnBadge(risk: string) {
  if (risk === "none") return null;
  const cls: Record<string, string> = {
    low: "border-amber-500/30 text-amber-600 dark:text-amber-400",
    medium: "border-orange-500/30 text-orange-600 dark:text-orange-400",
    high: "border-red-500/30 text-red-600 dark:text-red-400",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${cls[risk] ?? cls.low}`}>
      Churn: {risk}
    </Badge>
  );
}

function SparkBar({ data, maxRevenue }: { data: Array<{ month: string; revenue: number }>; maxRevenue: number }) {
  if (data.length === 0) return null;
  return (
    <div className="flex items-end gap-[2px] h-8" role="img" aria-label="Monthly spend trend chart">
      {data.map((d) => {
        const h = maxRevenue > 0 ? Math.max(2, (d.revenue / maxRevenue) * 100) : 2;
        return (
          <div
            key={d.month}
            className="flex-1 bg-primary/30 rounded-t-sm min-w-[3px]"
            style={{ height: `${h}%` }}
            title={`${d.month}: ${dollars(d.revenue)}`}
          />
        );
      })}
    </div>
  );
}

interface Props {
  companyId: string;
}

export function CustomerPartsIntelCard({ companyId }: Props) {
  const { data: intel, isLoading, isError } = useCustomerPartsIntel(companyId);

  if (isLoading) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground animate-pulse">Loading parts intelligence…</p>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="p-4 text-xs text-destructive border-destructive/40" role="alert">
        Parts intelligence unavailable.
      </Card>
    );
  }

  if (!intel) return null;

  const maxMonthly = Math.max(...intel.monthly_spend.map((m) => m.revenue), 1);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Parts intelligence</h3>
        <Link
          to="/parts/analytics"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          Full analytics
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {trendBadge(intel.spend_trend)}
        {churnBadge(intel.churn_risk)}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">12m spend</p>
          <p className="font-semibold tabular-nums">{dollars(intel.total_spend_12m)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Avg order</p>
          <p className="font-semibold tabular-nums">{dollars(intel.avg_order_value)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Fleet</p>
          <p className="font-semibold tabular-nums">
            {intel.fleet_count}
            {intel.machines_approaching_service > 0 && (
              <span className="text-amber-600 dark:text-amber-400 text-xs ml-1">
                ({intel.machines_approaching_service} due)
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Predicted Q</p>
          <p className="font-semibold tabular-nums text-primary">
            {dollars(intel.predicted_next_quarter_spend)}
          </p>
        </div>
      </div>

      {intel.monthly_spend.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Monthly trend</p>
          <SparkBar data={intel.monthly_spend} maxRevenue={maxMonthly} />
        </div>
      )}

      {intel.recommended_outreach && (
        <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
          {intel.recommended_outreach}
        </div>
      )}

      {intel.opportunity_value > 0 && (
        <p className="text-xs text-muted-foreground">
          Opportunity value: <span className="font-medium text-foreground">{dollars(intel.opportunity_value)}</span>
        </p>
      )}

      {intel.days_since_last_order != null && (
        <p className="text-xs text-muted-foreground">
          Last order: {intel.days_since_last_order} days ago
          {intel.last_order_date && ` (${intel.last_order_date})`}
        </p>
      )}
    </Card>
  );
}
