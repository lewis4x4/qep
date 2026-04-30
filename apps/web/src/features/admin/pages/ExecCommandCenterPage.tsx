import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Crown, FileText, Wrench, Heart, Building2, Inbox, ShieldAlert } from "lucide-react";
import { ForwardForecastBar } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type ExecQuoteRiskRow = Database["public"]["Views"]["exec_quote_risk"]["Row"];
type ExecServiceBacklogRow = Database["public"]["Views"]["exec_service_backlog"]["Row"];
type ExecHealthMoverRow = Database["public"]["Views"]["exec_health_movers"]["Row"];
type ExecBranchRow = Database["public"]["Views"]["exec_branch_comparison"]["Row"];
type ExecExceptionSummaryRow = Database["public"]["Views"]["exec_exception_summary"]["Row"];
type ExecDqSummaryRow = Database["public"]["Tables"]["exec_data_quality_summary"]["Row"];

function useExecView<T>(
  name: string,
  load: () => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  return useQuery({
    queryKey: ["exec", name],
    queryFn: async () => {
      const { data, error } = await load();
      if (error) return [] as T[];
      return data ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function ExecCommandCenterPage() {
  const quoteRisk = useExecView<ExecQuoteRiskRow>("exec_quote_risk", () =>
    supabase.from("exec_quote_risk").select("*").limit(100),
  );
  const serviceBacklog = useExecView<ExecServiceBacklogRow>("exec_service_backlog", () =>
    supabase.from("exec_service_backlog").select("*").limit(100),
  );
  const healthMovers = useExecView<ExecHealthMoverRow>("exec_health_movers", () =>
    supabase.from("exec_health_movers").select("*").limit(100),
  );
  const branchCmp = useExecView<ExecBranchRow>("exec_branch_comparison", () =>
    supabase.from("exec_branch_comparison").select("*").limit(100),
  );
  const exceptions = useExecView<ExecExceptionSummaryRow>("exec_exception_summary", () =>
    supabase.from("exec_exception_summary").select("*").limit(100),
  );
  const dq = useExecView<ExecDqSummaryRow>("exec_data_quality_summary", () =>
    supabase.from("exec_data_quality_summary").select("*").limit(100),
  );

  const totalOpenQuoteDollars = (quoteRisk.data ?? []).reduce((s, r) => s + Number(r.total_dollars ?? 0), 0);
  const expiringSoon          = (quoteRisk.data ?? []).reduce((s, r) => s + Number(r.expiring_soon_count ?? 0), 0);
  const overdueService        = (serviceBacklog.data ?? []).reduce((s, r) => s + Number(r.overdue ?? 0), 0);
  const openExceptions        = (exceptions.data ?? []).reduce((s, r) => s + Number(r.open_count ?? 0), 0);
  const openDqIssues          = (dq.data ?? []).reduce((s, r) => s + Number(r.open_count ?? 0), 0);
  const healthMoverCount      = healthMovers.data?.length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div>
        <div className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-qep-orange" aria-hidden />
          <h1 className="text-xl font-bold text-foreground">Executive Command Center</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The owner / COO scan-once view across every wave. Materialized views refresh nightly.
        </p>
      </div>

      <ForwardForecastBar
        counters={[
          { label: "Open quote $",  value: `$${(totalOpenQuoteDollars / 1000).toFixed(0)}K`, tone: "blue",   icon: <FileText className="h-4 w-4" />, href: "/quotes" },
          { label: "Expiring 7d",   value: expiringSoon,    tone: "red",    icon: <FileText className="h-4 w-4" />, href: "/quotes" },
          { label: "Overdue PM",    value: overdueService,  tone: "orange", icon: <Wrench className="h-4 w-4" />, href: "/service/dashboard" },
          { label: "Health movers", value: healthMoverCount,tone: "violet", icon: <Heart className="h-4 w-4" />, href: "/nervous-system" },
          { label: "Exceptions",    value: openExceptions,  tone: "red",    icon: <Inbox className="h-4 w-4" />, href: "/exceptions" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Quote risk */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-blue-400" aria-hidden />
            <h2 className="text-sm font-bold text-foreground">Quote risk</h2>
          </div>
          {quoteRisk.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted/20" />
          ) : quoteRisk.data && quoteRisk.data.length > 0 ? (
            <div className="space-y-1.5">
              {quoteRisk.data.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground capitalize">{r.status ?? "unknown"}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {Number(r.quote_count ?? 0)} · ${Number(r.total_dollars ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No open quotes.</p>
          )}
        </Card>

        {/* Service backlog */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wrench className="h-4 w-4 text-qep-orange" aria-hidden />
            <h2 className="text-sm font-bold text-foreground">Service backlog</h2>
          </div>
          {serviceBacklog.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted/20" />
          ) : serviceBacklog.data && serviceBacklog.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Overdue" value={serviceBacklog.data.reduce((s, r) => s + Number(r.overdue ?? 0), 0)} color="text-red-400" />
              <Stat label="In progress" value={serviceBacklog.data.reduce((s, r) => s + Number(r.in_progress ?? 0), 0)} color="text-qep-orange" />
              <Stat label="Parts waiting" value={serviceBacklog.data.reduce((s, r) => s + Number(r.parts_waiting ?? 0), 0)} color="text-amber-400" />
              <Stat label="Closed" value={serviceBacklog.data.reduce((s, r) => s + Number(r.closed_recent ?? 0), 0)} color="text-emerald-400" />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Quiet shop.</p>
          )}
        </Card>

        {/* Branch comparison */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-violet-400" aria-hidden />
            <h2 className="text-sm font-bold text-foreground">Branch comparison</h2>
          </div>
          {branchCmp.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted/20" />
          ) : branchCmp.data && branchCmp.data.length > 0 ? (
            <div className="space-y-1.5">
              {branchCmp.data.map((r, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 text-xs">
                  <span className="text-foreground truncate">{r.branch_id ?? "—"}</span>
                  <span className="text-red-400 tabular-nums">{Number(r.overdue ?? 0)} overdue</span>
                  <span className="text-qep-orange tabular-nums">{Number(r.active ?? 0)} active</span>
                  <span className="text-emerald-400 tabular-nums">{Number(r.closed ?? 0)} closed</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No branch data yet.</p>
          )}
        </Card>

        {/* Data quality */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden />
            <h2 className="text-sm font-bold text-foreground">Data quality</h2>
            <span className="ml-auto text-[10px] text-muted-foreground">{openDqIssues} open</span>
          </div>
          {dq.isLoading ? (
            <div className="h-16 animate-pulse rounded bg-muted/20" />
          ) : dq.data && dq.data.length > 0 ? (
            <div className="space-y-1">
              {dq.data.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate">{r.issue_class.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground tabular-nums">{r.open_count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">All clean.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
