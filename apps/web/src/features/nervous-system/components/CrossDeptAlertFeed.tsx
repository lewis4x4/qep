import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, ArrowRight,
  DollarSign, Wrench, Briefcase, Package, Monitor,
} from "lucide-react";
import {
  fetchCrossDepartmentAlerts,
  updateAlertStatus,
  type CrossDepartmentAlert,
  type TargetDepartment,
  type AlertSeverity,
} from "../lib/nervous-system-api";

const SEVERITY_STYLES: Record<AlertSeverity, { border: string; icon: typeof AlertTriangle; color: string; bg: string; label: string }> = {
  critical: { border: "border-l-red-500", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", label: "Critical" },
  warning:  { border: "border-l-amber-500", icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10", label: "Warning" },
  info:     { border: "border-l-blue-500/60", icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", label: "Info" },
};

const DEPT_ICON: Record<string, typeof DollarSign> = {
  sales: Briefcase,
  service: Wrench,
  parts: Package,
  finance: DollarSign,
  portal: Monitor,
  management: Briefcase,
};

interface CrossDeptAlertFeedProps {
  department?: TargetDepartment;
  title?: string;
}

export function CrossDeptAlertFeed({ department, title }: CrossDeptAlertFeedProps) {
  const queryClient = useQueryClient();
  const [filterDept, setFilterDept] = useState<TargetDepartment | "all">(department ?? "all");

  const { data: alerts, isLoading, isError } = useQuery({
    queryKey: ["nervous-system", "alerts", filterDept],
    queryFn: () =>
      fetchCrossDepartmentAlerts({
        targetDepartment: filterDept === "all" ? undefined : filterDept,
        status: "pending",
        limit: 50,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const statusMutation = useMutation({
    mutationFn: (args: { alertId: string; status: "acknowledged" | "resolved" }) =>
      updateAlertStatus(args.alertId, args.status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nervous-system", "alerts"] });
    },
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground">{title ?? "Cross-Department Alert Feed"}</h3>
        {!department && (
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value as TargetDepartment | "all")}
            className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground"
          >
            <option value="all">All departments</option>
            <option value="sales">→ Sales</option>
            <option value="service">→ Service</option>
            <option value="parts">→ Parts</option>
            <option value="finance">→ Finance</option>
            <option value="portal">→ Portal</option>
            <option value="management">→ Management</option>
          </select>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md border border-border bg-muted/20 animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-400">Failed to load alerts.</p>
      )}

      {!isLoading && !isError && (alerts ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground italic">No pending alerts. The nervous system is quiet.</p>
      )}

      <div className="space-y-2">
        {(alerts ?? []).map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            onAcknowledge={() => statusMutation.mutate({ alertId: alert.id, status: "acknowledged" })}
            onResolve={() => statusMutation.mutate({ alertId: alert.id, status: "resolved" })}
            pending={statusMutation.isPending}
          />
        ))}
      </div>
    </Card>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function AlertRow({
  alert,
  onAcknowledge,
  onResolve,
  pending,
}: {
  alert: CrossDepartmentAlert;
  onAcknowledge: () => void;
  onResolve: () => void;
  pending: boolean;
}) {
  const severity = SEVERITY_STYLES[alert.severity];
  const SeverityIcon = severity.icon;
  const SourceIcon = DEPT_ICON[alert.source_department] ?? Info;
  const TargetIcon = DEPT_ICON[alert.target_department] ?? Info;

  return (
    <div className={`rounded-md border border-border border-l-4 ${severity.border} bg-card p-3`}>
      <div className="flex items-start gap-3">
        <SeverityIcon className={`h-4 w-4 shrink-0 mt-0.5 ${severity.color}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severity.bg} ${severity.color}`}>
              {severity.label}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              <SourceIcon className="h-2.5 w-2.5" aria-hidden />
              {alert.source_department}
              <ArrowRight className="h-2.5 w-2.5" aria-hidden />
              <TargetIcon className="h-2.5 w-2.5" aria-hidden />
              {alert.target_department}
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {alert.alert_type}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{alert.title}</p>
          {alert.body && (
            <p className="mt-0.5 text-xs text-muted-foreground">{alert.body}</p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">
            {new Date(alert.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          onClick={onAcknowledge}
          disabled={pending}
        >
          Acknowledge
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          onClick={onResolve}
          disabled={pending}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Resolve
        </Button>
      </div>
    </div>
  );
}
