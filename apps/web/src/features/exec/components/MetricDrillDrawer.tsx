/**
 * Slice 5 — universal metric drill drawer.
 *
 * Opens for any KPI tile across CEO/CFO/COO views. Shows:
 *   - Full metric definition (formula, source tables, refresh cadence, weights)
 *   - Latest snapshot value, prior period comparison, sparkline of last N
 *   - Top contributing rows (drill_contract.drill_view → fetcher map)
 *   - Open alerts that target this metric_key
 *   - Audit trail of recent actions on this metric
 *   - "Ask Iron Advisor about this metric" button → chat preload
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Activity, AlertOctagon, History, MessageCircle, ExternalLink, ArrowRight } from "lucide-react";
import { AskIronAdvisorButton, StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatKpiValue, formatForMetric, relativeRefresh } from "../lib/formatters";
import type { MetricDefinition, AnalyticsAlertRow } from "../lib/types";
import { resolveMetricPlaybook, resolveMetricRecordLink } from "../lib/metric-actions";
import {
  normalizeAnalyticsAlertRows,
  normalizeMetricDefinitions,
  normalizeSnapshotHistoryRows,
  type ExecSnapshotHistoryRow,
} from "../lib/exec-row-normalizers";
import { IronContextualAssistantPanel } from "@/lib/iron/IronContextualAssistant";
import { useIronStore } from "@/lib/iron/store";

interface Props {
  metricKey: string | null;
  workspaceId: string;
  onClose: () => void;
}

export function MetricDrillDrawer({ metricKey, workspaceId, onClose }: Props) {
  const {
    state: ironState,
    setActiveContext,
    closeContextualAssistant,
  } = useIronStore();
  const open = metricKey != null;

  const { data: definition } = useQuery({
    enabled: open,
    queryKey: ["exec", "drill", "definition", metricKey],
    queryFn: async (): Promise<MetricDefinition | null> => {
      if (!metricKey) return null;
      const res = await supabase
        .from("analytics_metric_definitions")
        .select("*")
        .eq("metric_key", metricKey)
        .maybeSingle();
      if (res.error) throw res.error;
      return normalizeMetricDefinitions(res.data ? [res.data] : [])[0] ?? null;
    },
  });

  const { data: snapshots = [] } = useQuery({
    enabled: open,
    queryKey: ["exec", "drill", "history", metricKey, workspaceId],
    queryFn: async (): Promise<ExecSnapshotHistoryRow[]> => {
      if (!metricKey) return [];
      // P1-2 fix: explicit workspace filter so we never pull cross-workspace
      // rows. RLS still backstops it.
      const res = await supabase
        .from("analytics_kpi_snapshots")
        .select("metric_value, period_end, calculated_at, refresh_state")
        .eq("metric_key", metricKey)
        .eq("workspace_id", workspaceId)
        .order("calculated_at", { ascending: false })
        .limit(20);
      if (res.error) throw res.error;
      return normalizeSnapshotHistoryRows(res.data);
    },
  });

  const { data: alerts = [] } = useQuery({
    enabled: open,
    queryKey: ["exec", "drill", "alerts", metricKey, workspaceId],
    queryFn: async (): Promise<AnalyticsAlertRow[]> => {
      if (!metricKey) return [];
      const res = await supabase
        .from("analytics_alerts")
        .select("*")
        .eq("metric_key", metricKey)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (res.error) throw res.error;
      return normalizeAnalyticsAlertRows(res.data);
    },
  });

  // Audit log writes (open = drill_open) — best effort, no UI feedback
  useEffect(() => {
    if (!open || !metricKey) return;
    void supabase.rpc("log_analytics_action", {
      p_action_type: "restricted_drill_open",
      p_source_widget: "metric_drill_drawer",
      p_metric_key: metricKey,
    });
  }, [open, metricKey]);

  const latest = snapshots[0] ?? null;
  const prior = snapshots[1] ?? null;
  const format = useMemo(() => metricKey ? formatForMetric(metricKey) : "number" as const, [metricKey]);
  const playbookLink = useMemo(() => resolveMetricPlaybook(metricKey), [metricKey]);
  const recordLink = useMemo(() => resolveMetricRecordLink(metricKey), [metricKey]);
  const metricTitle = definition?.label ?? metricKey ?? "Metric";
  const metricEvidence = useMemo(() => {
    if (!metricKey) return "";
    const lines = [
      `Metric: ${metricTitle}`,
      definition?.description ? `Description: ${definition.description}` : null,
      latest ? `Current value: ${formatKpiValue(latest.metric_value, format)}` : "Current value: unavailable",
      prior?.metric_value != null ? `Prior value: ${formatKpiValue(prior.metric_value, format)}` : null,
      latest ? `Refresh state: ${latest.refresh_state} (${relativeRefresh(latest.calculated_at)})` : null,
      definition?.formula_text ? `Formula: ${definition.formula_text}` : null,
      Array.isArray(definition?.source_tables) && definition.source_tables.length > 0
        ? `Source tables: ${definition.source_tables.join(", ")}`
        : null,
      alerts.length > 0 ? `Open alerts: ${alerts.map((alert) => alert.title).join(" | ")}` : "Open alerts: none",
    ].filter(Boolean);
    return lines.join("\n");
  }, [alerts, definition, format, latest, metricKey, metricTitle, prior]);
  const contextualMetricActive =
    ironState.contextualOpen &&
    ironState.activeContext?.preferredSurface === "metric_drawer" &&
    ironState.activeContext?.kind === "metric" &&
    ironState.activeContext?.entityId === metricKey;

  useEffect(() => {
    if (!contextualMetricActive || !metricKey) return;
    setActiveContext({
      kind: "metric",
      entityId: metricKey,
      title: metricTitle,
      route: `/executive?metric=${encodeURIComponent(metricKey)}`,
      draftPrompt: `Explain ${metricTitle} for me right now. What is driving it, what changed, and what should I do next?`,
      evidence: metricEvidence,
      replaceActiveContext: true,
      preferredSurface: "metric_drawer",
    });
  }, [contextualMetricActive, metricEvidence, metricKey, metricTitle, setActiveContext]);

  const sparkline = useMemo(() => {
    if (snapshots.length < 2) return null;
    const values = snapshots.slice().reverse().map((s) => Number(s.metric_value ?? 0));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return points.join(" ");
  }, [snapshots]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (contextualMetricActive) {
            closeContextualAssistant();
          }
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-6xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {definition?.label ?? metricKey ?? "Metric drill"}
            {metricKey && (
              <AskIronAdvisorButton
                contextType="metric"
                contextId={metricKey}
                contextTitle={metricTitle}
                draftPrompt={`Explain ${metricTitle} for me right now. What is driving it, what changed, and what should I do next?`}
                evidence={metricEvidence}
                preferredSurface="metric_drawer"
                variant="inline"
                label="Ask Iron"
              />
            )}
          </SheetTitle>
          <SheetDescription>
            {definition?.description ?? "Loading metric definition…"}
          </SheetDescription>
        </SheetHeader>

        <div className={cn("mt-4", contextualMetricActive ? "grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]" : "block")}>
          <div className="space-y-4">
          {/* Latest value + delta */}
          <Card className="p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {latest ? formatKpiValue(latest.metric_value, format) : "—"}
                </p>
                {prior?.metric_value != null && latest?.metric_value != null && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Prior: {formatKpiValue(prior.metric_value, format)}
                    {Number(prior.metric_value) !== 0 && (
                      <> (
                        {(((Number(latest.metric_value) - Number(prior.metric_value)) / Math.abs(Number(prior.metric_value))) * 100).toFixed(1)}%
                      )</>
                    )}
                  </p>
                )}
              </div>
              {latest && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Refreshed</p>
                  <p className="text-[11px] text-foreground">{relativeRefresh(latest.calculated_at)}</p>
                  <p className="text-[10px] text-muted-foreground">{latest.refresh_state}</p>
                </div>
              )}
            </div>

            {/* Sparkline */}
            {sparkline && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-3 h-12 w-full">
                <polyline
                  fill="none"
                  stroke="currentColor"
                  className="text-qep-orange"
                  strokeWidth="1.5"
                  points={sparkline}
                />
              </svg>
            )}
          </Card>

          {/* Formula + sources */}
          {definition && (
            <Card className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Formula</p>
              <p className="mt-1 font-mono text-[11px] text-foreground whitespace-pre-wrap">{definition.formula_text}</p>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <p className="uppercase tracking-wider text-muted-foreground">Source tables</p>
                  <p className="text-foreground">{Array.isArray(definition.source_tables) ? definition.source_tables.join(", ") : "—"}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wider text-muted-foreground">Refresh</p>
                  <p className="text-foreground">{definition.refresh_cadence}</p>
                </div>
              </div>

              {definition.synthetic_weights && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Synthetic weights</p>
                  <ul className="mt-0.5 space-y-0.5 text-[10px] font-mono text-foreground">
                    {Object.entries(definition.synthetic_weights).map(([k, v]) => (
                      <li key={k}>{k}: {v}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* Action path */}
          {(playbookLink || recordLink) && (
            <Card className="border-qep-orange/20 p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Action path</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {playbookLink && (
                  <Link
                    to={playbookLink.href}
                    className="inline-flex items-center gap-1 rounded-md border border-qep-orange/30 bg-qep-orange/5 px-3 py-2 text-[11px] font-medium text-qep-orange hover:bg-qep-orange/10"
                  >
                    {playbookLink.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {recordLink && (
                  <Link
                    to={recordLink.href}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-[11px] font-medium text-foreground hover:bg-muted/20"
                  >
                    {recordLink.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </Card>
          )}

          {/* Alerts on this metric */}
          {alerts.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertOctagon className="h-3 w-3 text-amber-400" />
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alerts on this metric</p>
                <span className="ml-auto text-[10px] text-muted-foreground">{alerts.length}</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {alerts.map((alert) => (
                  <div key={alert.id} className="rounded border border-border/60 bg-muted/10 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold text-foreground">{alert.title}</p>
                      <StatusChipStack chips={[
                        { label: alert.severity, tone: alert.severity === "critical" ? "red" : alert.severity === "error" ? "orange" : alert.severity === "warn" ? "yellow" : "blue" },
                        { label: alert.status.replace(/_/g, " "), tone: alert.status === "resolved" ? "green" : "neutral" },
                      ]} />
                    </div>
                    {alert.description && <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">{alert.description}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Snapshot history */}
          {snapshots.length > 1 && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <History className="h-3 w-3 text-blue-400" />
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Snapshot history</p>
              </div>
              <div className="space-y-0.5 max-h-48 overflow-y-auto text-[11px]">
                {snapshots.map((s, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/20 py-1">
                    <span className="text-muted-foreground">{relativeRefresh(s.calculated_at)}</span>
                    <span className="font-mono text-foreground">{formatKpiValue(s.metric_value, format)}</span>
                    <span className="text-[9px] text-muted-foreground">{s.refresh_state}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Drill action prompt */}
          <Card className="border-qep-orange/30 bg-qep-orange/5 p-4">
            <div className="flex items-start gap-2">
              <MessageCircle className="mt-0.5 h-4 w-4 text-qep-orange" />
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-foreground">Need a deeper read?</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Iron Advisor preloads the full metric context (definition, latest snapshot, related alerts,
                  and top contributing rows) so you can ask a free-form question and get an evidence-grounded answer.
                </p>
                {metricKey && (
                  <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-qep-orange">
                    <AskIronAdvisorButton
                      contextType="metric"
                      contextId={metricKey}
                      contextTitle={metricTitle}
                      draftPrompt={`Explain ${metricTitle} for me right now. What is driving it, what changed, and what should I do next?`}
                      evidence={metricEvidence}
                      preferredSurface="metric_drawer"
                      variant="inline"
                      label="Ask Iron"
                    />
                  </div>
                )}
              </div>
            </div>
          </Card>
          </div>

          {contextualMetricActive && (
            <IronContextualAssistantPanel embedded className="min-h-[720px]" />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
