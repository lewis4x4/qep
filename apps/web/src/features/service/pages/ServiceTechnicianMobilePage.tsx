import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Clock3,
  RefreshCw,
  Smartphone,
  Upload,
  Wifi,
  WifiOff,
} from "lucide-react";
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
import { buildOfflineJobUpdateFields, createOfflineFieldStore, hasLegacyOfflineFieldWork } from "../lib/service-offline-field-mode";
import { fetchServiceMachineHistory } from "../lib/api";

function useFieldStore() {
  const { profile } = useAuth();
  return useMemo(() => createOfflineFieldStore({ userId: profile?.id ?? "", workspaceId: profile?.active_workspace_id ?? "" }), [profile?.id, profile?.active_workspace_id]);
}

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
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-qep-orange-accessible">
          {nextMove}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return isOnline;
}

function FieldOfflinePanel({
  job,
  isOnline,
  onSyncComplete,
}: {
  job: ServiceJobWithRelations;
  isOnline: boolean;
  onSyncComplete: () => void;
}) {
  const store = useFieldStore();
  const { drainOfflineFieldQueue, enqueueOfflineJobUpdate, enqueueOfflineSegmentPhoto, getOfflineFieldQueue } = store;
  const [activeClock, setActiveClock] = useState<{ sessionId: string; occurredAt: string; segmentId?: string | null } | null>(null);
  const [hourMeter, setHourMeter] = useState(job.hour_meter_reading?.toString() ?? "");
  const [complaint, setComplaint] = useState(job.complaint ?? "");
  const [cause, setCause] = useState(job.cause ?? "");
  const [correction, setCorrection] = useState(job.correction ?? "");
  const [photoPhase, setPhotoPhase] = useState<"before" | "during" | "after">("before");
  const [photoCategory, setPhotoCategory] = useState("hour_meter");
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingErrors, setPendingErrors] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const primarySegment = useMemo(
    () => job.segments?.find((segment) => segment.status !== "closed") ?? job.segments?.[0] ?? null,
    [job.segments],
  );

  useEffect(() => {
    setHourMeter(job.hour_meter_reading?.toString() ?? "");
    setComplaint(job.complaint ?? "");
    setCause(job.cause ?? "");
    setCorrection(job.correction ?? "");
    void store.getActiveClock(job.id).then(setActiveClock).catch(error => setStatusMessage(error instanceof Error ? error.message : "Clock recovery failed"));
  }, [
    job.id,
    job.hour_meter_reading,
    job.complaint,
    job.cause,
    job.correction,
    primarySegment?.id,
    primarySegment?.hours_actual,
  ]);

  useEffect(() => {
    let active = true;
    void getOfflineFieldQueue().then((queue) => {
      if (active) { setPendingCount(queue.length); setPendingErrors(queue.flatMap(action => action.lastError ? [action.lastError] : [])); }
    });
    return () => {
      active = false;
    };
  }, [job.id]);

  const syncQueuedActions = async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const result = await drainOfflineFieldQueue();
      const queue = await getOfflineFieldQueue();
      setPendingCount(queue.length);
      setPendingErrors(queue.flatMap(action => action.lastError ? [action.lastError] : []));
      onSyncComplete();
      if (result.retried > 0) {
        setStatusMessage(
          result.stillFailing > 0
            ? `${result.succeeded} synced, ${result.stillFailing} still queued.`
            : `${result.succeeded} field update${result.succeeded === 1 ? "" : "s"} synced.`,
        );
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Offline sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!isOnline) return;
    void syncQueuedActions();
    // syncQueuedActions intentionally depends on mutable form state only through queue storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const queueFieldPacket = async () => {
    try {
    const queued: string[] = [];
    const jobFields = buildOfflineJobUpdateFields({
      hourMeter,
      complaint,
      cause,
      correction,
    });
    const jobAction = await enqueueOfflineJobUpdate(job.id, jobFields, { hour_meter_reading: job.hour_meter_reading, complaint: job.complaint, cause: job.cause, correction: job.correction });
    if (jobAction) queued.push("work order");

    if (primarySegment) {
      if (photoFile) {
        const photoAction = await enqueueOfflineSegmentPhoto({
          workspaceId: job.workspace_id,
          serviceJobId: job.id,
          segmentId: primarySegment.id,
          phase: photoPhase,
          category: photoCategory,
          caption: photoCaption,
          file: photoFile,
        });
        if (photoAction) queued.push("photo");
      }
    }

    const queue = await getOfflineFieldQueue();
    setPendingCount(queue.length);

    if (queued.length === 0) {
      setStatusMessage("Add meter, three-C, labor, or photo detail before queueing.");
      return;
    }

    setStatusMessage(`${queued.length} field update${queued.length === 1 ? "" : "s"} queued.`);
    if (isOnline) await syncQueuedActions();
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Field packet was not saved. Keep this form open and retry."); }
  };
  const toggleClock = async () => {
    try {
      const occurredAt = new Date().toISOString();
      await store.enqueueOfflineFieldAction({ kind: activeClock ? "clock_stop" : "clock_start", jobId: job.id,
        sessionId: activeClock?.sessionId ?? crypto.randomUUID(), occurredAt, segmentId: activeClock?.segmentId ?? primarySegment?.id });
      setActiveClock(await store.getActiveClock(job.id));
      setPendingCount((await getOfflineFieldQueue()).length);
      setStatusMessage("Clock event saved on this device; pending synchronization.");
      if (isOnline) await syncQueuedActions();
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : "Clock was not saved. Retry."); }
  };

  return (
    <section className="rounded-[1.4rem] border border-border/50 bg-card/90 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Offline Field Packet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {primarySegment ? `Segment ${primarySegment.segment_number}` : "No service segment available"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            isOnline ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700",
          )}
        >
          {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {pendingCount}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Hour meter
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={hourMeter}
            onChange={(event) => setHourMeter(event.target.value)}
            className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground"
          />
        </label>

        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Complaint
          <textarea
            value={complaint}
            onChange={(event) => setComplaint(event.target.value)}
            rows={2}
            className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            Cause
            <textarea
              value={cause}
              onChange={(event) => setCause(event.target.value)}
              rows={2}
              className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            Correction
            <textarea
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              rows={2}
              className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground"
            />
          </label>
        </div>

        <div className="rounded-xl border p-3 space-y-2">
          <p className="text-sm font-semibold">Job clock</p>
          <p className="text-xs">{activeClock ? `Clocked on at ${new Date(activeClock.occurredAt).toLocaleString()}` : "No active clock on this job."}</p>
          <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void toggleClock()}>{activeClock ? "Clock off" : "Clock on"}</button>
          <p className="text-xs text-muted-foreground">Clock events survive refresh and reconnect. Synchronized clocks become work-order time evidence. Payroll and billable hours require their separate approval.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            Photo phase
            <select
              value={photoPhase}
              onChange={(event) => setPhotoPhase(event.target.value as "before" | "during" | "after")}
              disabled={!primarySegment}
              className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="before">Before</option>
              <option value="during">During</option>
              <option value="after">After</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            Photo category
            <select
              value={photoCategory}
              onChange={(event) => setPhotoCategory(event.target.value)}
              disabled={!primarySegment}
              className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="hour_meter">Hour meter</option>
              <option value="problem_area">Problem area</option>
              <option value="failed_component">Failed component</option>
              <option value="machine_condition">Machine condition</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={!primarySegment}
            onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
            className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Caption
          <input
            type="text"
            value={photoCaption}
            onChange={(event) => setPhotoCaption(event.target.value)}
            disabled={!primarySegment}
            className="rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void queueFieldPacket()}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background"
        >
          <Upload className="h-3.5 w-3.5" />
          Queue Packet
        </button>
        <button
          type="button"
          disabled={!isOnline || isSyncing || pendingCount === 0}
          onClick={() => void syncQueuedActions()}
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-4 py-2 text-xs font-semibold text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
          Sync
        </button>
      </div>

      {pendingErrors.length > 0 && <div role="alert" className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm">
        <p className="font-semibold">Queued work needs review</p>
        <ul className="list-disc pl-4">{Array.from(new Set(pendingErrors)).map(error => <li key={error}>{error}</li>)}</ul>
        <p>These packets remain saved. Reopen current work-order details and resolve conflicts with the service writer before retrying.</p>
      </div>}
      {statusMessage ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}

function TechnicianDetailSheet({
  jobId,
  onClose,
  transition,
}: {
  jobId: string;
  onClose: () => void;
  transition: ReturnType<typeof useTransitionServiceJob>;
}) {
  const queryClient = useQueryClient();
  const store = useFieldStore();
  const { getCachedOfflineJobSnapshot, cacheOfflineJobSnapshot } = store;
  const [history, setHistory] = useState<ServiceJobWithRelations[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  const { data: liveJob, isLoading } = useServiceJob(jobId);
  const [cachedJob, setCachedJob] = useState<ServiceJobWithRelations | null>(null);
  const job = liveJob ?? cachedJob;
  const showingCachedJob = !liveJob && !!cachedJob;
  const pendingForThisJob = transition.isPending && transition.variables?.id === jobId;

  useEffect(() => {
    const snapshot = getCachedOfflineJobSnapshot(jobId);
    setCachedJob(snapshot?.job ?? null);
    setHistory(snapshot?.history ?? []);
  }, [jobId, store]);

  useEffect(() => {
    if (!liveJob) return;
    cacheOfflineJobSnapshot(liveJob);
    setCachedJob(liveJob);
  }, [liveJob, store]);
  useEffect(() => {
    if (!isOnline || !liveJob?.machine_id) return;
    let active = true;
    void fetchServiceMachineHistory(liveJob.id).then(rows => {
      if (!active) return;
      cacheOfflineJobSnapshot(liveJob, rows);
      setHistory(rows); setHistoryError(null);
    }).catch(error => { if (active) setHistoryError(error instanceof Error ? error.message : "History could not be cached"); });
    return () => { active = false; };
  }, [liveJob, isOnline, store]);

  const actions = useMemo(
    () => (job ? getTechnicianStageActions(job.current_stage) : []),
    [job],
  );

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open && !pendingForThisJob) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-[70] bg-background/95 outline-none backdrop-blur-sm">
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-border/50 bg-background/95 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Technician Work Order
              </p>
              <DialogPrimitive.Title className="mt-1 text-lg font-semibold text-foreground">
                {job?.customer?.name ?? job?.requested_by_name ?? "Loading job"}
              </DialogPrimitive.Title>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={pendingForThisJob}
              aria-disabled={pendingForThisJob}
              className={cn(
                "rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground",
                pendingForThisJob && "cursor-not-allowed opacity-60",
              )}
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
              {showingCachedJob ? (
                <section className="rounded-[1.4rem] border border-amber-500/20 bg-amber-500/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Offline snapshot</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Updates queue locally and sync when this device comes back online.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}

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

              <section
                className="rounded-[1.4rem] border border-border/50 bg-card/90 p-4"
                aria-busy={pendingForThisJob}
              >
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
                        disabled={pendingForThisJob}
                        aria-disabled={pendingForThisJob}
                        onClick={() => {
                          if (pendingForThisJob) return;
                          transition.mutate({
                            id: job.id,
                            toStage: action.toStage,
                          });
                        }}
                        className={cn(
                          "rounded-2xl px-4 py-3 text-left text-sm font-semibold transition",
                          pendingForThisJob && "cursor-not-allowed opacity-70",
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
                {pendingForThisJob && (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    Sending update — keep this screen open. Actions stay locked to prevent duplicate stage transitions.
                  </p>
                )}
                {transition.isError && (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    Update did not save. Check signal and retry; no stage transition is recorded until service confirms
                    the change. {(transition.error as Error).message}
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
                    className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-qep-orange-accessible"
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

              <FieldOfflinePanel
                job={job}
                isOnline={isOnline}
                onSyncComplete={() => {
                  queryClient.invalidateQueries({ queryKey: ["service-jobs"] });
                  queryClient.invalidateQueries({ queryKey: ["service-job", job.id] });
                }}
              />

              <section className="rounded-xl border p-3 space-y-2">
                <h3 className="font-semibold">Machine service history {isOnline ? "" : "(saved on device)"}</h3>
                {historyError && <p role="alert" className="text-sm text-destructive">{historyError}</p>}
                {history.length === 0 && <p className="text-sm">No history saved. Open this machine while online to prepare it for field use.</p>}
                {history.map(item => <article key={item.id} className="border-t pt-2 text-sm"><p>{new Date(item.created_at).toLocaleDateString()} · {item.current_stage}</p><p>Complaint: {item.complaint ?? item.customer_problem_summary ?? "Not recorded"}</p><p>Cause: {item.cause ?? "Not recorded"}</p><p>Correction: {item.correction ?? "Not recorded"}</p></article>)}
              </section>
              <VoiceFieldNotes jobId={job.id} machineId={job.machine_id} />
            </div>
          )}
        </div>
      </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ServiceTechnicianMobilePage() {
  const { profile } = useAuth();
  const store = useFieldStore();
  const { listCachedOfflineJobSnapshots, cacheOfflineJobSnapshot } = store;
  const isOnline = useOnlineStatus();
  const [filter, setFilter] = useState<TechnicianMobileFilter>("focus");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [cachedJobs, setCachedJobs] = useState<ServiceJobWithRelations[]>([]);
  const transition = useTransitionServiceJob();

  const listQuery = useServiceJobList({
    technician_id: profile?.id ?? undefined,
    per_page: 50,
    include_closed: false,
  });

  const sortedJobs = useMemo(
    () => sortTechnicianJobs(listQuery.data?.jobs ?? []),
    [listQuery.data?.jobs],
  );
  useEffect(() => {
    setSelectedJobId(null);
    setCachedJobs(listCachedOfflineJobSnapshots().map((snapshot) => snapshot.job));
  }, [store]);
  useEffect(() => {
    if (sortedJobs.length === 0) return;
    for (const job of sortedJobs) cacheOfflineJobSnapshot(job);
    setCachedJobs(listCachedOfflineJobSnapshots().map((snapshot) => snapshot.job));
  }, [sortedJobs, store]);
  const agendaJobs = isOnline ? sortedJobs : cachedJobs;
  const isUsingCachedAgenda = !isOnline && cachedJobs.length > 0;
  const visibleJobs = useMemo(
    () => filterTechnicianJobs(agendaJobs, filter),
    [agendaJobs, filter],
  );
  const stats = useMemo(
    () => summarizeTechnicianJobs(agendaJobs),
    [agendaJobs],
  );
  const primaryJob = useMemo(
    () => getPrimaryTechnicianJob(agendaJobs),
    [agendaJobs],
  );

  const firstName = profile?.full_name?.split(" ")[0] ?? "Technician";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f4f0e6,transparent_38%),linear-gradient(180deg,#fcfbf7_0%,#f3f1ea_100%)] px-4 pb-24 pt-5 text-foreground dark:bg-[radial-gradient(circle_at_top,#172033,transparent_32%),linear-gradient(180deg,#09101c_0%,#0c1522_100%)]">
      <div className="mx-auto max-w-md space-y-4">
        {hasLegacyOfflineFieldWork() && <p role="alert" className="rounded-lg border border-amber-500/40 p-3 text-sm">Offline work from an earlier version is retained on this device without a verified operator. A supervisor must recover it; it will not be submitted under your account.</p>}
        <div className="flex items-center justify-between">
          <Link
            to="/service"
            className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Command Center
          </Link>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-qep-orange-accessible">
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
            <div className="rounded-2xl bg-primary/10 p-3 text-qep-orange-accessible">
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

        <section
          className={cn(
            "rounded-[1.5rem] border p-3",
            isOnline
              ? "border-emerald-500/20 bg-emerald-500/[0.06]"
              : "border-amber-500/20 bg-amber-500/[0.06]",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {isOnline ? (
                <Wifi className="h-4 w-4 shrink-0 text-emerald-700" />
              ) : (
                <WifiOff className="h-4 w-4 shrink-0 text-amber-700" />
              )}
              <p className="truncate text-sm font-semibold text-foreground">
                {isUsingCachedAgenda ? "Saved agenda" : isOnline ? "Online" : "Offline"}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-background/80 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {cachedJobs.length} saved
            </span>
          </div>
        </section>

        {primaryJob ? (
          <section className="rounded-[1.75rem] border border-primary/20 bg-primary/[0.08] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-qep-orange-accessible">
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

          {listQuery.isLoading && visibleJobs.length === 0 ? (
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
        <TechnicianDetailSheet
          key={`${profile?.id}:${profile?.active_workspace_id}:${selectedJobId}`}
          jobId={selectedJobId}
          onClose={() => {
            if (transition.isPending && transition.variables?.id === selectedJobId) return;
            setSelectedJobId(null);
          }}
          transition={transition}
        />
      ) : null}
    </div>
  );
}
