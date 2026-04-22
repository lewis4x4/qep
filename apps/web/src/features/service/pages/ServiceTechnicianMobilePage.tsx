import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronRight, Clock3, Smartphone, Wrench } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useServiceJob } from "../hooks/useServiceJobs";
import { useServiceJobList } from "../hooks/useServiceJobs";
import { useTransitionServiceJob } from "../hooks/useServiceJobMutation";
import {
  STAGE_COLORS,
  STAGE_LABELS,
  STATUS_FLAG_LABELS,
  type ServiceStage,
} from "../lib/constants";
import type { ServiceJobWithRelations } from "../lib/types";
import {
  filterTechnicianJobs,
  getPrimaryTechnicianJob,
  getTechnicianNextMove,
  getTechnicianStageActions,
  summarizeTechnicianJobs,
  sortTechnicianJobs,
  type TechnicianMobileFilter,
} from "../lib/mobile-tech-utils";
import { VoiceFieldNotes } from "../components/VoiceFieldNotes";

const FILTERS: Array<{ key: TechnicianMobileFilter; label: string }> = [
  { key: "focus", label: "Focus" },
  { key: "today", label: "Today" },
  { key: "active", label: "Active" },
  { key: "machine_down", label: "Machine Down" },
  { key: "all", label: "All" },
];

function formatScheduleWindow(job: ServiceJobWithRelations): string {
  if (!job.scheduled_start_at) return "Unscheduled";
  const start = new Date(job.scheduled_start_at);
  const end = job.scheduled_end_at ? new Date(job.scheduled_end_at) : null;
  const startLabel = start.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (!end) return startLabel;
  const endLabel = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startLabel} - ${endLabel}`;
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3 shadow-sm",
        tone === "danger" && "border-red-500/20 bg-red-500/[0.06]",
        tone === "warning" && "border-amber-500/20 bg-amber-500/[0.06]",
        tone === "default" && "border-border/50 bg-card/80",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function TechnicianJobListCard({
  job,
  onOpen,
}: {
  job: ServiceJobWithRelations;
  onOpen: () => void;
}) {
  const customerName = job.customer?.name ?? job.requested_by_name ?? "Unassigned customer";
  const machineLabel = job.machine
    ? `${job.machine.make} ${job.machine.model}`
    : "Machine not linked";
  const machineDown = job.status_flags?.includes("machine_down");
  const nextMove = getTechnicianNextMove(job);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-[1.4rem] border p-4 text-left transition",
        "bg-card/90 shadow-sm hover:-translate-y-px hover:border-primary/25 hover:shadow-md",
        machineDown && "border-red-500/25 bg-red-500/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{customerName}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{machineLabel}</p>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold",
          STAGE_COLORS[job.current_stage as ServiceStage] ?? "bg-muted text-muted-foreground",
        )}>
          {STAGE_LABELS[job.current_stage as ServiceStage] ?? job.current_stage}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        <span>{formatScheduleWindow(job)}</span>
      </div>

      {job.customer_problem_summary ? (
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {job.customer_problem_summary}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {job.status_flags?.slice(0, 2).map((flag) => (
            <span key={flag} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              {STATUS_FLAG_LABELS[flag] ?? flag}
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
          {nextMove}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

function TechnicianDetailSheet({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { data: job, isLoading } = useServiceJob(jobId);
  const transition = useTransitionServiceJob();

  const actions = useMemo(
    () => (job ? getTechnicianStageActions(job.current_stage) : []),
    [job],
  );

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-border/50 bg-background/95 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Technician Work Order
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                {job?.customer?.name ?? job?.requested_by_name ?? "Loading job"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading || !job ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-[1.4rem] border border-border/50 bg-card/90 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                    STAGE_COLORS[job.current_stage as ServiceStage] ?? "bg-muted text-muted-foreground",
                  )}>
                    {STAGE_LABELS[job.current_stage as ServiceStage] ?? job.current_stage}
                  </span>
                  {job.status_flags?.map((flag) => (
                    <span key={flag} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                      {STATUS_FLAG_LABELS[flag] ?? flag}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">
                  {job.machine
                    ? `${job.machine.make} ${job.machine.model} · ${job.machine.serial_number}`
                    : "Machine not linked"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatScheduleWindow(job)}
                </p>
                {job.customer_problem_summary ? (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {job.customer_problem_summary}
                  </p>
                ) : null}
              </section>

              <section className="rounded-[1.4rem] border border-border/50 bg-card/90 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Quick actions
                </p>
                {actions.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No technician transition is available from this stage.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2">
                    {actions.map((action) => (
                      <button
                        key={action.toStage}
                        type="button"
                        disabled={transition.isPending}
                        onClick={() =>
                          transition.mutate({
                            id: job.id,
                            toStage: action.toStage,
                          })
                        }
                        className={cn(
                          "rounded-2xl px-4 py-3 text-left text-sm font-semibold transition",
                          action.tone === "primary"
                            ? "bg-primary text-primary-foreground"
                            : "border border-border/60 bg-background text-foreground",
                        )}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
                {transition.isError && (
                  <p className="mt-2 text-xs text-destructive">
                    {(transition.error as Error).message}
                  </p>
                )}
              </section>

              <section className="rounded-[1.4rem] border border-border/50 bg-card/90 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Work order snapshot
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Branch</dt>
                    <dd className="text-right text-foreground">{job.branch_id ?? "Unassigned"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Shop / field</dt>
                    <dd className="text-right text-foreground capitalize">{job.shop_or_field}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Parts lines</dt>
                    <dd className="text-right text-foreground">{job.parts?.length ?? 0}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Quote status</dt>
                    <dd className="text-right text-foreground">{job.latest_quote?.[0]?.status ?? job.quotes?.[0]?.status ?? "None"}</dd>
                  </div>
                </dl>
                {job.machine?.id ? (
                  <Link
                    to={`/equipment/${job.machine.id}`}
                    className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                  >
                    Open Asset 360
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </section>

              <section className="rounded-[1.4rem] border border-border/50 bg-card/90 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Parts watch
                </p>
                {job.parts && job.parts.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {job.parts.slice(0, 5).map((part) => (
                      <div key={part.id} className="rounded-2xl border border-border/40 bg-background/60 p-3">
                        <p className="text-sm font-medium text-foreground">{part.part_number}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {part.description ?? "No description"} · Qty {part.quantity} · {part.status}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No parts staged against this work order.</p>
                )}
              </section>

              <VoiceFieldNotes jobId={job.id} machineId={job.machine_id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ServiceTechnicianMobilePage() {
  const { profile } = useAuth();
  const [filter, setFilter] = useState<TechnicianMobileFilter>("focus");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const listQuery = useServiceJobList({
    technician_id: profile?.id ?? undefined,
    per_page: 50,
    include_closed: false,
  });

  const sortedJobs = useMemo(
    () => sortTechnicianJobs(listQuery.data?.jobs ?? []),
    [listQuery.data?.jobs],
  );
  const visibleJobs = useMemo(
    () => filterTechnicianJobs(sortedJobs, filter),
    [filter, sortedJobs],
  );
  const stats = useMemo(
    () => summarizeTechnicianJobs(sortedJobs),
    [sortedJobs],
  );
  const primaryJob = useMemo(
    () => getPrimaryTechnicianJob(sortedJobs),
    [sortedJobs],
  );

  const firstName = profile?.full_name?.split(" ")[0] ?? "Technician";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f4f0e6,transparent_38%),linear-gradient(180deg,#fcfbf7_0%,#f3f1ea_100%)] px-4 pb-24 pt-5 text-foreground dark:bg-[radial-gradient(circle_at_top,#172033,transparent_32%),linear-gradient(180deg,#09101c_0%,#0c1522_100%)]">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <Link
            to="/service"
            className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Command Center
          </Link>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Mobile Tech
          </span>
        </div>

        <section className="overflow-hidden rounded-[1.75rem] border border-border/50 bg-card/90 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Service Technician Workspace
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {firstName}, here is your board.
              </h1>
              <p className="mt-2 max-w-[22rem] text-sm leading-relaxed text-muted-foreground">
                A mobile-first queue for scheduled work orders, active repairs, and machine-down interrupts.
              </p>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricTile label="Active" value={stats.activeCount} tone="default" />
            <MetricTile label="Today" value={stats.todayCount} tone="default" />
            <MetricTile label="Blocked" value={stats.blockedCount} tone="warning" />
            <MetricTile label="Machine Down" value={stats.machineDownCount} tone="danger" />
          </div>
        </section>

        {primaryJob ? (
          <section className="rounded-[1.75rem] border border-primary/20 bg-primary/[0.08] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
                  Next best move
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-foreground">
                  {primaryJob.customer?.name ?? primaryJob.requested_by_name ?? "Service job"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getTechnicianNextMove(primaryJob)} · {formatScheduleWindow(primaryJob)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJobId(primaryJob.id)}
                className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
              >
                Open
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        ) : null}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                "shrink-0 rounded-full px-3 py-2 text-xs font-semibold transition",
                filter === option.key
                  ? "bg-foreground text-background"
                  : "border border-border/50 bg-background/70 text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Technician agenda
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Assigned work orders ordered by urgency, schedule, and machine-down impact.
              </p>
            </div>
            <span className="rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {visibleJobs.length}
            </span>
          </div>

          {listQuery.isLoading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : visibleJobs.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-border/60 bg-card/70 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
                <Clock3 className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-foreground">No assigned work orders in this lane</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Dispatch can assign a new job from the main Service Command Center when the technician queue is empty.
              </p>
            </div>
          ) : (
            visibleJobs.map((job) => (
              <TechnicianJobListCard
                key={job.id}
                job={job}
                onOpen={() => setSelectedJobId(job.id)}
              />
            ))
          )}
        </section>

        <section className="rounded-[1.5rem] border border-border/50 bg-card/80 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Field validation still required</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                This slice closes the mobile service workspace and repo-side validation. Real technician UAT in the field is still a manual acceptance step.
              </p>
            </div>
          </div>
        </section>
      </div>

      {selectedJobId ? (
        <TechnicianDetailSheet jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
      ) : null}
    </div>
  );
}
