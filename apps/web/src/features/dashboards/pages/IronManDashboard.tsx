import { Card } from "@/components/ui/card";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { useIronManData } from "../hooks/useDashboardData";
import { Wrench, ClipboardCheck, Truck, RotateCcw } from "lucide-react";

export function IronManDashboard() {
  const { data, isLoading, isError } = useIronManData();

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>;
  }

  if (isError) {
    return <Card className="border-red-500/20 p-6 text-center"><p className="text-sm text-red-400">Failed to load dashboard. Please refresh.</p></Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Iron Man Command Center</h1>
        <p className="text-sm text-muted-foreground">Equipment prep, PDI, demos, rental inspections</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashboardKpiCard label="Prep Queue" value={data?.prepQueue?.length ?? 0} icon={<Wrench className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="PDI Pending" value={data?.pdiItems?.length ?? 0} icon={<ClipboardCheck className="h-4 w-4 text-amber-400" />} accent={data?.pdiItems?.length ? "text-amber-400" : "text-foreground"} />
        <DashboardKpiCard label="Upcoming Demos" value={data?.upcomingDemos?.length ?? 0} icon={<Truck className="h-4 w-4 text-violet-400" />} />
        <DashboardKpiCard label="Return Inspections" value={data?.returnInspections?.length ?? 0} icon={<RotateCcw className="h-4 w-4 text-emerald-400" />} />
      </div>

      {/* PDI Checklists */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">PDI Checklists</h3>
        {(data?.pdiItems ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No PDI items pending.</p>
        ) : (
          <div className="space-y-2">
            {(data?.pdiItems ?? []).map((item: any) => {
              const checklist = Array.isArray(item.pdi_checklist) ? item.pdi_checklist : [];
              const completed = checklist.filter((c: any) => c.completed).length;
              const total = checklist.length || 1;
              const pct = Math.round((completed / total) * 100);

              return (
                <div key={item.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{item.stock_number || "Equipment"}</span>
                    <span className="text-xs text-muted-foreground">{completed}/{total} items</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-qep-orange transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Demo Schedule */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Demo Schedule</h3>
        {(data?.upcomingDemos ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No demos scheduled.</p>
        ) : (
          <div className="space-y-2">
            {(data?.upcomingDemos ?? []).map((demo: any) => (
              <div key={demo.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <div>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    demo.status === "scheduled" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                  }`}>{demo.status}</span>
                  <span className="ml-2 text-sm text-muted-foreground">{demo.equipment_category} • {demo.max_hours}hr max</span>
                </div>
                <span className="text-xs text-muted-foreground">{demo.scheduled_date || "TBD"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Rental Return Inspections */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Return Inspections</h3>
        {(data?.returnInspections ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No return inspections pending.</p>
        ) : (
          <div className="space-y-2">
            {(data?.returnInspections ?? []).map((ret: any) => (
              <div key={ret.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                <span className="text-sm font-medium">Equipment Return</span>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">Inspection Pending</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
