import { STAGE_LABELS, type ServiceStage } from "./constants";
import type { ServiceJobWithRelations } from "./types";

export type TechnicianMobileFilter = "focus" | "today" | "active" | "machine_down" | "all";

export type TechnicianStageAction = {
  toStage: ServiceStage;
  label: string;
  tone: "primary" | "secondary";
};

type TechnicianStatSummary = {
  activeCount: number;
  todayCount: number;
  blockedCount: number;
  machineDownCount: number;
};

const ACTIVE_STAGES = new Set<ServiceStage>([
  "scheduled",
  "in_progress",
  "blocked_waiting",
  "quality_check",
]);

const TECHNICIAN_ACTIONS: Partial<Record<ServiceStage, TechnicianStageAction[]>> = {
  scheduled: [
    { toStage: "in_progress", label: "Start work", tone: "primary" },
  ],
  in_progress: [
    { toStage: "blocked_waiting", label: "Block / wait", tone: "secondary" },
    { toStage: "quality_check", label: "Send to QC", tone: "primary" },
  ],
  blocked_waiting: [
    { toStage: "in_progress", label: "Resume work", tone: "primary" },
  ],
  quality_check: [
    { toStage: "ready_for_pickup", label: "Ready for pickup", tone: "primary" },
  ],
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function scheduledStartMs(job: ServiceJobWithRelations): number {
  if (!job.scheduled_start_at) return Number.POSITIVE_INFINITY;
  const ms = new Date(job.scheduled_start_at).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function priorityWeight(job: ServiceJobWithRelations): number {
  switch (job.priority) {
    case "critical":
      return 3;
    case "urgent":
      return 2;
    default:
      return 1;
  }
}

export function isScheduledToday(job: ServiceJobWithRelations, now = new Date()): boolean {
  if (!job.scheduled_start_at) return false;
  const scheduled = new Date(job.scheduled_start_at);
  return scheduled >= startOfDay(now) && scheduled <= endOfDay(now);
}

export function isTechnicianActiveStage(stage: string): stage is ServiceStage {
  return ACTIVE_STAGES.has(stage as ServiceStage);
}

export function getTechnicianStageActions(stage: string): TechnicianStageAction[] {
  return TECHNICIAN_ACTIONS[stage as ServiceStage] ?? [];
}

export function getTechnicianJobSummary(job: ServiceJobWithRelations): string {
  const when = job.scheduled_start_at
    ? new Date(job.scheduled_start_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unscheduled";
  return `${STAGE_LABELS[job.current_stage as ServiceStage] ?? job.current_stage} · ${when}`;
}

export function getTechnicianNextMove(job: ServiceJobWithRelations): string {
  const actions = getTechnicianStageActions(job.current_stage);
  if (actions.length > 0) return actions[0].label;
  if (job.current_stage === "parts_pending") return "Waiting on parts";
  if (job.current_stage === "parts_staged") return "Ready to schedule";
  if (job.current_stage === "ready_for_pickup") return "Awaiting customer pickup";
  return "Monitor work order";
}

export function summarizeTechnicianJobs(
  jobs: ServiceJobWithRelations[],
  now = new Date(),
): TechnicianStatSummary {
  return jobs.reduce<TechnicianStatSummary>(
    (summary, job) => {
      if (isTechnicianActiveStage(job.current_stage)) summary.activeCount += 1;
      if (isScheduledToday(job, now)) summary.todayCount += 1;
      if (job.current_stage === "blocked_waiting") summary.blockedCount += 1;
      if (job.status_flags?.includes("machine_down")) summary.machineDownCount += 1;
      return summary;
    },
    {
      activeCount: 0,
      todayCount: 0,
      blockedCount: 0,
      machineDownCount: 0,
    },
  );
}

export function sortTechnicianJobs(
  jobs: ServiceJobWithRelations[],
  now = new Date(),
): ServiceJobWithRelations[] {
  const nowMs = now.getTime();
  return [...jobs].sort((a, b) => {
    const aActive = isTechnicianActiveStage(a.current_stage) ? 1 : 0;
    const bActive = isTechnicianActiveStage(b.current_stage) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;

    const aToday = isScheduledToday(a, now) ? 1 : 0;
    const bToday = isScheduledToday(b, now) ? 1 : 0;
    if (aToday !== bToday) return bToday - aToday;

    const aDown = a.status_flags?.includes("machine_down") ? 1 : 0;
    const bDown = b.status_flags?.includes("machine_down") ? 1 : 0;
    if (aDown !== bDown) return bDown - aDown;

    const aUpcoming = Math.abs(scheduledStartMs(a) - nowMs);
    const bUpcoming = Math.abs(scheduledStartMs(b) - nowMs);
    if (aUpcoming !== bUpcoming) return aUpcoming - bUpcoming;

    const aPriority = priorityWeight(a);
    const bPriority = priorityWeight(b);
    if (aPriority !== bPriority) return bPriority - aPriority;

    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function filterTechnicianJobs(
  jobs: ServiceJobWithRelations[],
  filter: TechnicianMobileFilter,
  now = new Date(),
): ServiceJobWithRelations[] {
  switch (filter) {
    case "focus":
      return jobs.filter((job) =>
        isTechnicianActiveStage(job.current_stage) ||
        isScheduledToday(job, now) ||
        job.status_flags?.includes("machine_down"),
      );
    case "today":
      return jobs.filter((job) => isScheduledToday(job, now));
    case "active":
      return jobs.filter((job) => isTechnicianActiveStage(job.current_stage));
    case "machine_down":
      return jobs.filter((job) => job.status_flags?.includes("machine_down"));
    default:
      return jobs;
  }
}

export function getPrimaryTechnicianJob(
  jobs: ServiceJobWithRelations[],
  now = new Date(),
): ServiceJobWithRelations | null {
  return sortTechnicianJobs(jobs, now)[0] ?? null;
}
