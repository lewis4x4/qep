import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, Calendar, Package, RefreshCw, Zap } from "lucide-react";
import {
  fetchTimingDashboard,
  runTimingScan,
  type DealTimingAlert,
  type DealTimingUrgency,
  type DealTimingAlertType,
} from "../lib/deal-timing-api";
import { DealTimingAlertCard } from "../components/DealTimingAlertCard";

type UrgencyFilter = "all" | DealTimingUrgency;
type TypeFilter = "all" | DealTimingAlertType;

export function DealTimingDashboardPage() {
  const queryClient = useQueryClient();
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["deal-timing", "dashboard"],
    queryFn: fetchTimingDashboard,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const scanMutation = useMutation({
    mutationFn: runTimingScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deal-timing", "dashboard"] });
    },
  });

  const alerts: DealTimingAlert[] = data?.alerts ?? [];
  const filteredAlerts = alerts.filter((a) => {
    if (urgencyFilter !== "all" && a.urgency !== urgencyFilter) return false;
    if (typeFilter !== "all" && a.alert_type !== typeFilter) return false;
    return true;
  });

  const byUrgency = data?.by_urgency ?? { immediate: 0, upcoming: 0, future: 0 };
  const byType = data?.by_type ?? {
    budget_cycle: 0,
    price_increase: 0,
    equipment_aging: 0,
    seasonal_pattern: 0,
    trade_in_interest: 0,
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Deal Timing Engine</h1>
          <p className="text-sm text-muted-foreground">
            Be in front of the customer when they're ready to buy. Budget cycles, price increases, equipment aging, trade-in interest.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
        >
          <Zap className={`mr-1 h-4 w-4 ${scanMutation.isPending ? "animate-pulse" : ""}`} />
          {scanMutation.isPending ? "Scanning…" : "Run scan"}
        </Button>
      </div>

      {scanMutation.isSuccess && scanMutation.data && (
        <Card className="border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-400">
            Scan complete: {scanMutation.data.alerts_generated} alerts generated, {scanMutation.data.notifications_sent} notifications sent.
          </p>
        </Card>
      )}
      {scanMutation.isError && (
        <Card className="border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs text-red-400">
            Scan failed: {(scanMutation.error as Error)?.message ?? "unknown error"}
          </p>
        </Card>
      )}

      {/* Urgency tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TileCard
          label="Total alerts"
          value={data?.total_alerts ?? 0}
          icon={<AlertTriangle className="h-4 w-4 text-foreground" />}
          active={urgencyFilter === "all"}
          onClick={() => setUrgencyFilter("all")}
        />
        <TileCard
          label="Immediate"
          value={byUrgency.immediate}
          icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
          accent="text-red-400"
          active={urgencyFilter === "immediate"}
          onClick={() => setUrgencyFilter("immediate")}
        />
        <TileCard
          label="Upcoming"
          value={byUrgency.upcoming}
          icon={<Clock className="h-4 w-4 text-amber-400" />}
          accent="text-amber-400"
          active={urgencyFilter === "upcoming"}
          onClick={() => setUrgencyFilter("upcoming")}
        />
        <TileCard
          label="Future"
          value={byUrgency.future}
          icon={<Calendar className="h-4 w-4 text-blue-400" />}
          accent="text-blue-400"
          active={urgencyFilter === "future"}
          onClick={() => setUrgencyFilter("future")}
        />
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip label={`All types (${data?.total_alerts ?? 0})`} active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
        <FilterChip label={`Budget cycle (${byType.budget_cycle})`} icon={<Calendar className="h-3 w-3" />} active={typeFilter === "budget_cycle"} onClick={() => setTypeFilter("budget_cycle")} />
        <FilterChip label={`Price increase (${byType.price_increase})`} icon={<AlertTriangle className="h-3 w-3" />} active={typeFilter === "price_increase"} onClick={() => setTypeFilter("price_increase")} />
        <FilterChip label={`Equipment aging (${byType.equipment_aging})`} icon={<RefreshCw className="h-3 w-3" />} active={typeFilter === "equipment_aging"} onClick={() => setTypeFilter("equipment_aging")} />
        <FilterChip label={`Trade-in (${byType.trade_in_interest})`} icon={<Package className="h-3 w-3" />} active={typeFilter === "trade_in_interest"} onClick={() => setTypeFilter("trade_in_interest")} />
      </div>

      {/* Alerts list */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-20 animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="border-red-500/20 p-4">
          <p className="text-sm text-red-400">Failed to load timing alerts. Try running a scan.</p>
        </Card>
      )}

      {!isLoading && !isError && filteredAlerts.length === 0 && (
        <Card className="border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {alerts.length === 0
              ? "No pending timing alerts. Run a scan to check for new opportunities."
              : "No alerts match the current filters."}
          </p>
        </Card>
      )}

      {!isLoading && !isError && filteredAlerts.length > 0 && (
        <div className="space-y-2">
          {filteredAlerts.map((alert) => (
            <DealTimingAlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────── */

function TileCard({
  label, value, icon, accent, active, onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-colors ${
        active ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card hover:border-foreground/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
    </button>
  );
}

function FilterChip({
  label, icon, active, onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
          : "border-border text-muted-foreground hover:border-foreground/20"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
