import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  AlertTriangle,
  CalendarClock,
  Gauge,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { useIronManagerData } from "../hooks/useDashboardData";
import {
  buildForecastBuckets,
  buildIncentiveEligibleDeals,
  computePredictionLedgerAccuracy,
  summarizeIncentiveExposure,
} from "../lib/ownership-intel";

function canSeeOwnershipIntel(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "owner";
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

function formatMonth(value: string | null | undefined): string {
  if (!value) return "No close date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No close date";
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(parsed);
}

function formatCategory(value: string | null | undefined): string {
  if (!value || value === "unassigned") return "Unassigned";
  return value.replace(/_/g, " ");
}

function SummaryCard({
  label,
  value,
  detail,
  accentClass = "text-foreground",
}: {
  label: string;
  value: string;
  detail: string;
  accentClass?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${accentClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

export function OwnershipIntelPanel() {
  const { profile } = useAuth();
  const { data, isLoading, isError, error } = useIronManagerData();

  if (!canSeeOwnershipIntel(profile?.role)) {
    return null;
  }

  const marginRows = (data?.marginAnalytics ?? []).slice(0, 12);
  const velocityRows = (data?.pipelineVelocity ?? [])
    .filter((row) => (row.open_deal_count ?? 0) > 0)
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  const forecastDeals = data?.forecastDeals ?? [];
  const equipmentLinks = data?.dealEquipmentLinks ?? [];
  const expiringIncentives = data?.expiringIncentives ?? [];
  const resolvedPredictions = data?.resolvedPredictions ?? [];

  const forecastBuckets = buildForecastBuckets(forecastDeals);
  const eligibleDeals = buildIncentiveEligibleDeals(forecastDeals, equipmentLinks);
  const incentiveExposure = summarizeIncentiveExposure(expiringIncentives, eligibleDeals);
  const predictionAccuracy = computePredictionLedgerAccuracy(resolvedPredictions);
  const weightedPipeline = velocityRows.reduce((sum, row) => sum + (row.weighted_pipeline ?? 0), 0);
  const bottlenecks = velocityRows.filter((row) => row.is_bottleneck);

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-56 rounded bg-white/5" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 rounded-lg bg-white/[0.04]" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="h-72 rounded-lg bg-white/[0.04]" />
            <div className="h-72 rounded-lg bg-white/[0.04]" />
          </div>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Ownership Intelligence unavailable</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "The ownership analytics surface failed to load."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-qep-orange" />
          <h2 className="text-sm font-semibold text-foreground">Ownership Intelligence</h2>
          <Badge variant="outline" className="border-white/10 text-[10px] text-white/45">
            Track 3.7
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Margin visibility, pipeline velocity, near-term forecast, and expiring incentive risk.
        </p>
      </div>

      <Card className={`p-4 ${expiringIncentives.length > 0 ? "border-qep-orange/30 bg-qep-orange/5" : ""}`}>
        {expiringIncentives.length > 0 ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-qep-orange" />
              <div>
                <p className="text-sm font-semibold text-foreground">Manufacturer incentive expiry alert</p>
                <p className="text-sm text-muted-foreground">
                  {incentiveExposure.expiringIncentiveCount} program
                  {incentiveExposure.expiringIncentiveCount === 1 ? "" : "s"} expire within 24 hours.{" "}
                  {incentiveExposure.affectedDealCount} open deal
                  {incentiveExposure.affectedDealCount === 1 ? "" : "s"} exposed for{" "}
                  {formatCurrency(incentiveExposure.totalExposure)} in pipeline value.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {expiringIncentives.slice(0, 4).map((incentive, index) => (
                <Badge
                  key={`${incentive.id ?? "incentive"}-${incentive.program_name ?? "program"}-${index}`}
                  variant="outline"
                  className="border-qep-orange/30 text-qep-orange"
                >
                  {(incentive.manufacturer ?? "Unknown").trim()} · {incentive.program_name ?? "Unnamed program"}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">No incentive expiry pressure</p>
              <p className="text-sm text-muted-foreground">
                No manufacturer incentives are set to expire in the next 24 hours.
              </p>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {forecastBuckets.map((bucket) => (
          <SummaryCard
            key={bucket.key}
            label={`${bucket.label} forecast`}
            value={formatCurrency(bucket.weightedRevenue)}
            detail={`${bucket.dealCount} deal${bucket.dealCount === 1 ? "" : "s"} · ${formatCurrency(bucket.rawPipeline)} raw`}
            accentClass={bucket.weightedRevenue > 0 ? "text-qep-orange" : "text-foreground"}
          />
        ))}
        <SummaryCard
          label="Prediction ledger"
          value={predictionAccuracy.accuracyPct == null ? "Warming up" : formatPercent(predictionAccuracy.accuracyPct)}
          detail={
            predictionAccuracy.resolvedCount > 0
              ? `${predictionAccuracy.wonCount}/${predictionAccuracy.resolvedCount} resolved deal predictions hit`
              : "No resolved deal predictions yet for an honest accuracy read."
          }
          accentClass={predictionAccuracy.accuracyPct != null && predictionAccuracy.accuracyPct >= 60 ? "text-emerald-400" : "text-foreground"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Margin analytics</p>
              <p className="text-xs text-muted-foreground">
                Open-pipeline margin rollup by rep, equipment category, and forecast month.
              </p>
            </div>
            <TrendingUp className="h-4 w-4 text-qep-orange" />
          </div>

          {marginRows.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
              No open deals with margin data yet. The table populates as quotes and margin checks land in pipeline.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr className="border-b border-white/10">
                    <th className="pb-2 pr-4 font-medium">Month</th>
                    <th className="pb-2 pr-4 font-medium">Rep</th>
                    <th className="pb-2 pr-4 font-medium">Equipment</th>
                    <th className="pb-2 pr-4 font-medium text-right">Deals</th>
                    <th className="pb-2 pr-4 font-medium text-right">Pipeline</th>
                    <th className="pb-2 pr-4 font-medium text-right">Avg margin</th>
                    <th className="pb-2 font-medium text-right">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {marginRows.map((row) => {
                    const isMarginRisk = (row.avg_margin_pct ?? 0) < 10;
                    return (
                      <tr key={`${row.month_bucket ?? "none"}-${row.rep_id ?? row.rep_name ?? "none"}-${row.equipment_category ?? "none"}`} className="border-b border-white/5 align-top">
                        <td className="py-3 pr-4 text-muted-foreground">{formatMonth(row.month_bucket)}</td>
                        <td className="py-3 pr-4 font-medium text-foreground">{row.rep_name ?? "Unassigned"}</td>
                        <td className="py-3 pr-4 text-muted-foreground capitalize">{formatCategory(row.equipment_category)}</td>
                        <td className="py-3 pr-4 text-right text-foreground">{row.deal_count ?? 0}</td>
                        <td className="py-3 pr-4 text-right text-foreground">{formatCurrency(row.total_pipeline)}</td>
                        <td className={`py-3 pr-4 text-right font-medium ${isMarginRisk ? "text-amber-400" : "text-foreground"}`}>
                          {formatPercent(row.avg_margin_pct)}
                        </td>
                        <td className="py-3 text-right text-foreground">{row.flagged_deal_count ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Pipeline velocity</p>
              <p className="text-xs text-muted-foreground">
                Weighted pipeline and average days per active stage. Bottlenecks fire when stage age beats the configured threshold.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-white/10 text-white/50">
                Weighted {formatCurrency(weightedPipeline)}
              </Badge>
              <Badge variant="outline" className={bottlenecks.length > 0 ? "border-amber-500/30 text-amber-400" : "border-white/10 text-white/50"}>
                {bottlenecks.length} bottleneck{bottlenecks.length === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>

          {velocityRows.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
              No open pipeline stages are carrying deals right now.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr className="border-b border-white/10">
                    <th className="pb-2 pr-4 font-medium">Stage</th>
                    <th className="pb-2 pr-4 font-medium text-right">Deals</th>
                    <th className="pb-2 pr-4 font-medium text-right">Weighted</th>
                    <th className="pb-2 pr-4 font-medium text-right">Avg days</th>
                    <th className="pb-2 font-medium text-right">Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {velocityRows.map((row) => (
                    <tr key={row.stage_id ?? row.stage_name ?? "stage"} className="border-b border-white/5 align-top">
                      <td className="py-3 pr-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-foreground">{row.stage_name ?? "Unknown stage"}</span>
                          {row.is_bottleneck ? (
                            <span className="text-xs text-amber-400">
                              Bottleneck pressure. Max stage age {row.max_days_in_stage ?? 0} days.
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Flowing within target range.</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right text-foreground">{row.open_deal_count ?? 0}</td>
                      <td className="py-3 pr-4 text-right text-foreground">{formatCurrency(row.weighted_pipeline)}</td>
                      <td className={`py-3 pr-4 text-right font-medium ${row.is_bottleneck ? "text-amber-400" : "text-foreground"}`}>
                        {(row.avg_days_in_stage ?? 0).toFixed(1)}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">{row.threshold_days ?? 14}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
