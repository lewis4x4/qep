import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  DollarSign,
  Gauge,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Timer,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  fetchServiceMetricsDashboard,
  formatServiceMetricLabel,
  serviceMetricsDashboardIsEmpty,
  type ServiceCycleTimeBySegmentRow,
  type ServiceMetricsDashboardData,
  type ServiceMarginByRequestTypeRow,
  type ServiceOpenWorkOrdersByHoldReasonRow,
  type ServiceOpenWorkOrdersByStatusRow,
  type ServiceOwnerWatchMetrics,
} from "../lib/service-metrics-api";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function formatHours(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Live view";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live view";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ServiceMetricsDashboardPage() {
  const metricsQuery = useQuery({
    queryKey: ["service-metrics-dashboard", "h11"],
    queryFn: fetchServiceMetricsDashboard,
    staleTime: 60_000,
  });

  const data = metricsQuery.data;
  const topMarginRow = useMemo(() => {
    return data?.marginByRequestType.reduce<ServiceMarginByRequestTypeRow | null>((winner, row) => {
      if (!winner) return row;
      return row.totalMarginAmount > winner.totalMarginAmount ? row : winner;
    }, null) ?? null;
  }, [data?.marginByRequestType]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-24 pt-4 sm:px-6 lg:px-8">
      <ServiceSubNav />

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-qep-orange" aria-hidden />
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-qep-orange">H11 Service Metrics</p>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            Owner's service margin dashboard
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Margin by work-order type is first because it is the owner’s #1 operating metric.
            The watch metrics reuse shipped TAT, H4 hold-excluded efficiency, and live service ledger data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-600 dark:text-emerald-300">
            Role scoped
          </span>
          <span className="rounded-full border border-border px-3 py-1">
            {data?.ownerWatch?.computedAt ? `Updated ${formatDateTime(data.ownerWatch.computedAt)}` : "Live view"}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void metricsQuery.refetch()} disabled={metricsQuery.isFetching}>
            {metricsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCcw className="h-4 w-4" aria-hidden />}
            Refresh
          </Button>
        </div>
      </header>

      {metricsQuery.isLoading ? (
        <LoadingState />
      ) : metricsQuery.isError ? (
        <ErrorState onRetry={() => void metricsQuery.refetch()} />
      ) : data && serviceMetricsDashboardIsEmpty(data) ? (
        <EmptyState />
      ) : data ? (
        <>
          <MarginHero rows={data.marginByRequestType} topRow={topMarginRow} />
          <OwnerPulseBar data={data} />
          <OwnerWatchGrid metrics={data.ownerWatch} />
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <CycleTimePanel rows={data.cycleTimeBySegment} />
            <OpenWorkOrdersPanel
              statusRows={data.openWorkOrdersByStatus}
              holdRows={data.openWorkOrdersByHoldReason}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <div className="h-56 animate-pulse rounded-3xl border bg-muted/20" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border bg-muted/20" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl border bg-muted/20" />
        <div className="h-72 animate-pulse rounded-2xl border bg-muted/20" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-red-500/30 bg-red-500/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" aria-hidden />
          <div>
            <h2 className="font-semibold text-foreground">Could not load service metrics</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The H11 views are role and workspace scoped. Retry after confirming the backend migration is applied locally or in the target environment.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
        >
          <RefreshCcw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-qep-orange/10 text-qep-orange">
        <BarChart3 className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">No service metrics yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        H11 is ready, but this workspace needs service jobs, quote-line margin output, TAT rows, or ledger activity before the dashboard can plot owner metrics.
      </p>
      <Link
        to="/service"
        className="mt-5 inline-flex rounded-full bg-qep-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-qep-orange/90"
      >
        Open service command center
      </Link>
    </Card>
  );
}

function MarginHero({
  rows,
  topRow,
}: {
  rows: ServiceMarginByRequestTypeRow[];
  topRow: ServiceMarginByRequestTypeRow | null;
}) {
  const maxMargin = Math.max(...rows.map((row) => Math.abs(row.totalMarginAmount)), 1);
  const totalMargin = rows.reduce((sum, row) => sum + row.totalMarginAmount, 0);
  const totalLaborRevenue = rows.reduce((sum, row) => sum + row.totalLaborRevenue, 0);
  const blendedMarginPct = totalLaborRevenue > 0 ? (totalMargin / totalLaborRevenue) * 100 : null;

  return (
    <Card className="overflow-hidden border-qep-orange/30 bg-gradient-to-br from-qep-orange/10 via-background to-background p-0">
      <div className="grid gap-0 lg:grid-cols-[0.95fr_1.35fr]">
        <div className="border-b border-border/70 p-6 lg:border-b-0 lg:border-r">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-qep-orange">Owner #1</p>
          <h2 className="mt-2 text-2xl font-bold text-foreground">Margin by WO type</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Computed from H1 persisted quote-line margin output on each work order’s latest non-superseded quote.
          </p>

          <div className="mt-6 rounded-2xl border bg-background/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top margin type</p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {topRow ? formatServiceMetricLabel(topRow.requestType) : "—"}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <MetricMini label="Margin" value={topRow ? formatMoney(topRow.totalMarginAmount) : "—"} />
              <MetricMini label="Margin %" value={topRow ? formatPercent(topRow.marginPct) : "—"} />
              <MetricMini label="Labor revenue" value={topRow ? formatMoney(topRow.totalLaborRevenue) : "—"} />
              <MetricMini label="Quotes" value={topRow ? formatCount(topRow.quoteCount) : "—"} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricMini label="Blended margin" value={formatPercent(blendedMarginPct)} />
            <MetricMini label="Total margin" value={formatMoney(totalMargin)} />
          </div>
        </div>

        <div className="p-6">
          {rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              No quote-line margin rows are available yet.
            </p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => {
                const width = `${Math.max(6, Math.min(100, (Math.abs(row.totalMarginAmount) / maxMargin) * 100))}%`;
                const belowFloor = row.belowFloorLineCount > 0;
                return (
                  <div key={row.requestType} className="rounded-2xl border bg-background/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{formatServiceMetricLabel(row.requestType)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCount(row.jobCount)} jobs · {formatCount(row.marginableLineCount)} margin lines
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-lg font-bold text-foreground">{formatMoney(row.totalMarginAmount)}</p>
                        <p className={cn("text-xs font-semibold", belowFloor ? "text-red-500" : "text-emerald-500")}>
                          {formatPercent(row.marginPct)} margin{belowFloor ? ` · ${row.belowFloorLineCount} floor flags` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", belowFloor ? "bg-red-500" : "bg-qep-orange")}
                        style={{ width }}
                        aria-hidden
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function OwnerPulseBar({ data }: { data: ServiceMetricsDashboardData }) {
  const totalMargin = data.marginByRequestType.reduce((sum, row) => sum + row.totalMarginAmount, 0);
  const totalLaborRevenue = data.marginByRequestType.reduce((sum, row) => sum + row.totalLaborRevenue, 0);
  const blendedMarginPct = totalLaborRevenue > 0 ? (totalMargin / totalLaborRevenue) * 100 : null;
  const floorFlags = data.marginByRequestType.reduce((sum, row) => sum + row.belowFloorLineCount, 0);
  const ownerWatch = data.ownerWatch;
  const cards = [
    {
      label: "Owner margin signal",
      value: formatMoney(totalMargin),
      detail: `${formatPercent(blendedMarginPct)} blended margin · ${formatCount(floorFlags)} floor flags`,
      icon: DollarSign,
      tone: floorFlags > 0 ? "amber" : "green",
    },
    {
      label: "Open shop pressure",
      value: formatCount(ownerWatch?.openWorkOrders),
      detail: ownerWatch ? `${formatCount(ownerWatch.openJobsOnHoldCount)} jobs on hold · ${formatCount(ownerWatch.openHoldCount)} active holds` : "No owner watch metrics available yet",
      icon: AlertTriangle,
      tone: ownerWatch ? ((ownerWatch.openJobsOnHoldCount ?? 0) > 0 ? "amber" : "green") : "muted",
    },
    {
      label: "First touch speed",
      value: formatHours(ownerWatch?.avgHoursToFirstTouch),
      detail: ownerWatch ? `${formatCount(ownerWatch.firstTouchJobCount)} WOs with first-touch evidence` : "No first-touch evidence in the current window",
      icon: Timer,
      tone: ownerWatch ? (ownerWatch.avgHoursToFirstTouch != null && ownerWatch.avgHoursToFirstTouch > 24 ? "amber" : "green") : "muted",
    },
    {
      label: "Warranty recovery",
      value: formatPercent(ownerWatch?.warrantyRecoveryPct),
      detail: ownerWatch ? `${formatMoney(ownerWatch.warrantyRevenueCents / 100)} recovered in 30d` : "No warranty recovery metrics available yet",
      icon: ShieldCheck,
      tone: ownerWatch ? (ownerWatch.warrantyRecoveryPct != null && ownerWatch.warrantyRecoveryPct < 70 ? "amber" : "green") : "muted",
    },
  ];

  return (
    <section aria-label="H11 executive pulse" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={cn(
              "rounded-2xl border p-4",
              card.tone === "amber"
                ? "border-amber-500/30 bg-amber-500/10"
                : card.tone === "muted"
                  ? "border-border bg-muted/30"
                  : "border-emerald-500/25 bg-emerald-500/10",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{card.label}</p>
                <p className="mt-2 font-mono text-2xl font-bold text-foreground">{card.value}</p>
              </div>
              <div className={cn("rounded-xl p-2", card.tone === "amber" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : card.tone === "muted" ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>
                <Icon className="h-4 w-4" aria-hidden />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{card.detail}</p>
          </div>
        );
      })}
    </section>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/70 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function OwnerWatchGrid({ metrics }: { metrics: ServiceOwnerWatchMetrics | null }) {
  const warrantyDollars = metrics ? metrics.warrantyRevenueCents / 100 : 0;

  const cards = [
    {
      label: "Cycle time",
      value: formatHours(metrics?.avgCycleTimeHours),
      detail: `${formatCount(metrics?.completedTatCount)} completed TAT rows · ${formatPercent(metrics?.tatOnTimePct)} on-time`,
      icon: Clock3,
    },
    {
      label: "Comeback rate",
      value: formatPercent(metrics?.comebackRatePct),
      detail: `${formatCount(metrics?.comebackJobs30d)} comeback WOs / ${formatCount(metrics?.jobs30d)} WOs in 30d`,
      icon: RefreshCcw,
    },
    {
      label: "Technician efficiency",
      value: formatPercent(metrics?.avgTechnicianEfficiencyPct),
      detail: `${formatHours(metrics?.holdHoursExcluded30d)} hold time excluded`,
      icon: Gauge,
    },
    {
      label: "Warranty recovery",
      value: formatPercent(metrics?.warrantyRecoveryPct),
      detail: `${formatMoney(warrantyDollars)} warranty revenue in 30d`,
      icon: ShieldCheck,
    },
    {
      label: "Shop / field mix",
      value: `${formatCount(metrics?.shopJobs30d)} / ${formatCount(metrics?.fieldJobs30d)}`,
      detail: `${formatPercent(metrics?.fieldMixPct)} field mix over last 30d`,
      icon: Wrench,
    },
    {
      label: "Open WOs on hold",
      value: formatCount(metrics?.openJobsOnHoldCount),
      detail: `${formatCount(metrics?.openWorkOrders)} open WOs · ${formatCount(metrics?.openHoldCount)} active holds`,
      icon: AlertTriangle,
    },
    {
      label: "Labor recovery",
      value: formatPercent(metrics?.laborRecoveryPct),
      detail: `${formatHours(metrics?.techHoursCharged30d)} charged / ${formatHours(metrics?.techHoursWorked30d)} worked`,
      icon: DollarSign,
    },
    {
      label: "Hours to first touch",
      value: formatHours(metrics?.avgHoursToFirstTouch),
      detail: `${formatCount(metrics?.firstTouchJobCount)} WOs with first-touch evidence`,
      icon: Timer,
    },
  ];

  return (
    <section aria-label="Owner watch metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</p>
                <p className="mt-2 font-mono text-2xl font-bold text-foreground">{card.value}</p>
              </div>
              <div className="rounded-xl bg-qep-orange/10 p-2 text-qep-orange">
                <Icon className="h-4 w-4" aria-hidden />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{card.detail}</p>
          </Card>
        );
      })}
    </section>
  );
}

function CycleTimePanel({ rows }: { rows: ServiceCycleTimeBySegmentRow[] }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Cycle time by TAT segment</h2>
          <p className="text-xs text-muted-foreground">Reuses existing service_tat_metrics and target_duration_hours.</p>
        </div>
        <TrendingUp className="h-4 w-4 text-qep-orange" aria-hidden />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No TAT rows in the current window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left">Segment</th>
                <th className="py-2 text-right">Done</th>
                <th className="py-2 text-right">Open</th>
                <th className="py-2 text-right">Avg</th>
                <th className="py-2 text-right">Target</th>
                <th className="py-2 text-right">On-time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.segmentName} className="border-b last:border-b-0">
                  <td className="py-3 font-medium text-foreground">{formatServiceMetricLabel(row.segmentName)}</td>
                  <td className="py-3 text-right tabular-nums">{formatCount(row.completedSegmentCount)}</td>
                  <td className="py-3 text-right tabular-nums">{formatCount(row.openSegmentCount)}</td>
                  <td className="py-3 text-right tabular-nums">{formatHours(row.avgActualDurationHours)}</td>
                  <td className="py-3 text-right tabular-nums">{formatHours(row.avgTargetDurationHours)}</td>
                  <td className="py-3 text-right tabular-nums">{formatPercent(row.onTimePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OpenWorkOrdersPanel({
  statusRows,
  holdRows,
}: {
  statusRows: ServiceOpenWorkOrdersByStatusRow[];
  holdRows: ServiceOpenWorkOrdersByHoldReasonRow[];
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Open WOs by status / hold reason</h2>
          <p className="text-xs text-muted-foreground">Open-work pressure split by service stage and H4 normalized hold states.</p>
        </div>
        <AlertTriangle className="h-4 w-4 text-qep-orange" aria-hidden />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <BreakdownList
          title="By status"
          emptyLabel="No open work orders."
          rows={statusRows.map((row) => ({
            key: row.currentStage,
            label: formatServiceMetricLabel(row.currentStage),
            value: row.openWorkOrderCount,
            detail: `${formatCount(row.withOpenHoldCount)} with holds`,
          }))}
        />
        <BreakdownList
          title="By hold reason"
          emptyLabel="No open holds."
          rows={holdRows.map((row) => ({
            key: row.holdState,
            label: formatServiceMetricLabel(row.holdState),
            value: row.affectedWorkOrderCount,
            detail: `${formatCount(row.openHoldCount)} holds · avg ${formatHours(row.avgOpenHoldHours)}`,
          }))}
        />
      </div>
    </Card>
  );
}

function BreakdownList({
  title,
  emptyLabel,
  rows,
}: {
  title: string;
  emptyLabel: string;
  rows: Array<{ key: string; label: string; value: number; detail: string }>;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">{row.label}</span>
                <span className="font-mono font-semibold">{formatCount(row.value)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-qep-orange"
                  style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }}
                  aria-hidden
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
