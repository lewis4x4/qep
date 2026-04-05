import { useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useServiceJobList } from "../hooks/useServiceJobs";
import { ServiceJobCard } from "../components/ServiceJobCard";
import { ServiceJobDetailDrawer } from "../components/ServiceJobDetailDrawer";
import { ServiceCommandFilters } from "../components/ServiceCommandFilters";
import { ServiceKanbanBoard } from "../components/ServiceKanbanBoard";
import type { ServiceListFilters } from "../lib/types";
import {
  Plus,
  Layers,
  Table2,
  AlertOctagon,
  CalendarClock,
  Clock,
  Package,
  Receipt,
  Wrench,
  ShoppingCart,
  Truck,
  BarChart3,
  GitBranch,
  Boxes,
  Lightbulb,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ViewMode = "kanban" | "table" | "machine_down" | "today" | "delayed" | "parts_pending" | "invoice_ready";

const VIEWS: { key: ViewMode; label: string; icon: React.ElementType }[] = [
  { key: "kanban", label: "Kanban", icon: Layers },
  { key: "table", label: "Table", icon: Table2 },
  { key: "machine_down", label: "Machine Down", icon: AlertOctagon },
  { key: "today", label: "Today", icon: CalendarClock },
  { key: "delayed", label: "Delayed", icon: Clock },
  { key: "parts_pending", label: "Parts", icon: Package },
  { key: "invoice_ready", label: "Invoice", icon: Receipt },
];

const SUB_NAV_LINKS = [
  { to: "/service/parts", label: "Parts Queue", icon: Package },
  { to: "/service/portal-parts", label: "Portal Orders", icon: ShoppingCart },
  { to: "/service/vendors", label: "Vendors", icon: Truck },
  { to: "/service/efficiency", label: "Efficiency", icon: BarChart3 },
] as const;

const ADMIN_LINKS = [
  { to: "/service/branches", label: "Branches", icon: GitBranch },
  { to: "/service/inventory", label: "Inventory", icon: Boxes },
  { to: "/service/job-code-suggestions", label: "Job Codes", icon: Lightbulb },
] as const;

export function ServiceCommandCenterPage() {
  const { profile } = useAuth();
  const location = useLocation();
  const showCronHealth = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  const isAdmin = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  const [view, setView] = useState<ViewMode>("kanban");
  const [filters, setFilters] = useState<ServiceListFilters>({ per_page: 100 });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const queryFilters = useMemo<ServiceListFilters>(() => {
    const f = { ...filters };
    if (view === "machine_down") f.status_flag = "machine_down";
    if (view === "parts_pending") f.stage = "parts_pending";
    if (view === "invoice_ready") f.stage = "invoice_ready";
    return f;
  }, [filters, view]);

  const { data, isLoading } = useServiceJobList(queryFilters);
  const jobs = data?.jobs ?? [];

  const {
    data: cronRuns = [],
    isFetched: cronFetched,
    isError: cronError,
    error: cronErr,
  } = useQuery({
    queryKey: ["service-cron-runs"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("service_cron_runs")
        .select("job_name, started_at, ok, error")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return rows ?? [];
    },
    enabled: showCronHealth,
    staleTime: 45_000,
    retry: 1,
  });

  const filteredJobs = useMemo(() => {
    if (view === "today") {
      const todayStr = new Date().toISOString().slice(0, 10);
      return jobs.filter((j) => j.scheduled_start_at?.slice(0, 10) === todayStr);
    }
    return jobs;
  }, [jobs, view]);

  return (
    <div className="mx-auto max-w-[1920px] space-y-6 px-4 py-6 md:px-6 lg:px-8">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card via-card to-muted/30 p-6 shadow-sm dark:from-[hsl(222_38%_12%)] dark:via-[hsl(222_38%_11%)] dark:to-[hsl(222_47%_8%)] dark:border-white/[0.08]">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.04] via-transparent to-transparent pointer-events-none" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/15">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Service Command Center
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground/80">
                  {data?.total ?? 0}
                </span>{" "}
                active jobs across all stages
              </p>
            </div>
          </div>
          <Link
            to="/service/intake"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            New Request
          </Link>
        </div>

        {/* Sub-navigation pills */}
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          {SUB_NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                location.pathname === link.to
                  ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
              )}
            >
              <link.icon className="h-3.5 w-3.5" />
              {link.label}
            </Link>
          ))}
          {isAdmin && (
            <>
              <div className="mx-1 h-4 w-px bg-border/60 dark:bg-white/10" />
              {ADMIN_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    location.pathname === link.to
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
                  )}
                >
                  <link.icon className="h-3.5 w-3.5" />
                  {link.label}
                </Link>
              ))}
            </>
          )}
          <Link
            to="/service/track"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-all dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Track Job
          </Link>
        </div>
      </div>

      {showCronHealth && cronFetched && (cronError || cronRuns.length > 0) && (
        <Card className="overflow-hidden border-border/40 bg-muted/10 p-0 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="border-b border-border/40 bg-muted/20 px-4 py-2 dark:bg-white/[0.03]">
            <p className="text-xs font-semibold text-foreground">Cron Health</p>
          </div>
          <div className="px-4 py-3">
            {cronError && (
              <p className="text-xs text-destructive">
                {cronErr instanceof Error ? cronErr.message : "Could not load cron history"}
              </p>
            )}
            {!cronError && cronRuns.length > 0 ? (
              <ul className="space-y-1.5 font-mono text-[11px]">
                {cronRuns.map((r: { job_name: string; started_at: string; ok: boolean; error: string | null }) => (
                  <li
                    key={`${r.job_name}-${r.started_at}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/20 pb-1.5 last:border-0 last:pb-0 dark:border-white/[0.04]"
                  >
                    <span className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                      r.ok
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/15 text-red-600 dark:text-red-400"
                    )}>
                      {r.ok ? "\u2713" : "\u2717"}
                    </span>
                    <span className="text-foreground">{r.job_name}</span>
                    <span className="text-muted-foreground">
                      {new Date(r.started_at).toLocaleString()}
                    </span>
                    {!r.ok && r.error && (
                      <span className="w-full truncate text-destructive">{r.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
      )}

      {/* View tabs + filters row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/15 p-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                view === key
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/50 dark:bg-white/[0.08] dark:ring-white/[0.1]"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground dark:hover:bg-white/[0.05]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        <ServiceCommandFilters filters={filters} onChange={setFilters} />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <div className="h-10 w-10 rounded-full border-[3px] border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading jobs...</p>
        </div>
      ) : view === "kanban" ? (
        <ServiceKanbanBoard jobs={filteredJobs} onJobClick={setSelectedJobId} />
      ) : (
        <div className="space-y-2">
          {filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/50 py-16 dark:border-white/[0.08]">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 dark:bg-white/[0.05]">
                <Wrench className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No jobs match current filters</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredJobs.map((job) => (
                <ServiceJobCard
                  key={job.id}
                  job={job}
                  onClick={() => setSelectedJobId(job.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ServiceJobDetailDrawer
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
