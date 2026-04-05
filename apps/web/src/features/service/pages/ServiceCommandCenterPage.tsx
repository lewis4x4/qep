import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useServiceJobList } from "../hooks/useServiceJobs";
import { ServiceJobCard } from "../components/ServiceJobCard";
import { ServiceJobDetailDrawer } from "../components/ServiceJobDetailDrawer";
import { ServiceCommandFilters } from "../components/ServiceCommandFilters";
import { ServiceKanbanBoard } from "../components/ServiceKanbanBoard";
import { STAGE_LABELS, STAGE_COLORS } from "../lib/constants";
import type { ServiceStage } from "../lib/constants";
import type { ServiceListFilters, ServiceJobWithRelations } from "../lib/types";
import { Plus } from "lucide-react";

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
        <Link
          to="/service/intake"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
        >
          <Plus className="w-4 h-4" />
          New Request
        </Link>
      </div>

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
