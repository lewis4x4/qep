import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

interface ProspectingKpiCounterProps {
  userId: string;
}

interface KpiData {
  total_visits: number;
  positive_visits: number;
  target: number;
  target_met: boolean;
  consecutive_days_met: number;
}

/**
 * Real-time prospecting KPI counter for Iron Advisor dashboard.
 * Shows daily positive visit count vs. 10-visit target.
 */
export function ProspectingKpiCounter({ userId }: ProspectingKpiCounterProps) {
  const today = new Date().toISOString().split("T")[0];

  const { data: kpi, isLoading } = useQuery({
    queryKey: ["crm", "prospecting-kpi", userId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospecting_kpis")
        .select("*")
        .eq("rep_id", userId)
        .eq("kpi_date", today)
        .maybeSingle();
      if (error) {
        console.warn("[prospecting-kpi]", error);
        return {
          total_visits: 0,
          positive_visits: 0,
          target: 10,
          target_met: false,
          consecutive_days_met: 0,
        } as KpiData;
      }
      return (data ?? {
        total_visits: 0,
        positive_visits: 0,
        target: 10,
        target_met: false,
        consecutive_days_met: 0,
      }) as KpiData;
    },
    staleTime: 15_000,
    refetchInterval: 30_000, // Auto-refresh every 30 seconds
  });

  if (isLoading) {
    return <Card className="animate-pulse p-4"><div className="h-16 rounded bg-muted" /></Card>;
  }

  const positive = kpi?.positive_visits ?? 0;
  const target = kpi?.target ?? 10;
  const pct = Math.min(100, (positive / target) * 100);
  const isMet = positive >= target;
  const streak = kpi?.consecutive_days_met ?? 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Today's Visits</h3>
        {streak > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            {streak}-day streak
          </span>
        )}
      </div>

      {/* Big number display */}
      <div className="mt-3 flex items-baseline gap-1">
        <span className={`text-4xl font-bold tabular-nums ${isMet ? "text-emerald-400" : "text-foreground"}`}>
          {positive}
        </span>
        <span className="text-lg text-muted-foreground">/ {target}</span>
        <span className="ml-2 text-xs text-muted-foreground">positive visits</span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isMet ? "bg-emerald-500" :
            pct >= 50 ? "bg-amber-500" :
            "bg-red-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>Total visits: {kpi?.total_visits ?? 0}</span>
        <span>{isMet ? "Target met!" : `${target - positive} more needed`}</span>
      </div>
    </Card>
  );
}
