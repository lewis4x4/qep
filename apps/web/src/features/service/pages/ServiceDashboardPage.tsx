import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Wrench, Users, AlertTriangle, Clock, TrendingUp } from "lucide-react";
import {
  FilterBar,
  DashboardPivotToggle,
  ForwardForecastBar,
  StatusChipStack,
  type FilterDef,
} from "@/components/primitives";
import { supabase } from "@/lib/supabase";

interface ServiceJobRow {
  id: string;
  customer_id: string | null;
  machine_id: string | null;
  current_stage: string;
  scheduled_end_at: string | null;
  customer_problem_summary: string | null;
  branch_id: string | null;
  technician_id: string | null;
  invoice_total: number | null;
  customer_name?: string | null;
  open_deal_value?: number | null;
  trade_up_score?: number | null;
}

interface RollupRow {
  workspace_id: string;
  branch_id: string | null;
  overdue_count: number;
  pending_count: number;
  active_count: number;
  closed_count: number;
  total_count: number;
}

const FILTERS: FilterDef[] = [
  { key: "branch", label: "Branch", type: "text" },
  {
    key: "stage", label: "Stage", type: "select",
    options: [
      { value: "request_received", label: "Intake" },
      { value: "scheduling",       label: "Scheduling" },
      { value: "in_progress",      label: "In progress" },
      { value: "parts_waiting",    label: "Parts waiting" },
      { value: "awaiting_customer",label: "Awaiting customer" },
    ],
  },
];

export function ServiceDashboardPage() {
  const [pivot, setPivot] = useState<"dashboard" | "mechanic">("dashboard");

  const rollupQuery = useQuery({
    queryKey: ["service-dashboard", "rollup"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => Promise<{ data: RollupRow[] | null; error: unknown }> };
      }).from("service_dashboard_rollup").select("*");
      if (error) throw new Error("Failed to load rollup");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const overdueQuery = useQuery({
    queryKey: ["service-dashboard", "overdue"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { lt: (c: string, v: string) => { not: (c: string, op: string, v: string[]) => { order: (c: string, o: Record<string, boolean>) => { limit: (n: number) => Promise<{ data: ServiceJobRow[] | null; error: unknown }> } } } } };
      }).from("service_jobs")
        .select("id, customer_id, machine_id, current_stage, scheduled_end_at, customer_problem_summary, branch_id, technician_id, invoice_total")
        .lt("scheduled_end_at", new Date().toISOString())
        .not("current_stage", "in", ["closed", "invoiced", "cancelled"])
        .order("scheduled_end_at", { ascending: true })
        .limit(50);
      if (error) throw new Error("Failed to load overdue work orders");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const totals = useMemo(() => {
    const r = rollupQuery.data ?? [];
    return r.reduce(
      (acc, x) => ({
        overdue: acc.overdue + (x.overdue_count ?? 0),
        pending: acc.pending + (x.pending_count ?? 0),
        active:  acc.active  + (x.active_count  ?? 0),
        closed:  acc.closed  + (x.closed_count  ?? 0),
        total:   acc.total   + (x.total_count   ?? 0),
      }),
      { overdue: 0, pending: 0, active: 0, closed: 0, total: 0 },
    );
  }, [rollupQuery.data]);

  const completionPct = totals.total > 0
    ? Math.round((totals.closed / totals.total) * 100)
    : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Service Dashboard</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            T3-grade operational view augmented with the commercial overlay T3 cannot offer.
          </p>
        </div>
        <DashboardPivotToggle
          value={pivot}
          onChange={(k) => setPivot(k as "dashboard" | "mechanic")}
          pivots={[
            { key: "dashboard", label: "Service Dashboard", icon: <Wrench className="h-3 w-3" /> },
            { key: "mechanic",  label: "Mechanic Overview", icon: <Users className="h-3 w-3" /> },
          ]}
        />
      </div>

      <FilterBar filters={FILTERS} />

      {/* Top widgets */}
      <ForwardForecastBar
        counters={[
          { label: "Overdue PM",    value: totals.overdue, tone: "red",    icon: <AlertTriangle className="h-4 w-4" /> },
          { label: "Pending intake",value: totals.pending, tone: "blue",   icon: <Clock className="h-4 w-4" /> },
          { label: "Active jobs",   value: totals.active,  tone: "orange", icon: <Wrench className="h-4 w-4" /> },
          { label: "Completion",    value: `${completionPct}%`, tone: "green", icon: <TrendingUp className="h-4 w-4" /> },
        ]}
      />

      {pivot === "dashboard" ? (
        <DashboardPivot
          rollupRows={rollupQuery.data ?? []}
          overdueRows={overdueQuery.data ?? []}
          isLoading={rollupQuery.isLoading || overdueQuery.isLoading}
        />
      ) : (
        <MechanicOverviewPivot />
      )}
    </div>
  );
}

/* ── Dashboard pivot ─────────────────────────────────────────────── */

function DashboardPivot({
  rollupRows, overdueRows, isLoading,
}: {
  rollupRows: RollupRow[];
  overdueRows: ServiceJobRow[];
  isLoading: boolean;
}) {
  return (
    <>
      {/* Branch breakdown */}
      <Card className="p-4">
        <h2 className="text-sm font-bold text-foreground mb-3">By branch</h2>
        {isLoading ? (
          <div className="h-16 animate-pulse rounded bg-muted/20" />
        ) : rollupRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No service activity yet.</p>
        ) : (
          <div className="space-y-2">
            {rollupRows.map((r, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 text-xs">
                <div className="text-foreground font-medium">{r.branch_id ?? "—"}</div>
                <div className="text-red-400 tabular-nums">{r.overdue_count} overdue</div>
                <div className="text-blue-400 tabular-nums">{r.pending_count} pending</div>
                <div className="text-qep-orange tabular-nums">{r.active_count} active</div>
                <div className="text-emerald-400 tabular-nums">{r.closed_count} closed</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Overdue Work Order Inspections — with QEP-only commercial columns */}
      <Card className="p-4">
        <h2 className="text-sm font-bold text-foreground mb-3">Overdue work orders</h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-muted/20" />)}
          </div>
        ) : overdueRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Zero overdue work orders. Clean board.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 text-left">Job</th>
                  <th className="py-2 text-left">Stage</th>
                  <th className="py-2 text-left">Days late</th>
                  <th className="py-2 text-left">Open Deal $</th>
                  <th className="py-2 text-left">Trade-Up</th>
                  <th className="py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {overdueRows.map((sj) => {
                  const daysLate = sj.scheduled_end_at
                    ? Math.floor((Date.now() - new Date(sj.scheduled_end_at).getTime()) / 86_400_000)
                    : 0;
                  return (
                    <tr key={sj.id} className="border-b border-border/50">
                      <td className="py-2">
                        <Link to={`/service?id=${sj.id}`} className="text-foreground hover:text-qep-orange">
                          {sj.customer_problem_summary?.slice(0, 50) ?? "Service job"}
                        </Link>
                      </td>
                      <td className="py-2">
                        <StatusChipStack chips={[{ label: sj.current_stage, tone: "yellow" }]} />
                      </td>
                      <td className="py-2 text-red-400 tabular-nums">{daysLate}d</td>
                      <td className="py-2 tabular-nums">
                        {sj.open_deal_value != null ? `$${sj.open_deal_value.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-2 tabular-nums">
                        {sj.trade_up_score != null ? sj.trade_up_score : "—"}
                      </td>
                      <td className="py-2">
                        {sj.machine_id ? (
                          <Link
                            to={`/equipment/${sj.machine_id}`}
                            className="text-[10px] font-semibold text-qep-orange hover:underline"
                          >
                            Open Asset 360 →
                          </Link>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">no asset</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Open Deal $ + Trade-Up columns enrich post-Phase-2C revenue attribution rollout.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

/* ── Mechanic Overview pivot ─────────────────────────────────────── */

function MechanicOverviewPivot() {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-bold text-foreground mb-2">Mechanic Overview</h2>
      <p className="text-xs text-muted-foreground">
        Per-tech clocked hours, open WO count, and average WO close time render here once
        <code className="mx-1 rounded bg-muted px-1">service_timecards</code> rows accrue (mig 161).
      </p>
    </Card>
  );
}
