import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { DashboardKpiCard } from "../components/DashboardKpiCard";
import { useIronManData } from "../hooks/useDashboardData";
import { Wrench, ClipboardCheck, Truck, RotateCcw, ArrowUpRight } from "lucide-react";

/** Matches IntakeKanbanPage 8-stage model; Iron Man prep focuses on 2–4. */
const INTAKE_STAGE_LABEL: Record<number, string> = {
  1: "Purchase & Logistics",
  2: "Equipment Arrival",
  3: "PDI Completion",
  4: "Inventory Labeling",
  5: "Sales Readiness",
  6: "Online Listing",
  7: "Internal Docs",
  8: "Sale Ready",
};

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Iron Man Command Center</h1>
          <p className="text-sm text-muted-foreground">Equipment prep, PDI, demos, rental inspections</p>
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
        <DashboardKpiCard label="Prep Queue" value={data?.prepQueue?.length ?? 0} icon={<Wrench className="h-4 w-4 text-blue-400" />} />
        <DashboardKpiCard label="PDI Pending" value={data?.pdiItems?.length ?? 0} icon={<ClipboardCheck className="h-4 w-4 text-amber-400" />} accent={data?.pdiItems?.length ? "text-amber-400" : "text-foreground"} />
        <DashboardKpiCard label="Upcoming Demos" value={data?.upcomingDemos?.length ?? 0} icon={<Truck className="h-4 w-4 text-violet-400" />} />
        <DashboardKpiCard label="Return Inspections" value={data?.returnInspections?.length ?? 0} icon={<RotateCcw className="h-4 w-4 text-emerald-400" />} />
      </div>

      {/* Prep queue (stages 2–4) — was loaded in hook but not surfaced */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Prep queue</h3>
        <p className="text-xs text-muted-foreground mb-3">Equipment in arrival, PDI, or labeling (stages 2–4).</p>
        {(data?.prepQueue ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in prep right now.</p>
        ) : (
          <div className="space-y-2">
            {(data?.prepQueue ?? []).map((item: { id: string; stock_number?: string | null; current_stage?: number | null }) => (
              <Link
                key={item.id}
                to="/ops/intake"
                className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
              >
                <span className="text-sm font-medium text-foreground">{item.stock_number || "No stock #"}</span>
                <span className="text-[10px] font-medium text-muted-foreground">
                  Stage {item.current_stage ?? "?"} · {INTAKE_STAGE_LABEL[item.current_stage ?? 0] ?? "Intake"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

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
                <Link
                  key={item.id}
                  to="/ops/intake"
                  className="block rounded-lg border border-border p-3 hover:border-foreground/20 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{item.stock_number || "Equipment"}</span>
                    <span className="text-xs text-muted-foreground">{completed}/{total} items</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-qep-orange transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </Link>
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
            {(data?.upcomingDemos ?? []).map((demo: any) => {
              const shell = (
                <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
                  <div>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      demo.status === "scheduled" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                    }`}>{demo.status}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{demo.equipment_category} • {demo.max_hours}hr max</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{demo.scheduled_date || "TBD"}</span>
                </div>
              );
              return demo.deal_id ? (
                <Link key={demo.id} to={`/crm/deals/${demo.deal_id}`} className="block hover:opacity-90 transition">
                  {shell}
                </Link>
              ) : (
                <div key={demo.id}>{shell}</div>
              );
            })}
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
              <Link
                key={ret.id}
                to="/ops/returns"
                className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
              >
                <span className="text-sm font-medium">Rental return</span>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">Inspection pending</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
