import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { useIronWomanData } from "../hooks/useDashboardData";
import { Package, DollarSign, Boxes, CreditCard } from "lucide-react";

export function IronWomanDashboard() {
  const { data, isLoading, isError } = useIronWomanData();

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>;
  }

  if (isError) {
    return <Card className="border-red-500/20 p-6 text-center"><p className="text-sm text-red-400">Failed to load dashboard. Please refresh.</p></Card>;
  }

  const pendingDepositTotal = (data?.pendingDeposits ?? []).reduce((sum: number, d: any) => sum + (d.required_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Iron Woman Command Center</h1>
        <p className="text-sm text-muted-foreground">Order processing, deposits, equipment intake, credit tracking</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardKpiCard label="Orders Processing" value={data?.orderProcessing?.length ?? 0} icon={<Package className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="Pending Deposits" value={`$${(pendingDepositTotal / 1000).toFixed(0)}K`} sublabel={`${data?.pendingDeposits?.length ?? 0} deposits`} icon={<DollarSign className="h-4 w-4 text-amber-400" />} accent="text-amber-400" />
        <DashboardKpiCard label="Intake Pipeline" value={data?.intakeItems?.length ?? 0} sublabel="equipment in process" icon={<Boxes className="h-4 w-4 text-violet-400" />} />
        <DashboardKpiCard label="Credit Apps" value={data?.creditApps?.length ?? 0} sublabel="pending approval" icon={<CreditCard className="h-4 w-4 text-emerald-400" />} />
      </div>

      {/* Deposit tracker */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Deposit Tracker</h3>
        {(data?.pendingDeposits ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending deposits.</p>
        ) : (
          <div className="space-y-2">
            {(data?.pendingDeposits ?? []).map((dep: any) => (
              <Link
                key={dep.id}
                to={`/crm/deals/${dep.deal_id}`}
                className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
              >
                <div>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    dep.status === "received" ? "bg-emerald-500/10 text-emerald-400" :
                    dep.status === "requested" ? "bg-amber-500/10 text-amber-400" :
                    "bg-muted text-muted-foreground"
                  }`}>{dep.status}</span>
                </div>
                <span className="font-semibold text-foreground">${dep.required_amount?.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Intake progress */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Equipment Intake Progress</h3>
        {(data?.intakeItems ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No equipment in intake pipeline.</p>
        ) : (
          <div className="space-y-2">
            {(data?.intakeItems ?? []).map((item: any) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <span className="text-sm font-medium">{item.stock_number || "No stock #"}</span>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className={`h-2 w-4 rounded-sm ${i < item.current_stage ? "bg-qep-orange" : "bg-muted"}`} />
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{item.current_stage}/8</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
