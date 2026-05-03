/**
 * Right-rail alerts panel for the command center. Reads `analytics_alerts`
 * filtered by role_target. Acknowledge / resolve buttons mutate status and
 * write a row in `analytics_action_log`.
 *
 * Slice 5.4: Shows intervention memory — "what solved this last time" —
 * for recurring alert types.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertOctagon, Check, X, Loader2, History } from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type { AnalyticsAlertRow, ExecRoleTab, AlertSeverity } from "../lib/types";
import { useExecAlerts } from "../lib/useExecData";
import { resolveExecAlertPlaybookLink, resolveExecAlertRecordLink } from "../lib/alert-actions";
import { normalizeExecInterventionHistoryRows, type ExecInterventionHistoryRow } from "../lib/exec-row-normalizers";

const SEVERITY_TONE: Record<AlertSeverity, "red" | "orange" | "yellow" | "blue"> = {
  critical: "red",
  error: "orange",
  warn: "yellow",
  info: "blue",
};

interface Props {
  role: ExecRoleTab;
}

export function AlertsInboxPanel({ role }: Props) {
  const qc = useQueryClient();
  const { data: alerts = [], isLoading } = useExecAlerts(role);

  const transition = useMutation({
    mutationFn: async ({ id, status, currentStatus }: { id: string; status: "acknowledged" | "resolved" | "dismissed"; currentStatus: string }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "acknowledged") patch.acknowledged_at = new Date().toISOString();
      if (status === "resolved") patch.resolved_at = new Date().toISOString();
      const { error } = await supabase.from("analytics_alerts").update(patch).eq("id", id);
      if (error) throw new Error(String((error as { message?: string }).message ?? "transition failed"));
      // Audit log
      await supabase.rpc("log_analytics_action", {
        p_action_type: status === "acknowledged" ? "alert_acknowledge" : status === "resolved" ? "alert_resolve" : "alert_dismiss",
        p_source_widget: "alerts_inbox_panel",
        p_alert_id: id,
        p_before_state: { status: currentStatus },
        p_after_state: { status },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exec", "alerts", role] });
    },
  });

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center p-6 text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading alerts…
      </Card>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertOctagon className="h-3 w-3 text-emerald-400" />
          <span>No open alerts for this view.</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Alerts inbox</p>
        <span className="text-[10px] text-muted-foreground">{alerts.length} open</span>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {alerts.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            disabled={transition.isPending}
            onTransition={(next) => transition.mutate({ id: alert.id, status: next, currentStatus: alert.status })}
          />
        ))}
      </div>
    </Card>
  );
}

function AlertRow({
  alert,
  disabled,
  onTransition,
}: {
  alert: AnalyticsAlertRow;
  disabled: boolean;
  onTransition: (next: "acknowledged" | "resolved" | "dismissed") => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const recordLink = resolveExecAlertRecordLink(alert);
  const playbookLink = resolveExecAlertPlaybookLink(alert);

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-2.5">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="flex-1 text-xs font-semibold text-foreground">{alert.title}</p>
        <StatusChipStack chips={[
          { label: alert.severity, tone: SEVERITY_TONE[alert.severity] },
          { label: alert.status.replace(/_/g, " "), tone: alert.status === "new" ? "blue" : "purple" },
        ]} />
      </div>
      {alert.description && (
        <p className="mb-1.5 text-[11px] text-muted-foreground line-clamp-2">{alert.description}</p>
      )}
      {alert.suggested_action && (
        <p className="mb-1.5 rounded bg-blue-500/5 px-2 py-1 text-[10px] text-blue-300">
          → {alert.suggested_action}
        </p>
      )}

      {/* Intervention memory: what solved this last time */}
      <InterventionHistory alert={alert} show={showHistory} onToggle={() => setShowHistory(!showHistory)} />

      <div className="flex items-center gap-1.5 pt-1">
        {recordLink && (
          <Button asChild size="sm" variant="ghost">
            <Link to={recordLink.href}>{recordLink.label}</Link>
          </Button>
        )}
        {playbookLink && (
          <Button asChild size="sm" variant="outline">
            <Link to={playbookLink.href}>{playbookLink.label}</Link>
          </Button>
        )}
        {alert.status === "new" && (
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onTransition("acknowledged")}>
            <Check className="mr-1 h-2.5 w-2.5" /> Ack
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onTransition("resolved")}>
          <Check className="mr-1 h-2.5 w-2.5" /> Resolve
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onTransition("dismissed")}>
          <X className="mr-1 h-2.5 w-2.5" /> Dismiss
        </Button>
        {alert.business_impact_value != null && (
          <span className="ml-auto text-[10px] text-amber-400">
            ${Math.round(alert.business_impact_value).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Intervention History (Slice 5.4) ─────────────────────────────────────

function InterventionHistory({
  alert,
  show,
  onToggle,
}: {
  alert: AnalyticsAlertRow;
  show: boolean;
  onToggle: () => void;
}) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ["intervention-history", alert.alert_type, alert.title],
    queryFn: async (): Promise<ExecInterventionHistoryRow[]> => {
      const { data, error } = await supabase.rpc("lookup_intervention_history", {
        p_alert_type: alert.alert_type ?? "unknown",
        p_alert_title: (alert.title ?? "").slice(0, 120),
        p_limit: 3,
      });
      if (error) return [];
      return normalizeExecInterventionHistoryRows(data);
    },
    enabled: show,
    staleTime: 60_000,
  });

  if (!show) {
    // Show a subtle "history" button if there might be past resolutions
    return (
      <button
        type="button"
        onClick={onToggle}
        className="mt-1 flex items-center gap-1 text-[9px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        <History className="h-2.5 w-2.5" /> What solved this last time?
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-500">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading history...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <p className="mt-1 text-[9px] text-slate-500">No past resolutions for this alert type.</p>
    );
  }

  return (
    <div className="mt-1 rounded bg-violet-500/5 border border-violet-500/10 px-2 py-1.5 space-y-1">
      <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400">
        Past resolutions ({history.length})
      </p>
      {history.map((row) => (
        <div key={row.id} className="flex items-start gap-2 text-[10px]">
          <span className="text-slate-400 shrink-0">
            {new Date(row.resolved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <span className="text-foreground capitalize">{row.resolution_type}</span>
          {row.time_to_resolve_minutes != null && (
            <span className="text-slate-500">{row.time_to_resolve_minutes}min</span>
          )}
          {row.recurrence_count > 1 && (
            <span className="text-amber-400">x{row.recurrence_count}</span>
          )}
        </div>
      ))}
    </div>
  );
}
