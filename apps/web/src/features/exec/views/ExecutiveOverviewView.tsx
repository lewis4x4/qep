import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Gauge,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChipStack } from "@/components/primitives";
import { useExecAlerts, useFallbackKpis, useLatestSnapshots, useMetricDefinitions } from "../lib/useExecData";
import { formatForMetric, formatKpiValue, relativeRefresh } from "../lib/formatters";
import { resolveExecAlertPlaybookLink, resolveExecAlertRecordLink } from "../lib/alert-actions";
import { AiExecutiveSummaryStrip } from "../components/AiExecutiveSummaryStrip";
import { ForecastScenarioLayer } from "../components/ForecastScenarioLayer";
import { HandoffTrustPanel } from "../components/HandoffTrustPanel";
import type { AnalyticsAlertRow, ExecRoleTab, KpiSnapshot, MetricDefinition } from "../lib/types";
import { EXEC_LENS_META } from "../lib/lens-meta";
import { deriveBusinessPosture, rankLensPressure } from "../lib/pulse-overview";

interface ExecutiveOverviewViewProps {
  onOpenLens: (lens: ExecRoleTab) => void;
}

interface LensSummary {
  role: ExecRoleTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  metrics: number;
  alerts: number;
  criticalAlerts: number;
  staleMetrics: number;
  freshestAt: string | null;
  previews: Array<{ label: string; value: string }>;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  error: 3,
  warn: 2,
  info: 1,
};

function buildSnapshotMap(snapshots: KpiSnapshot[]) {
  const map = new Map<string, KpiSnapshot>();
  for (const snapshot of snapshots) {
    map.set(snapshot.metric_key, snapshot);
  }
  return map;
}

function buildLensSummary(
  role: ExecRoleTab,
  definitions: MetricDefinition[],
  snapshots: KpiSnapshot[],
  fallbacks: Record<string, { value: number; label: string; source: string }> | null,
  alerts: AnalyticsAlertRow[],
): LensSummary {
  const snapshotMap = buildSnapshotMap(snapshots);
  const staleMetrics = snapshots.filter((snapshot) =>
    snapshot.refresh_state === "stale" ||
    snapshot.refresh_state === "partial" ||
    snapshot.refresh_state === "failed"
  ).length;

  const freshestAt = snapshots
    .map((snapshot) => snapshot.calculated_at)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  const previews = definitions.slice(0, 3).map((definition) => {
    const snapshot = snapshotMap.get(definition.metric_key) ?? null;
    const fallback = fallbacks?.[definition.metric_key] ?? null;
    const format = formatForMetric(definition.metric_key);
    return {
      label: definition.label,
      value: formatKpiValue(snapshot?.metric_value ?? fallback?.value ?? null, format),
    };
  });

  return {
    ...EXEC_LENS_META[role],
    metrics: definitions.length,
    alerts: alerts.length,
    criticalAlerts: alerts.filter((alert) => alert.severity === "critical" || alert.severity === "error").length,
    staleMetrics,
    freshestAt,
    previews,
  };
}

export function ExecutiveOverviewView({ onOpenLens }: ExecutiveOverviewViewProps) {
  const { data: ceoDefinitions = [] } = useMetricDefinitions("ceo");
  const { data: cfoDefinitions = [] } = useMetricDefinitions("cfo");
  const { data: cooDefinitions = [] } = useMetricDefinitions("coo");

  const ceoMetricKeys = useMemo(() => ceoDefinitions.map((definition) => definition.metric_key), [ceoDefinitions]);
  const cfoMetricKeys = useMemo(() => cfoDefinitions.map((definition) => definition.metric_key), [cfoDefinitions]);
  const cooMetricKeys = useMemo(() => cooDefinitions.map((definition) => definition.metric_key), [cooDefinitions]);

  const { data: ceoSnapshots = [] } = useLatestSnapshots(ceoMetricKeys);
  const { data: cfoSnapshots = [] } = useLatestSnapshots(cfoMetricKeys);
  const { data: cooSnapshots = [] } = useLatestSnapshots(cooMetricKeys);

  const { data: ceoFallbacks = {} } = useFallbackKpis("ceo");
  const { data: ceoAlerts = [] } = useExecAlerts("ceo");
  const { data: cfoAlerts = [] } = useExecAlerts("cfo");
  const { data: cooAlerts = [] } = useExecAlerts("coo");

  const lensSummaries = useMemo(
    () => [
      buildLensSummary("ceo", ceoDefinitions, ceoSnapshots, ceoFallbacks, ceoAlerts),
      buildLensSummary("cfo", cfoDefinitions, cfoSnapshots, null, cfoAlerts),
      buildLensSummary("coo", cooDefinitions, cooSnapshots, null, cooAlerts),
    ],
    [ceoDefinitions, ceoSnapshots, ceoFallbacks, ceoAlerts, cfoDefinitions, cfoSnapshots, cfoAlerts, cooDefinitions, cooSnapshots, cooAlerts],
  );

  const allAlerts = useMemo(
    () => [...ceoAlerts, ...cfoAlerts, ...cooAlerts].sort((left, right) => {
      const severityDelta = (SEVERITY_ORDER[right.severity] ?? 0) - (SEVERITY_ORDER[left.severity] ?? 0);
      if (severityDelta !== 0) return severityDelta;
      return Number(right.business_impact_value ?? 0) - Number(left.business_impact_value ?? 0);
    }),
    [ceoAlerts, cfoAlerts, cooAlerts],
  );

  const staleMetrics = lensSummaries.reduce((sum, summary) => sum + summary.staleMetrics, 0);
  const criticalAlerts = allAlerts.filter((alert) => alert.severity === "critical" || alert.severity === "error").length;
  const totalImpact = allAlerts.reduce((sum, alert) => sum + Number(alert.business_impact_value ?? 0), 0);
  const topAlerts = allAlerts.slice(0, 3);
  const posture = deriveBusinessPosture({ criticalAlerts, staleMetrics, totalImpact });
  const rankedLensPressure = rankLensPressure(
    lensSummaries.map((summary) => ({
      role: summary.role,
      label: summary.label,
      alerts: summary.alerts,
      criticalAlerts: summary.criticalAlerts,
      staleMetrics: summary.staleMetrics,
    })),
  );
  const hottestLens = rankedLensPressure[0] ?? null;
  const nextAction = topAlerts[0] ?? null;

  return (
    <div className="space-y-4">
      <AiExecutiveSummaryStrip role="ceo" />

      <Card className="overflow-hidden border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-qep-orange">Leadership Pulse</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                posture.tone === "red"
                  ? "bg-red-500/10 text-red-300"
                  : posture.tone === "yellow"
                  ? "bg-amber-500/10 text-amber-300"
                  : "bg-emerald-500/10 text-emerald-300"
              }`}>
                Business posture: {posture.label}
              </span>
              <span className="text-xs text-muted-foreground">{posture.detail}</span>
            </div>
          </div>
          <StatusChipStack
            chips={[
              { label: `${allAlerts.length} alert signals`, tone: allAlerts.length > 0 ? "yellow" : "green" },
              { label: `${criticalAlerts} urgent`, tone: criticalAlerts > 0 ? "red" : "green" },
              { label: `${staleMetrics} stale metrics`, tone: staleMetrics > 0 ? "yellow" : "green" },
            ]}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PulseBlock
            title="What Changed"
            body={allAlerts.length > 0
              ? `${allAlerts.length} executive alerts are active across the command stack.`
              : "No new executive alerts are pushing the business off baseline right now."}
          />
          <PulseBlock
            title="What Is At Risk"
            body={hottestLens
              ? `${hottestLens.label} is carrying the highest pressure: ${hottestLens.criticalAlerts} critical, ${hottestLens.alerts} total alerts.`
              : "No lens is under concentrated pressure right now."}
          />
          <PulseBlock
            title="What To Do Next"
            body={nextAction
              ? nextAction.title
              : "No immediate intervention is required. Review the lens previews for early drift."}
          />
          <PulseBlock
            title="Where To Drill"
            body={hottestLens
              ? `Open the ${hottestLens.label} lens first, then move into the linked queue or record action.`
              : "Open the overview lens cards to inspect current KPI posture and freshness."}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {rankedLensPressure.map((lens) => (
            <div key={lens.role} className="rounded-xl border border-border/70 bg-black/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">{lens.label} pressure</p>
                <StatusChipStack
                  chips={[
                    { label: `${lens.alerts} alerts`, tone: lens.alerts > 0 ? "yellow" : "green" },
                    { label: `${lens.criticalAlerts} critical`, tone: lens.criticalAlerts > 0 ? "red" : "green" },
                  ]}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {lens.staleMetrics === 0
                  ? "Metrics are current."
                  : `${lens.staleMetrics} metrics are stale and lowering confidence on this lens.`}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Card className="overflow-hidden border-qep-orange/25 bg-[radial-gradient(circle_at_top_left,_rgba(218,131,48,0.18),_transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-qep-orange/20 bg-qep-orange/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-qep-orange">
                <Gauge className="h-3 w-3" />
                Executive Intelligence Center
              </div>
              <h2 className="mt-4 text-3xl font-black tracking-tight text-foreground sm:text-4xl">
                The live ownership operating view.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                A single leadership surface for revenue posture, finance discipline, execution reliability,
                exception pressure, and next-step intervention. This route is now the canonical live executive module.
              </p>
            </div>
            <StatusChipStack
              chips={[
                { label: `${lensSummaries.length} lenses live`, tone: "blue" },
                { label: `${criticalAlerts} hard risks`, tone: criticalAlerts > 0 ? "red" : "green" },
                { label: `${staleMetrics} stale metrics`, tone: staleMetrics > 0 ? "yellow" : "green" },
              ]}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PostureStat
              icon={AlertTriangle}
              label="Executive pressure"
              value={`${allAlerts.length} open alerts`}
              detail={`${criticalAlerts} need leadership attention now`}
              tone="text-red-400"
            />
            <PostureStat
              icon={ShieldAlert}
              label="Exposed value"
              value={formatKpiValue(totalImpact, "currency_compact")}
              detail="Current business impact tied to active alerts"
              tone="text-amber-400"
            />
            <PostureStat
              icon={Sparkles}
              label="System confidence"
              value={staleMetrics === 0 ? "Live" : `${staleMetrics} stale`}
              detail="Snapshot freshness across CEO, CFO, and COO lenses"
              tone={staleMetrics === 0 ? "text-emerald-400" : "text-sky-400"}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onOpenLens("ceo")}>
              Open CEO lens
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenLens("cfo")}>
              Open CFO lens
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenLens("coo")}>
              Open COO lens
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-qep-orange" />
            <h3 className="text-sm font-bold text-foreground">What leadership should do next</h3>
          </div>
          <div className="mt-4 space-y-3">
            {topAlerts.map((alert) => {
              const playbookLink = resolveExecAlertPlaybookLink(alert);
              const recordLink = resolveExecAlertRecordLink(alert);
              return (
                <div key={alert.id} className="rounded-lg border border-border/70 bg-muted/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">{alert.title}</p>
                      {alert.description && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{alert.description}</p>
                      )}
                    </div>
                    <StatusChipStack chips={[{ label: alert.severity, tone: alert.severity === "critical" ? "red" : alert.severity === "error" ? "orange" : "blue" }]} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {playbookLink && (
                      <Button asChild size="sm" variant="outline">
                        <Link to={playbookLink.href}>{playbookLink.label}</Link>
                      </Button>
                    )}
                    {recordLink && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={recordLink.href}>{recordLink.label}</Link>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {allAlerts.length === 0 && (
              <p className="text-sm text-muted-foreground">No active executive alerts. The system is quiet right now.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {lensSummaries.map((summary) => {
          const Icon = summary.icon;
          return (
            <Card key={summary.role} className={`p-5 ${summary.tone}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-full border border-white/10 bg-black/15 p-2">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{summary.label} lens</p>
                    <p className="text-[11px] text-muted-foreground">
                      {summary.metrics} metrics · refreshed {summary.freshestAt ? relativeRefresh(summary.freshestAt) : "from live fallback"}
                    </p>
                  </div>
                </div>
                <StatusChipStack
                  chips={[
                    { label: `${summary.alerts} alerts`, tone: summary.alerts > 0 ? "yellow" : "green" },
                    { label: `${summary.criticalAlerts} critical`, tone: summary.criticalAlerts > 0 ? "red" : "green" },
                  ]}
                />
              </div>

              <div className="mt-4 space-y-2">
                {summary.previews.map((preview) => (
                  <div key={preview.label} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-black/10 px-3 py-2">
                    <span className="text-[11px] text-muted-foreground">{preview.label}</span>
                    <span className="text-sm font-semibold text-foreground">{preview.value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">
                  {summary.staleMetrics === 0 ? "All preview metrics current." : `${summary.staleMetrics} metrics need refresh attention.`}
                </div>
                <Button size="sm" onClick={() => onOpenLens(summary.role)}>
                  Open {summary.label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Forecast Scenarios (Slice 5.5) */}
      <ForecastScenarioLayer />

      {/* Handoff Trust Ledger (Phase 3 Slice 3.1) */}
      <HandoffTrustPanel />
    </div>
  );
}

function PostureStat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/15 p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-black tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function PulseBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{body}</p>
    </div>
  );
}
