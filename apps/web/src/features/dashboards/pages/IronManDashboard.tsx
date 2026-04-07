import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { IronDashboardShell } from "../components/IronDashboardShell";
import { useIronManData } from "../hooks/useDashboardData";
import { DEFAULT_WIDGETS } from "../widgets/role-defaults";
import { Wrench, ClipboardCheck, Truck, RotateCcw, ArrowUpRight } from "lucide-react";

export function IronManDashboard() {
  const { data } = useIronManData();

  const kpis = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <DashboardKpiCard
        label="Prep Queue"
        value={data?.prepQueue?.length ?? 0}
        icon={<Wrench className="h-4 w-4 text-blue-400" />}
      />
      <DashboardKpiCard
        label="PDI Pending"
        value={data?.pdiItems?.length ?? 0}
        icon={<ClipboardCheck className="h-4 w-4 text-amber-400" />}
        accent={data?.pdiItems?.length ? "text-amber-400" : "text-foreground"}
      />
      <DashboardKpiCard
        label="Upcoming Demos"
        value={data?.upcomingDemos?.length ?? 0}
        icon={<Truck className="h-4 w-4 text-violet-400" />}
      />
      <DashboardKpiCard
        label="Return Inspections"
        value={data?.returnInspections?.length ?? 0}
        icon={<RotateCcw className="h-4 w-4 text-emerald-400" />}
      />
    </div>
  );

  const headerAction = (
    <Link
      to="/ops/intake"
      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-qep-orange hover:underline"
    >
      Intake board
      <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );

  return (
    <IronDashboardShell
      title="Iron Man Command Center"
      subtitle="Equipment prep, PDI, demos, rental inspections"
      headerAction={headerAction}
      kpis={kpis}
      widgetIds={DEFAULT_WIDGETS.iron_man}
    />
  );
}
