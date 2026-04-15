import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { IronDashboardShell } from "../components/IronDashboardShell";
import { OwnershipIntelPanel } from "../components/OwnershipIntelPanel";
import { useIronManagerData } from "../hooks/useDashboardData";
import { useDashboardRealtime } from "../hooks/useDashboardRealtime";
import { DEFAULT_WIDGETS } from "../widgets/role-defaults";
import { Users, TrendingUp, AlertTriangle, DollarSign, Package } from "lucide-react";

export function IronManagerDashboard() {
  const { data } = useIronManagerData();
  // Slice 5.7 — live updates from pipeline / approvals / aging sources.
  useDashboardRealtime("iron_manager", ["dashboard", "iron-manager"]);

  const totalPipeline = (data?.pipelineDeals ?? []).reduce(
    (sum: number, d: any) => sum + (d.amount ?? 0),
    0,
  );
  const targetsMet = (data?.kpis ?? []).filter((k: any) => k.target_met).length;
  const totalAdvisors = (data?.kpis ?? []).length;
  const agingCount = data?.agingEquipment?.length ?? 0;

  const kpis = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <DashboardKpiCard
        label="Pipeline Value"
        value={`$${(totalPipeline / 1000).toFixed(0)}K`}
        icon={<DollarSign className="h-4 w-4 text-qep-orange" />}
        accent="text-qep-orange"
      />
      <DashboardKpiCard
        label="Open Deals"
        value={data?.pipelineDeals?.length ?? 0}
        icon={<TrendingUp className="h-4 w-4 text-blue-400" />}
      />
      <DashboardKpiCard
        label="Pending Approvals"
        value={data?.approvalCount ?? 0}
        icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
        accent={data?.approvalCount ? "text-amber-400" : "text-foreground"}
      />
      <DashboardKpiCard
        label="KPI Target Met"
        value={`${targetsMet}/${totalAdvisors}`}
        sublabel="advisors today"
        icon={<Users className="h-4 w-4 text-emerald-400" />}
      />
      <DashboardKpiCard
        label="Aging fleet"
        value={agingCount}
        sublabel="90d+ in registry"
        icon={<Package className="h-4 w-4 text-amber-400" />}
        accent={agingCount > 0 ? "text-amber-400" : "text-foreground"}
      />
    </div>
  );

  return (
    <IronDashboardShell
      title="Iron Manager Command Center"
      subtitle="Pipeline oversight, approvals, team KPIs"
      kpis={kpis}
      widgetIds={DEFAULT_WIDGETS.iron_manager}
      legacy={<OwnershipIntelPanel />}
    />
  );
}
