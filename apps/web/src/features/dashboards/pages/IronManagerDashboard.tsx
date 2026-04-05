import { Card } from "@/components/ui/card";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { useIronManagerData } from "../hooks/useDashboardData";
import { Users, TrendingUp, AlertTriangle, DollarSign } from "lucide-react";

/** PostgREST may return numeric columns as strings; calling .toFixed on a string throws. */
function formatPercentLabel(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(1)}`;
}

export function IronManagerDashboard() {
  const { data, isLoading, isError } = useIronManagerData();

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>;
  }

  if (isError) {
    return <Card className="border-red-500/20 p-6 text-center"><p className="text-sm text-red-400">Failed to load dashboard. Please refresh.</p></Card>;
  }

  const approvalItems = [
    ...(data?.pendingDemos ?? []).map((d: any) => ({ id: d.id, deal_id: d.deal_id, type: "demo" as const, label: `Demo Request`, detail: `${d.equipment_category} demo` })),
    ...(data?.pendingTrades ?? []).map((t: any) => ({ id: t.id, deal_id: t.deal_id, type: "trade" as const, label: `${t.make} ${t.model}`, detail: `Preliminary: $${t.preliminary_value?.toLocaleString() ?? "N/A"}` })),
    ...(data?.marginFlags ?? []).map((m: any) => ({
      id: m.id,
      deal_id: m.id,
      type: "margin" as const,
      label: m.name,
      detail: `Margin: ${formatPercentLabel(m.margin_pct)}%`,
    })),
  ];

  const totalPipeline = (data?.pipelineDeals ?? []).reduce((sum: number, d: any) => sum + (d.amount ?? 0), 0);
  const targetsMet = (data?.kpis ?? []).filter((k: any) => k.target_met).length;
  const totalAdvisors = (data?.kpis ?? []).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Iron Manager Command Center</h1>
        <p className="text-sm text-muted-foreground">Pipeline oversight, approvals, team KPIs</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardKpiCard label="Pipeline Value" value={`$${(totalPipeline / 1000).toFixed(0)}K`} icon={<DollarSign className="h-4 w-4 text-qep-orange" />} accent="text-qep-orange" />
        <DashboardKpiCard label="Open Deals" value={data?.pipelineDeals?.length ?? 0} icon={<TrendingUp className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="Pending Approvals" value={data?.approvalCount ?? 0} icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} accent={data?.approvalCount ? "text-amber-400" : "text-foreground"} />
        <DashboardKpiCard label="KPI Target Met" value={`${targetsMet}/${totalAdvisors}`} sublabel="advisors today" icon={<Users className="h-4 w-4 text-emerald-400" />} />
      </div>

      <ApprovalQueue items={approvalItems} />
    </div>
  );
}
