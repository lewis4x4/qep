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
    <div className="space-y-4 py-4 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service Command Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
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

      {showCronHealth && cronFetched && (
        <Card className="p-3 border-dashed">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent cron worker runs</p>
          {cronError && (
            <p className="text-xs text-destructive">
              {cronErr instanceof Error ? cronErr.message : "Could not load cron history"}
            </p>
          )}
          {!cronError && cronRuns.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No rows in <code className="text-[10px]">service_cron_runs</code> yet, or logging disabled via env.
            </p>
          ) : !cronError ? (
            <ul className="text-xs space-y-1 font-mono">
              {cronRuns.map((r: { job_name: string; started_at: string; ok: boolean; error: string | null }) => (
                <li key={`${r.job_name}-${r.started_at}`} className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <span className={r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                    {r.ok ? "ok" : "err"}
                  </span>
                  <span className="text-foreground">{r.job_name}</span>
                  <span className="text-muted-foreground">
                    {new Date(r.started_at).toLocaleString()}
                  </span>
                  {!r.ok && r.error && <span className="text-destructive truncate max-w-full">{r.error}</span>}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      )}

      {/* View tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b pb-px">
        {VIEWS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-t transition whitespace-nowrap ${
              view === key
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
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
