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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Activity, AlertOctagon, History, MessageCircle, ExternalLink } from "lucide-react";
import { AskIronAdvisorButton, StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { formatKpiValue, formatForMetric, relativeRefresh } from "../lib/formatters";
import type { KpiSnapshot, MetricDefinition, AnalyticsAlertRow } from "../lib/types";

interface Props {
  metricKey: string | null;
  onClose: () => void;
}

interface SnapshotHistoryRow {
  metric_value: number | null;
  period_end: string;
  calculated_at: string;
  refresh_state: string;
}

export function MetricDrillDrawer({ metricKey, onClose }: Props) {
  const open = metricKey != null;

  const { data: definition } = useQuery({
    enabled: open,
    queryKey: ["exec", "drill", "definition", metricKey],
    queryFn: async (): Promise<MetricDefinition | null> => {
      if (!metricKey) return null;
      const supa = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: MetricDefinition | null; error: unknown }> };
          };
        };
      };
      const res = await supa.from("analytics_metric_definitions").select("*").eq("metric_key", metricKey).maybeSingle();
      return res.data ?? null;
    },
  });

  const { data: snapshots = [] } = useQuery({
    enabled: open,
    queryKey: ["exec", "drill", "history", metricKey],
    queryFn: async (): Promise<SnapshotHistoryRow[]> => {
      if (!metricKey) return [];
      const supa = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SnapshotHistoryRow[] | null; error: unknown }> } };
          };
        };
      };
      const res = await supa.from("analytics_kpi_snapshots")
        .select("metric_value, period_end, calculated_at, refresh_state")
        .eq("metric_key", metricKey)
        .order("calculated_at", { ascending: false })
        .limit(20);
      return res.data ?? [];
    },
  });

  const { data: alerts = [] } = useQuery({
    enabled: open,
    queryKey: ["exec", "drill", "alerts", metricKey],
    queryFn: async (): Promise<AnalyticsAlertRow[]> => {
      if (!metricKey) return [];
      const supa = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: AnalyticsAlertRow[] | null; error: unknown }> } };
          };
        };
      };
      const res = await supa.from("analytics_alerts")
        .select("*")
        .eq("metric_key", metricKey)
        .order("created_at", { ascending: false })
        .limit(10);
      return res.data ?? [];
    },
  });

  // Audit log writes (open = drill_open) — best effort, no UI feedback
  useEffect(() => {
    if (!open || !metricKey) return;
    void (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }).rpc("log_analytics_action", {
      p_action_type: "restricted_drill_open",
      p_source_widget: "metric_drill_drawer",
      p_metric_key: metricKey,
    });
  }, [open, metricKey]);

  const latest = snapshots[0] ?? null;
  const prior = snapshots[1] ?? null;
  const format = useMemo(() => metricKey ? formatForMetric(metricKey) : "number" as const, [metricKey]);

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
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {definition?.label ?? metricKey ?? "Metric drill"}
            {metricKey && (
              <AskIronAdvisorButton contextType="metric" contextId={metricKey} variant="inline" />
            )}
          </SheetTitle>
          <SheetDescription>
            {definition?.description ?? "Loading metric definition…"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
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
                    <AskIronAdvisorButton contextType="metric" contextId={metricKey} variant="inline" />
                    <ExternalLink className="h-2.5 w-2.5" />
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
