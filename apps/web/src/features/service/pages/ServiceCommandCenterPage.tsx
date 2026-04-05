import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useServiceJobList } from "../hooks/useServiceJobs";
import { ServiceJobCard } from "../components/ServiceJobCard";
import { ServiceJobDetailDrawer } from "../components/ServiceJobDetailDrawer";
import { ServiceCommandFilters } from "../components/ServiceCommandFilters";
import { ServiceKanbanBoard } from "../components/ServiceKanbanBoard";
import { STAGE_LABELS, STAGE_COLORS } from "../lib/constants";
import type { ServiceStage } from "../lib/constants";
import type { ServiceListFilters, ServiceJobWithRelations } from "../lib/types";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";

type ViewMode = "kanban" | "table" | "machine_down" | "today" | "delayed" | "parts_pending" | "invoice_ready";

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "kanban", label: "Kanban" },
  { key: "table", label: "Table" },
  { key: "machine_down", label: "Machine Down" },
  { key: "today", label: "Today's Starts" },
  { key: "delayed", label: "Delayed" },
  { key: "parts_pending", label: "Waiting on Parts" },
  { key: "invoice_ready", label: "Ready to Invoice" },
];

export function ServiceCommandCenterPage() {
  const { profile } = useAuth();
  const showCronHealth = ["admin", "manager", "owner"].includes(profile?.role ?? "");
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
    <div className="mx-auto max-w-[1920px] space-y-5 px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Service Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.total ?? 0} active service jobs
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/service/intake"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
          >
            <Plus className="w-4 h-4" />
            New Request
          </Link>
          <Link
            to="/service/parts"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Parts queue
          </Link>
          <Link
            to="/service/portal-parts"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Portal orders
          </Link>
          <Link
            to="/service/vendors"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Vendors
          </Link>
          <Link
            to="/service/efficiency"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Efficiency
          </Link>
          {["admin", "manager", "owner"].includes(profile?.role ?? "") && (
            <>
              <Link
                to="/service/branches"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Branch config
              </Link>
              <Link
                to="/service/inventory"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Inventory
              </Link>
              <Link
                to="/service/job-code-suggestions"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Job code suggestions
              </Link>
            </>
          )}
          <Link
            to="/service/track"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Track job (customer)
          </Link>
        </div>
      </div>

      {showCronHealth && cronFetched && (cronError || cronRuns.length > 0) && (
        <Card className="overflow-hidden border-border/60 bg-muted/15 p-0 shadow-sm">
          <div className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
            <p className="text-xs font-medium text-foreground">Cron worker health</p>
            <p className="text-[11px] text-muted-foreground">Recent runs (ops)</p>
          </div>
          <div className="px-4 py-3">
            {cronError && (
              <p className="text-xs text-destructive">
                {cronErr instanceof Error ? cronErr.message : "Could not load cron history"}
              </p>
            )}
            {!cronError && cronRuns.length > 0 ? (
              <ul className="space-y-2 font-mono text-[11px]">
                {cronRuns.map((r: { job_name: string; started_at: string; ok: boolean; error: string | null }) => (
                  <li
                    key={`${r.job_name}-${r.started_at}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/30 pb-2 last:border-0 last:pb-0"
                  >
                    <span className={r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                      {r.ok ? "ok" : "err"}
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

      {/* View tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/50 bg-muted/20 p-1 dark:bg-muted/10">
        {VIEWS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              view === key
                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <ServiceCommandFilters filters={filters} onChange={setFilters} />

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view === "kanban" ? (
        <ServiceKanbanBoard jobs={filteredJobs} onJobClick={setSelectedJobId} />
      ) : (
        <div className="space-y-2">
          {filteredJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12 italic">No jobs match current filters</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* Detail Drawer */}
      <ServiceJobDetailDrawer
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  );
}
