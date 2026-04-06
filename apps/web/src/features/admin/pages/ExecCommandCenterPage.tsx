import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Crown, FileText, Wrench, Heart, Building2, Inbox, ShieldAlert } from "lucide-react";
import { ForwardForecastBar } from "@/components/primitives";
import { supabase } from "@/lib/supabase";

interface QuoteRiskRow { workspace_id: string; status: string; quote_count: number; total_dollars: number; expiring_soon_count: number; }
interface ServiceBacklogRow { workspace_id: string; overdue: number; in_progress: number; parts_waiting: number; closed_recent: number; }
interface HealthMoverRow { customer_profile_id: string; health_score: number | null; health_score_updated_at: string; }
interface BranchRow { branch_id: string | null; overdue: number; active: number; closed: number; }
interface ExceptionSummaryRow { source: string; severity: string; open_count: number; }
interface DqSummaryRow { issue_class: string; open_count: number; }

const sb = (table: string) => (supabase as unknown as {
  from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> } };
}).from(table).select("*").limit(100);

function useExecView<T>(name: string) {
  return useQuery({
    queryKey: ["exec", name],
    queryFn: async () => {
      const { data, error } = await sb(name);
      if (error) return [] as T[];
      return (data ?? []) as T[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function ExecCommandCenterPage() {
  const quoteRisk      = useExecView<QuoteRiskRow>("exec_quote_risk");
  const serviceBacklog = useExecView<ServiceBacklogRow>("exec_service_backlog");
  const healthMovers   = useExecView<HealthMoverRow>("exec_health_movers");
  const branchCmp      = useExecView<BranchRow>("exec_branch_comparison");
  const exceptions     = useExecView<ExceptionSummaryRow>("exec_exception_summary");
  const dq             = useExecView<DqSummaryRow>("exec_data_quality_summary");

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
                  <span className="text-foreground capitalize">{r.status}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.quote_count} · ${Number(r.total_dollars).toLocaleString()}
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
              <Stat label="Overdue" value={serviceBacklog.data.reduce((s, r) => s + r.overdue, 0)} color="text-red-400" />
              <Stat label="In progress" value={serviceBacklog.data.reduce((s, r) => s + r.in_progress, 0)} color="text-qep-orange" />
              <Stat label="Parts waiting" value={serviceBacklog.data.reduce((s, r) => s + r.parts_waiting, 0)} color="text-amber-400" />
              <Stat label="Closed" value={serviceBacklog.data.reduce((s, r) => s + r.closed_recent, 0)} color="text-emerald-400" />
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
                  <span className="text-red-400 tabular-nums">{r.overdue} overdue</span>
                  <span className="text-qep-orange tabular-nums">{r.active} active</span>
                  <span className="text-emerald-400 tabular-nums">{r.closed} closed</span>
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
