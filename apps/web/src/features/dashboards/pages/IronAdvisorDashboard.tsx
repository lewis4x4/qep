import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { ProspectingKpiCounter } from "../../crm/components/ProspectingKpiCounter";
import { useIronAdvisorData } from "../hooks/useDashboardData";
import { Clock, Target, CalendarDays } from "lucide-react";

interface IronAdvisorDashboardProps {
  userId: string;
}

function touchpointDealId(tp: {
  follow_up_cadences?: { deal_id?: string } | Array<{ deal_id?: string }> | null;
}): string | undefined {
  const c = tp.follow_up_cadences;
  if (!c) return undefined;
  if (Array.isArray(c)) return c[0]?.deal_id;
  return c.deal_id;
}

export function IronAdvisorDashboard({ userId }: IronAdvisorDashboardProps) {
  const { data, isLoading, isError } = useIronAdvisorData(userId);

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>;
  }

  if (isError) {
    return <Card className="border-red-500/20 p-6 text-center"><p className="text-sm text-red-400">Failed to load dashboard. Please refresh.</p></Card>;
  }

  const slaDeals = (data?.myDeals ?? []).filter((d: any) => d.sla_deadline_at && new Date(d.sla_deadline_at) < new Date());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Iron Advisor Command Center</h1>
        <p className="text-sm text-muted-foreground">Your pipeline, follow-ups, prospecting targets</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardKpiCard label="My Deals" value={data?.myDeals?.length ?? 0} icon={<Target className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="SLA Violations" value={slaDeals.length} accent={slaDeals.length > 0 ? "text-red-400" : "text-emerald-400"} icon={<Clock className="h-4 w-4" />} />
        <DashboardKpiCard label="Due Follow-Ups" value={data?.dueTouchpoints?.length ?? 0} accent="text-amber-400" icon={<CalendarDays className="h-4 w-4 text-amber-400" />} />
        <DashboardKpiCard label="Streak" value={`${data?.kpi?.consecutive_days_met ?? 0}d`} sublabel="consecutive target days" />
      </div>

      <ProspectingKpiCounter userId={userId} />

      {/* Due follow-ups */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Due Follow-Ups</h3>
        {(data?.dueTouchpoints ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No follow-ups due today.</p>
        ) : (
          <div className="space-y-2">
            {(data?.dueTouchpoints ?? []).map((tp: any) => {
              const dealId = touchpointDealId(tp);
              const row = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      {String(tp.touchpoint_type ?? "touchpoint").replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{tp.scheduled_date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{tp.purpose}</p>
                  {tp.suggested_message && (
                    <p className="text-xs italic text-foreground/70 mt-1">{tp.suggested_message}</p>
                  )}
                </>
              );
              const shellClass =
                "block rounded-lg border border-border p-2.5 hover:border-foreground/20 transition";
              return (
                <div key={tp.id}>
                  {dealId ? (
                    <Link to={`/crm/deals/${dealId}`} className={shellClass}>
                      {row}
                    </Link>
                  ) : (
                    <div className={shellClass}>{row}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
