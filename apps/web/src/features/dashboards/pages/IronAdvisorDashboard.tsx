import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { AdvisorMorningBriefingCard } from "../components/AdvisorMorningBriefingCard";
import { ProspectingKpiCounter } from "../../qrm/components/ProspectingKpiCounter";
import { useIronAdvisorData } from "../hooks/useDashboardData";
import { calendarDaysFromToday, followUpDueBadge } from "../lib/advisor-dates";
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
  const todayStr = data?.todayStr ?? new Date().toISOString().split("T")[0];
  const dueOrOverdueCount = (data?.dueTouchpoints ?? []).filter((tp: { scheduled_date?: string }) => (tp.scheduled_date ?? "") <= todayStr).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Iron Advisor Command Center</h1>
        <p className="text-sm text-muted-foreground">Your pipeline, follow-ups, prospecting targets</p>
      </div>

      <AdvisorMorningBriefingCard
        slaDeals={slaDeals.map((d: any) => ({ id: d.id, name: d.name, sla_deadline_at: d.sla_deadline_at }))}
        newLeads={(data?.newLeads ?? []).map((d: any) => ({ id: d.id, name: d.name, created_at: d.created_at }))}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardKpiCard label="My Deals" value={data?.myDeals?.length ?? 0} icon={<Target className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="SLA Violations" value={slaDeals.length} accent={slaDeals.length > 0 ? "text-red-400" : "text-emerald-400"} icon={<Clock className="h-4 w-4" />} />
        <DashboardKpiCard
          label="Due Follow-Ups"
          value={dueOrOverdueCount}
          accent="text-amber-400"
          icon={<CalendarDays className="h-4 w-4 text-amber-400" />}
          sublabel="today or overdue"
        />
        <DashboardKpiCard label="Streak" value={`${data?.kpi?.consecutive_days_met ?? 0}d`} sublabel="consecutive target days" />
      </div>

      <ProspectingKpiCounter userId={userId} />

      {/* Follow-up queue: today + next 3 days */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Follow-up queue</h3>
        <p className="text-xs text-muted-foreground mb-3">Pending touchpoints through 3 days out — due dates use your local calendar day.</p>
        {(data?.dueTouchpoints ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No follow-ups in the current window.</p>
        ) : (
          <div className="space-y-2">
            {(data?.dueTouchpoints ?? []).map((tp: any) => {
              const dealId = touchpointDealId(tp);
              const dayDelta = calendarDaysFromToday(tp.scheduled_date ?? todayStr);
              const due = followUpDueBadge(dayDelta);
              const toneClass =
                due.tone === "overdue"
                  ? "bg-red-500/15 text-red-400"
                  : due.tone === "today"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-muted text-muted-foreground";
              const row = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {String(tp.touchpoint_type ?? "touchpoint").replace(/_/g, " ")}
                    </span>
                    <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0 ${toneClass}`}>{due.label}</span>
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
