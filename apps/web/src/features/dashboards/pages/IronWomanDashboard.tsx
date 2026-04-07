import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { IronDashboardShell } from "../components/IronDashboardShell";
import { useIronWomanData } from "../hooks/useDashboardData";
import { DEFAULT_WIDGETS } from "../widgets/role-defaults";
import { Package, DollarSign, Boxes, CreditCard, ArrowUpRight } from "lucide-react";

export function IronWomanDashboard() {
  const { data } = useIronWomanData();

  const pendingDepositTotal = (data?.pendingDeposits ?? []).reduce(
    (sum: number, d: any) => sum + (d.required_amount ?? 0),
    0,
  );

  const kpis = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <DashboardKpiCard
        label="Orders Processing"
        value={data?.orderProcessing?.length ?? 0}
        icon={<Package className="h-4 w-4 text-blue-400" />}
      />
      <DashboardKpiCard
        label="Pending Deposits"
        value={`$${(pendingDepositTotal / 1000).toFixed(0)}K`}
        sublabel={`${data?.pendingDeposits?.length ?? 0} deposits`}
        icon={<DollarSign className="h-4 w-4 text-amber-400" />}
        accent="text-amber-400"
      />
      <DashboardKpiCard
        label="Intake Pipeline"
        value={data?.intakeItems?.length ?? 0}
        sublabel="equipment in process"
        icon={<Boxes className="h-4 w-4 text-violet-400" />}
      />
      <DashboardKpiCard
        label="Credit Apps"
        value={data?.creditApps?.length ?? 0}
        sublabel="pending approval"
        icon={<CreditCard className="h-4 w-4 text-emerald-400" />}
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
      title="Iron Woman Command Center"
      subtitle="Order processing, deposits, equipment intake, credit tracking"
      headerAction={headerAction}
      kpis={kpis}
      widgetIds={DEFAULT_WIDGETS.iron_woman}
    />
  );
}
