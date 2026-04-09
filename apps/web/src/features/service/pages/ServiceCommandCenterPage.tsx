import { useState, useMemo, useLayoutEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ServicePartsHubStrip } from "../components/ServicePartsHubStrip";
import { useServiceJobList } from "../hooks/useServiceJobs";
import { ServiceJobCard } from "../components/ServiceJobCard";
import { ServiceJobDetailDrawer } from "../components/ServiceJobDetailDrawer";
import { ServiceCommandFilters } from "../components/ServiceCommandFilters";
import { ServiceKanbanBoard } from "../components/ServiceKanbanBoard";
import { ServiceSubNav } from "../components/ServiceSubNav";
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
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { isUuid } from "@/lib/uuid";
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

export function ServiceCommandCenterPage() {
  const { profile } = useAuth();
  const showCronHealth = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>("kanban");
  const [filters, setFilters] = useState<ServiceListFilters>({ per_page: 100 });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const selectJob = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("highlight");
          next.set("job", id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearJobSelection = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("job");
        next.delete("highlight");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useLayoutEffect(() => {
    const raw =
      searchParams.get("job")?.trim() ?? searchParams.get("highlight")?.trim() ?? "";
    if (isUuid(raw)) {
      setSelectedJobId(raw);
      return;
    }
    if (raw) {
      setSelectedJobId(null);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("job");
          next.delete("highlight");
          return next;
        },
        { replace: true },
      );
      return;
    }
    setSelectedJobId(null);
  }, [searchParams, setSearchParams]);

  const queryFilters = useMemo<ServiceListFilters>(() => {
    const f = { ...filters };
    if (view === "machine_down") f.status_flag = "machine_down";
    if (view === "parts_pending") f.stage = "parts_pending";
    if (view === "invoice_ready") f.stage = "invoice_ready";
    return f;
  }, [filters, view]);

  const { data, isLoading } = useServiceJobList(queryFilters);
  const jobs = data?.jobs ?? [];

  const { data: partsJobPeek } = useQuery({
    queryKey: ["service-job-parts-peek", selectedJobId],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("service_jobs")
        .select("id, fulfillment_run_id")
        .eq("id", selectedJobId!)
        .single();
      if (error) throw error;
      return row as { id: string; fulfillment_run_id: string | null };
    },
    enabled: !!selectedJobId,
    staleTime: 15_000,
  });

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

        <div className="relative mt-5">
          <ServiceSubNav />
        </div>
      </div>

      {selectedJobId && partsJobPeek && (
        <ServicePartsHubStrip
          jobId={partsJobPeek.id}
          fulfillmentRunId={partsJobPeek.fulfillment_run_id}
        />
      )}

      {showCronHealth && cronFetched && (cronError || cronRuns.length > 0) && (
        <GlassPanel className="overflow-hidden p-0">
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
        </GlassPanel>
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
        <div
          className="flex flex-col items-center justify-center gap-3 py-24"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading jobs</span>
          <div
            className="h-10 w-10 rounded-full border-[3px] border-primary/30 border-t-primary animate-spin"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">Loading jobs...</p>
        </div>
      ) : view === "kanban" ? (
        <ServiceKanbanBoard jobs={filteredJobs} onJobClick={selectJob} />
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
                  onClick={() => selectJob(job.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ServiceJobDetailDrawer jobId={selectedJobId} onClose={clearJobSelection} />
    </div>
  );
}
