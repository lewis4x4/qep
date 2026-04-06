import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { useIronWomanData } from "../hooks/useDashboardData";
import { Package, DollarSign, Boxes, CreditCard, ArrowUpRight } from "lucide-react";

function dealStageName(deal: { crm_deal_stages?: { name?: string | null } | { name?: string | null }[] | null }): string {
  const s = deal.crm_deal_stages;
  if (!s) return "—";
  if (Array.isArray(s)) return s[0]?.name?.trim() || "—";
  return s.name?.trim() || "—";
}

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Iron Woman Command Center</h1>
          <p className="text-sm text-muted-foreground">Order processing, deposits, equipment intake, credit tracking</p>
        </div>
        <Link
          to="/ops/intake"
          className="inline-flex items-center gap-1 text-sm font-medium text-qep-orange hover:underline shrink-0"
        >
          Intake board
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardKpiCard label="Orders Processing" value={data?.orderProcessing?.length ?? 0} icon={<Package className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="Pending Deposits" value={`$${(pendingDepositTotal / 1000).toFixed(0)}K`} sublabel={`${data?.pendingDeposits?.length ?? 0} deposits`} icon={<DollarSign className="h-4 w-4 text-amber-400" />} accent="text-amber-400" />
        <DashboardKpiCard label="Intake Pipeline" value={data?.intakeItems?.length ?? 0} sublabel="equipment in process" icon={<Boxes className="h-4 w-4 text-violet-400" />} />
        <DashboardKpiCard label="Credit Apps" value={data?.creditApps?.length ?? 0} sublabel="pending approval" icon={<CreditCard className="h-4 w-4 text-emerald-400" />} />
      </div>

      {/* Order processing (stages 13–16) — loaded in hook but previously not listed */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Order processing</h3>
        <p className="text-xs text-muted-foreground mb-3">Deals from sales order signed through deposit collected (pipeline steps 13–16).</p>
        {(data?.orderProcessing ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals in this stage band.</p>
        ) : (
          <div className="space-y-2">
            {(data?.orderProcessing ?? []).map((deal: any) => (
              <Link
                key={deal.id}
                to={`/crm/deals/${deal.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{deal.name}</p>
                  <p className="text-[10px] text-muted-foreground">{dealStageName(deal)}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">
                  {deal.amount != null ? `$${Number(deal.amount).toLocaleString()}` : "—"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Credit applications (stage 14) */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Credit applications</h3>
        <p className="text-xs text-muted-foreground mb-3">Deals in credit-submitted stage awaiting bank status.</p>
        {(data?.creditApps ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals in credit review.</p>
        ) : (
          <div className="space-y-2">
            {(data?.creditApps ?? []).map((deal: any) => (
              <Link
                key={deal.id}
                to={`/crm/deals/${deal.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{deal.name}</p>
                  <p className="text-[10px] text-muted-foreground">{dealStageName(deal)}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">
                  {deal.amount != null ? `$${Number(deal.amount).toLocaleString()}` : "—"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

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
              <Link
                key={item.id}
                to="/ops/intake"
                className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
              >
                <span className="text-sm font-medium">{item.stock_number || "No stock #"}</span>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className={`h-2 w-4 rounded-sm ${i < item.current_stage ? "bg-qep-orange" : "bg-muted"}`} />
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{item.current_stage}/8</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
