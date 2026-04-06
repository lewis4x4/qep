import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, Calendar, Package, RefreshCw, CheckCircle2, X, ChevronRight } from "lucide-react";
import type { DealTimingAlert, DealTimingAlertType, DealTimingUrgency } from "../lib/deal-timing-api";
import { updateAlertStatus } from "../lib/deal-timing-api";

const URGENCY_STYLES: Record<DealTimingUrgency, { border: string; badge: string; label: string }> = {
  immediate: { border: "border-l-red-500", badge: "bg-red-500/10 text-red-400", label: "Immediate" },
  upcoming:  { border: "border-l-amber-500", badge: "bg-amber-500/10 text-amber-400", label: "Upcoming" },
  future:    { border: "border-l-blue-500/60", badge: "bg-blue-500/10 text-blue-400", label: "Future" },
};

const TYPE_META: Record<DealTimingAlertType, { icon: typeof AlertTriangle; label: string; color: string }> = {
  budget_cycle:      { icon: Calendar,    label: "Budget Cycle",      color: "text-violet-400" },
  price_increase:    { icon: AlertTriangle, label: "Price Increase", color: "text-red-400" },
  equipment_aging:   { icon: RefreshCw,   label: "Equipment Aging",   color: "text-amber-400" },
  seasonal_pattern:  { icon: Clock,       label: "Seasonal",          color: "text-cyan-400" },
  trade_in_interest: { icon: Package,     label: "Trade-In Interest", color: "text-emerald-400" },
};

interface DealTimingAlertCardProps {
  alert: DealTimingAlert;
}

export function DealTimingAlertCard({ alert }: DealTimingAlertCardProps) {
  const queryClient = useQueryClient();
  const urgency = URGENCY_STYLES[alert.urgency];
  const typeInfo = TYPE_META[alert.alert_type] ?? TYPE_META.equipment_aging;
  const TypeIcon = typeInfo.icon;

  const statusMutation = useMutation({
    mutationFn: (status: "acknowledged" | "actioned" | "dismissed") => updateAlertStatus(alert.id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deal-timing", "dashboard"] });
    },
  });

  return (
    <Card className={`border-l-4 ${urgency.border} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`mt-0.5 ${typeInfo.color}`}>
            <TypeIcon className="h-4 w-4" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${urgency.badge}`}>
                {urgency.label}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {typeInfo.label}
              </span>
              {alert.trigger_date && (
                <span className="text-[10px] text-muted-foreground">
                  {new Date(alert.trigger_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
            <h3 className="mt-1 text-sm font-semibold text-foreground truncate">{alert.title}</h3>
            {alert.customer_name && (
              <p className="text-xs text-muted-foreground">{alert.customer_name}</p>
            )}
            {alert.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
            )}
            {alert.recommended_action && (
              <div className="mt-2 rounded-md border border-qep-orange/20 bg-qep-orange/5 p-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-qep-orange">Recommended</p>
                <p className="mt-0.5 text-xs text-foreground">{alert.recommended_action}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          disabled={statusMutation.isPending}
          onClick={() => statusMutation.mutate("dismissed")}
        >
          <X className="mr-1 h-3 w-3" /> Dismiss
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={statusMutation.isPending}
          onClick={() => statusMutation.mutate("acknowledged")}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" /> Acknowledge
        </Button>
        <Button
          size="sm"
          className="h-7 text-[11px]"
          disabled={statusMutation.isPending}
          onClick={() => statusMutation.mutate("actioned")}
        >
          Take action <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
      {statusMutation.isError && (
        <p className="mt-2 text-[11px] text-red-400">
          {(statusMutation.error as Error)?.message ?? "Failed to update alert"}
        </p>
      )}
    </Card>
  );
}
