import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CircleHelp, ShieldAlert, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useExecAlerts, useFallbackKpis, useLatestSnapshots, useMetricDefinitions } from "../lib/useExecData";
import { buildOwnerBriefingBoard } from "../lib/owner-briefing";
import { EXEC_LENS_META } from "../lib/lens-meta";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

function bucketMeta(bucket: "certain" | "probable" | "suspected" | "dont_act_yet") {
  switch (bucket) {
    case "certain":
      return { label: "Certain", icon: AlertTriangle, tone: "text-red-400" };
    case "probable":
      return { label: "Probable", icon: ShieldAlert, tone: "text-qep-orange" };
    case "suspected":
      return { label: "Suspected", icon: CircleHelp, tone: "text-blue-400" };
    default:
      return { label: "Don't Act Yet", icon: Sparkles, tone: "text-muted-foreground" };
  }
}

export function OwnerBriefingPage() {
  const { data: ceoDefinitions = [] } = useMetricDefinitions("ceo");
  const { data: cfoDefinitions = [] } = useMetricDefinitions("cfo");
  const { data: cooDefinitions = [] } = useMetricDefinitions("coo");

  const { data: ceoSnapshots = [] } = useLatestSnapshots(ceoDefinitions.map((item) => item.metric_key));
  const { data: cfoSnapshots = [] } = useLatestSnapshots(cfoDefinitions.map((item) => item.metric_key));
  const { data: cooSnapshots = [] } = useLatestSnapshots(cooDefinitions.map((item) => item.metric_key));

  const { data: ceoAlerts = [] } = useExecAlerts("ceo");
  const { data: cfoAlerts = [] } = useExecAlerts("cfo");
  const { data: cooAlerts = [] } = useExecAlerts("coo");
  const { data: ceoFallbacks = {} } = useFallbackKpis("ceo");

  const board = buildOwnerBriefingBoard({
    alerts: [...ceoAlerts, ...cfoAlerts, ...cooAlerts],
    lenses: [
      {
        role: "ceo",
        label: EXEC_LENS_META.ceo.label,
        alerts: ceoAlerts.length,
        criticalAlerts: ceoAlerts.filter((item) => item.severity === "critical" || item.severity === "error").length,
        staleMetrics: ceoDefinitions.filter((definition) => {
          const snapshot = ceoSnapshots.find((item) => item.metric_key === definition.metric_key);
          return snapshot?.refresh_state === "stale" || snapshot?.refresh_state === "partial" || snapshot?.refresh_state === "failed";
        }).length,
        freshestAt: ceoSnapshots[0]?.calculated_at ?? null,
      },
      {
        role: "cfo",
        label: EXEC_LENS_META.cfo.label,
        alerts: cfoAlerts.length,
        criticalAlerts: cfoAlerts.filter((item) => item.severity === "critical" || item.severity === "error").length,
        staleMetrics: cfoDefinitions.filter((definition) => {
          const snapshot = cfoSnapshots.find((item) => item.metric_key === definition.metric_key);
          return snapshot?.refresh_state === "stale" || snapshot?.refresh_state === "partial" || snapshot?.refresh_state === "failed";
        }).length,
        freshestAt: cfoSnapshots[0]?.calculated_at ?? null,
      },
      {
        role: "coo",
        label: EXEC_LENS_META.coo.label,
        alerts: cooAlerts.length,
        criticalAlerts: cooAlerts.filter((item) => item.severity === "critical" || item.severity === "error").length,
        staleMetrics: cooDefinitions.filter((definition) => {
          const snapshot = cooSnapshots.find((item) => item.metric_key === definition.metric_key);
          return snapshot?.refresh_state === "stale" || snapshot?.refresh_state === "partial" || snapshot?.refresh_state === "failed";
        }).length,
        freshestAt: cooSnapshots[0]?.calculated_at ?? null,
      },
    ],
  });

  const fallbackMetricCount = Object.keys(ceoFallbacks).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/executive">
            <ArrowLeft className="h-4 w-4" />
            Back to executive
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/executive">
              Open command center <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-qep-orange font-bold">QEP OS · Owner Morning Command Note</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">AI Owner Briefing</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          A certainty-banded ownership note: what is certain, what is probable, what is suspected, and what should not trigger action yet.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard icon={AlertTriangle} label="Certain" value={String(board.summary.certain)} />
        <SummaryCard icon={ShieldAlert} label="Probable" value={String(board.summary.probable)} />
        <SummaryCard icon={CircleHelp} label="Suspected" value={String(board.summary.suspected)} />
        <SummaryCard icon={Sparkles} label="Don't Act Yet" value={String(board.summary.dontActYet)} />
      </div>

      <Card className="p-4">
        <p className="text-xs text-muted-foreground">
          Inputs: {ceoSnapshots.length + cfoSnapshots.length + cooSnapshots.length} snapshots, {ceoAlerts.length + cfoAlerts.length + cooAlerts.length} open alerts, {fallbackMetricCount} CEO fallback metrics.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {(["certain", "probable", "suspected", "dont_act_yet"] as const).map((bucket) => {
          const meta = bucketMeta(bucket);
          const items = board.signals.filter((signal) => signal.bucket === bucket);
          const Icon = meta.icon;
          return (
            <Card key={bucket} className="p-4">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${meta.tone}`} />
                <h2 className={`text-sm font-semibold ${meta.tone}`}>{meta.label}</h2>
              </div>
              <div className="mt-4 space-y-3">
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No signals in this bucket right now.</p>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{item.headline}</p>
                            <span className={`text-[11px] font-medium ${confidenceTone(item.confidence)}`}>
                              {item.confidence} confidence
                            </span>
                          </div>
                          <div className="mt-3 space-y-1">
                            {item.trace.map((line) => (
                              <p key={line} className="text-xs text-muted-foreground">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link to={item.href}>
                            Open <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
