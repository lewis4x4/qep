import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { IronDashboardShell } from "../components/IronDashboardShell";
import { useIronAdvisorData } from "../hooks/useDashboardData";
import { DEFAULT_WIDGETS } from "../widgets/role-defaults";
import { Clock, Target, CalendarDays } from "lucide-react";

interface IronAdvisorDashboardProps {
  userId: string;
}

export function IronAdvisorDashboard({ userId }: IronAdvisorDashboardProps) {
  const { data } = useIronAdvisorData(userId);

  const slaDeals = (data?.myDeals ?? []).filter(
    (d: any) => d.sla_deadline_at && new Date(d.sla_deadline_at) < new Date(),
  );
  const todayStr = data?.todayStr ?? new Date().toISOString().split("T")[0];
  const dueOrOverdueCount = (data?.dueTouchpoints ?? []).filter(
    (tp: { scheduled_date?: string }) => (tp.scheduled_date ?? "") <= todayStr,
  ).length;

  const kpis = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <DashboardKpiCard
        label="My Deals"
        value={data?.myDeals?.length ?? 0}
        icon={<Target className="h-4 w-4 text-blue-400" />}
      />
      <DashboardKpiCard
        label="SLA Violations"
        value={slaDeals.length}
        accent={slaDeals.length > 0 ? "text-red-400" : "text-emerald-400"}
        icon={<Clock className="h-4 w-4" />}
      />
      <DashboardKpiCard
        label="Due Follow-Ups"
        value={dueOrOverdueCount}
        accent="text-amber-400"
        icon={<CalendarDays className="h-4 w-4 text-amber-400" />}
        sublabel="today or overdue"
      />
      <DashboardKpiCard
        label="Streak"
        value={`${data?.kpi?.consecutive_days_met ?? 0}d`}
        sublabel="consecutive target days"
      />
    </div>
  );

  return (
    <IronDashboardShell
      title="Iron Advisor Command Center"
      subtitle="Your pipeline, follow-ups, prospecting targets"
      kpis={kpis}
      widgetIds={DEFAULT_WIDGETS.iron_advisor}
    />
  );
}
