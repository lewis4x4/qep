/**
 * AI Executive Summary Strip
 *
 * The executive command center already loads the metric definitions,
 * snapshots, fallback KPI values, and open alerts needed to synthesize
 * a briefing locally. This strip renders that live synthesis directly
 * so the leadership surface stays reliable even if auxiliary briefing
 * infrastructure is unavailable.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Sparkles, RefreshCcw, ArrowRight, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExecRoleTab } from "../lib/types";
import { useExecAlerts, useFallbackKpis, useLatestSnapshots, useMetricDefinitions } from "../lib/useExecData";
import { formatForMetric, formatKpiValue } from "../lib/formatters";
import { resolveExecAlertPlaybookLink, resolveExecAlertRecordLink } from "../lib/alert-actions";
import { AssistantResponseRenderer } from "@/components/assistant/AssistantResponseRenderer";

interface SummaryResponse {
  ok: boolean;
  role: string;
  generated_at: string;
  markdown: string;
  stats: { definitions: number; snapshots: number; alerts: number };
  error?: string;
}

interface Props {
  role: ExecRoleTab;
}

interface LocalDefinition {
  metric_key: string;
  label: string;
  threshold_config?: Record<string, unknown> | null;
}

interface LocalSnapshot {
  metric_key: string;
  metric_value: number | null;
}

function evaluateBand(value: number | null, config: Record<string, unknown> | null | undefined): "good" | "warn" | "critical" | "neutral" {
  if (value == null || !config) return "neutral";
  if (typeof config.critical_above === "number" && value >= config.critical_above) return "critical";
  if (typeof config.warn_above === "number" && value >= config.warn_above) return "warn";
  if (typeof config.critical_below === "number" && value <= config.critical_below) return "critical";
  if (typeof config.warn_below === "number" && value <= config.warn_below) return "warn";
  return "good";
}

function buildLocalExecutiveBriefing(
  role: ExecRoleTab,
  definitions: LocalDefinition[],
  snapshots: LocalSnapshot[],
  alerts: Array<{ severity: string; title: string; description?: string | null }>
): SummaryResponse {
  const snapByKey = new Map(snapshots.map((snapshot) => [snapshot.metric_key, snapshot]));
  const roleLabel = role.toUpperCase();
  const lines: string[] = [
    `# ${roleLabel} Briefing`,
    "",
    "## Headline numbers",
  ];

  for (const definition of definitions.slice(0, 4)) {
    const snapshot = snapByKey.get(definition.metric_key);
    const value = snapshot?.metric_value ?? null;
    const icon = evaluateBand(value, definition.threshold_config) === "critical"
      ? "🔴"
      : evaluateBand(value, definition.threshold_config) === "warn"
      ? "🟡"
      : "🟢";
    lines.push(
      `- ${icon} **${definition.label}** — ${formatKpiValue(value, formatForMetric(definition.metric_key))}`
    );
  }

  const criticalAlerts = alerts.filter((alert) => alert.severity === "critical" || alert.severity === "error");
  const watchAlerts = alerts.filter((alert) => alert.severity === "warn" || alert.severity === "info");

  if (criticalAlerts.length > 0) {
    lines.push("", "## Needs attention now");
    for (const alert of criticalAlerts.slice(0, 4)) {
      lines.push(`- **${alert.title}**${alert.description ? ` — ${alert.description}` : ""}`);
    }
  }

  if (watchAlerts.length > 0) {
    lines.push("", "## Watch list");
    for (const alert of watchAlerts.slice(0, 4)) {
      lines.push(`- ${alert.title}`);
    }
  }

  lines.push(
    "",
    "## Health rollup",
    `- ${definitions.length} executive metrics in scope`,
    `- ${snapshots.length} live snapshots available`,
    `- ${alerts.length} open alerts influencing this lens`,
    "",
    `_Generated locally from the live executive data already on screen._`
  );

  return {
    ok: true,
    role,
    generated_at: new Date().toISOString(),
    markdown: lines.join("\n"),
    stats: {
      definitions: definitions.length,
      snapshots: snapshots.length,
      alerts: alerts.length,
    },
  };
}

export function AiExecutiveSummaryStrip({ role }: Props) {
  const queryClient = useQueryClient();
  const { data: alerts = [] } = useExecAlerts(role);
  const { data: definitions = [] } = useMetricDefinitions(role);
  const metricKeys = definitions.map((definition) => definition.metric_key);
  const { data: snapshots = [] } = useLatestSnapshots(metricKeys);
  const { data: fallbackKpis = {} } = useFallbackKpis(role);
  const topAlert = alerts[0] ?? null;
  const topAlertPlaybook = topAlert ? resolveExecAlertPlaybookLink(topAlert) : null;
  const topAlertRecord = topAlert ? resolveExecAlertRecordLink(topAlert) : null;
  const localSummary = buildLocalExecutiveBriefing(
    role,
    definitions,
    definitions.map((definition) => {
      const snapshot = snapshots.find((candidate) => candidate.metric_key === definition.metric_key);
      return {
        metric_key: definition.metric_key,
        metric_value: snapshot?.metric_value ?? fallbackKpis[definition.metric_key]?.value ?? null,
      };
    }),
    alerts,
  );

  return (
    <Card className="border-qep-orange/20 bg-gradient-to-r from-qep-orange/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-qep-orange" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-qep-orange">Executive briefing</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["exec"] });
              }}
            >
              <RefreshCcw className="h-3 w-3" />
            </Button>
          </div>
          <AssistantResponseRenderer content={localSummary.markdown} variant="exec_briefing" />
          {localSummary && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {localSummary.stats.definitions} metrics · {localSummary.stats.snapshots} snapshots · {localSummary.stats.alerts} alerts ·
              generated {new Date(localSummary.generated_at).toLocaleTimeString()}
            </p>
          )}

          {topAlert && (
            <div className="mt-3 rounded-md border border-qep-orange/20 bg-black/10 p-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-3.5 w-3.5 text-qep-orange" />
                <p className="text-[10px] uppercase tracking-wider text-qep-orange">Top action from alerts</p>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-foreground">{topAlert.title}</p>
              {topAlert.description && (
                <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{topAlert.description}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {topAlertPlaybook && (
                  <Link
                    to={topAlertPlaybook.href}
                    className="inline-flex items-center gap-1 rounded-md border border-qep-orange/30 bg-qep-orange/10 px-3 py-1.5 text-[11px] font-medium text-qep-orange hover:bg-qep-orange/15"
                  >
                    {topAlertPlaybook.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {topAlertRecord && (
                  <Link
                    to={topAlertRecord.href}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/20"
                  >
                    {topAlertRecord.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
