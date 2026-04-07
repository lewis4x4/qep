import { useServiceJob } from "../hooks/useServiceJobs";
import { useTransitionServiceJob } from "../hooks/useServiceJobMutation";
import { ServiceQuoteBuilder } from "./ServiceQuoteBuilder";
import { CompletionFeedbackForm } from "./CompletionFeedbackForm";
import { VoiceFieldNotes } from "./VoiceFieldNotes";
import { PartsRequirementEditor } from "./PartsRequirementEditor";
import { AskIronAdvisorButton } from "@/components/primitives";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import {
  acceptPartsIntakeLine,
  assignTechnicianToJob,
  SharedFulfillmentRunError,
  linkFulfillmentRunToJob,
  linkPortalRequestToJob,
  scanUpsell,
  searchPortalOrdersForJob,
  suggestCalendarSlots,
  suggestTechnicians,
  unlinkPortalRequestFromJob,
  updateServiceJob,
} from "../lib/api";
import {
  STAGE_LABELS,
  STAGE_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  ALLOWED_TRANSITIONS,
  BLOCKED_ALLOWED_FROM,
  STATUS_FLAG_LABELS,
} from "../lib/constants";
import type { ServiceStage } from "../lib/constants";
import { Link } from "react-router-dom";
import { getPublicServiceStatus } from "../lib/publicServiceStatus";
import { Check, Copy, X } from "lucide-react";

interface Props {
  jobId: string | null;
  onClose: () => void;
}

export function ServiceJobDetailDrawer({ jobId, onClose }: Props) {
  const qc = useQueryClient();
  const { data: job, isLoading } = useServiceJob(jobId ?? undefined);
  const transition = useTransitionServiceJob();
  const [portalRequestId, setPortalRequestId] = useState("");
  const [fulfillmentRunId, setFulfillmentRunId] = useState("");
  const [fulfillmentOrderSearch, setFulfillmentOrderSearch] = useState("");
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState("");
  const [schedStartLocal, setSchedStartLocal] = useState("");
  const [schedEndLocal, setSchedEndLocal] = useState("");
  const [copiedHint, setCopiedHint] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(fulfillmentOrderSearch.trim()), 350);
    return () => clearTimeout(t);
  }, [fulfillmentOrderSearch]);

  const fulfillmentOrderHits = useQuery({
    queryKey: ["portal-orders-fulfillment-search", job?.id, debouncedOrderSearch],
    queryFn: () => {
      if (!job?.id) throw new Error("No job");
      return searchPortalOrdersForJob(job.id, debouncedOrderSearch);
    },
    enabled: !!job?.id && debouncedOrderSearch.length >= 2,
  });

  useEffect(() => {
    if (!job) return;
    const s = job.scheduled_start_at;
    const e = job.scheduled_end_at;
    setSchedStartLocal(s ? s.slice(0, 16) : "");
    setSchedEndLocal(e ? e.slice(0, 16) : "");
    setFulfillmentRunId(job.fulfillment_run_id ?? "");
    setPortalRequestId(job.portal_request_id ?? job.portal_request?.id ?? "");
  }, [
    job?.id,
    job?.scheduled_start_at,
    job?.scheduled_end_at,
    job?.fulfillment_run_id,
    job?.portal_request_id,
    job?.portal_request?.id,
  ]);

  const upsell = useMutation({
    mutationFn: async () => {
      if (!job?.machine_id) throw new Error("No machine on job");
      return scanUpsell(job.machine_id, job.id);
    },
  });

  const sched = useMutation({
    mutationFn: async () => {
      if (!job?.id) throw new Error("No job");
      return suggestTechnicians(job.id);
    },
  });

  const linkPortal = useMutation({
    mutationFn: async () => {
      if (!job?.id) throw new Error("No job");
      return linkPortalRequestToJob(job.id, portalRequestId.trim());
    },
    onSuccess: () => {
      if (jobId) qc.invalidateQueries({ queryKey: ["service-job", jobId] });
    },
  });

  const unlinkPortal = useMutation({
    mutationFn: async () => {
      if (!job?.id) throw new Error("No job");
      return unlinkPortalRequestFromJob(job.id);
    },
    onSuccess: () => {
      if (jobId) qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      setPortalRequestId("");
    },
  });

  const linkFulfillment = useMutation({
    mutationFn: async (runId: string | null) => {
      if (!job?.id) throw new Error("No job");
      try {
        return await linkFulfillmentRunToJob(job.id, runId);
      } catch (e) {
        if (e instanceof SharedFulfillmentRunError) {
          const preview = e.otherJobIds
            .slice(0, 3)
            .map((id) => id.slice(0, 8) + "…")
            .join(", ");
          const more =
            e.otherJobIds.length > 3 ? ` (+${e.otherJobIds.length - 3} more)` : "";
          const ok = window.confirm(
            `${e.message}\n\nOther job(s): ${preview}${more}\n\nLink this job to the same shared fulfillment run?`,
          );
          if (ok) {
            return await linkFulfillmentRunToJob(job.id, runId, {
              acknowledgeSharedFulfillmentRun: true,
            });
          }
          throw new Error("Link cancelled");
        }
        throw e;
      }
    },
    onSuccess: () => {
      if (jobId) qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["portal-orders-fulfillment-search"] });
    },
  });

  const assignTech = useMutation({
    mutationFn: async (technicianUserId: string) => {
      if (!job?.id) throw new Error("No job");
      return assignTechnicianToJob(job.id, technicianUserId);
    },
    onSuccess: () => {
      if (jobId) qc.invalidateQueries({ queryKey: ["service-job", jobId] });
    },
  });

  const acceptIntake = useMutation({
    mutationFn: (requirementId: string) => acceptPartsIntakeLine(requirementId),
    onSuccess: () => {
      if (jobId) qc.invalidateQueries({ queryKey: ["service-job", jobId] });
    },
  });

  const loadSlots = useMutation({
    mutationFn: async () => {
      if (!job?.branch_id) throw new Error("Set branch on the job to load calendar slots");
      return suggestCalendarSlots({ branch_id: job.branch_id, count: 16 });
    },
  });

  const saveSchedule = useMutation({
    mutationFn: async () => {
      if (!job?.id) throw new Error("No job");
      return updateServiceJob(job.id, {
        scheduled_start_at: schedStartLocal
          ? new Date(schedStartLocal).toISOString()
          : null,
        scheduled_end_at: schedEndLocal
          ? new Date(schedEndLocal).toISOString()
          : null,
      });
    },
    onSuccess: () => {
      if (jobId) qc.invalidateQueries({ queryKey: ["service-job", jobId] });
    },
  });

  // Hooks must run unconditionally — never place useMemo/useCallback after `if (!jobId) return null`
  // or opening a job throws "Rendered more hooks than during the previous render".
  const stage = (job?.current_stage ?? "request_received") as ServiceStage;
  const publicPreview = useMemo(
    () => (job ? getPublicServiceStatus(job.current_stage) : null),
    [job?.current_stage],
  );
  const nextStages = useMemo(
    () => [
      ...(ALLOWED_TRANSITIONS[stage] ?? []),
      ...(BLOCKED_ALLOWED_FROM.has(stage) ? ["blocked_waiting"] : []),
    ],
    [stage],
  );

  if (!jobId) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-background border-l shadow-xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-2">
        <h2 className="text-lg font-semibold">Service Job Detail</h2>
        <div className="flex items-center gap-2">
          <AskIronAdvisorButton contextType="service_job" contextId={jobId} variant="inline" />
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {job && (
          <>
            {/* Stage + Priority */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_COLORS[stage]}`}>
                {STAGE_LABELS[stage]}
              </span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${PRIORITY_COLORS[job.priority]}`}>
                {PRIORITY_LABELS[job.priority]}
              </span>
              {job.status_flags?.map((flag) => (
                <span key={flag} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-muted text-muted-foreground">
                  {STATUS_FLAG_LABELS[flag] ?? flag}
                </span>
              ))}
            </div>

            {/* 1) Customer access — public track link (opaque token) */}
            <section className="space-y-2 rounded-lg border p-3 bg-muted/20">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Customer access
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Share the track link or token so the customer can see high-level status on the public{" "}
                <Link to="/service/track" className="text-primary underline-offset-2 hover:underline">
                  track page
                </Link>
                . This does not replace QRM customer/machine on the job — those are set below.
              </p>
              <div className="rounded-md border bg-background/50 p-2 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground mb-0.5">Customer preview</p>
                <p>{publicPreview?.headline}</p>
                <p className="mt-1">{publicPreview?.detail}</p>
              </div>
              <p className="text-xs font-mono break-all flex items-start gap-2">
                <span className="min-w-0 flex-1">Job ID: {job.id}</span>
                <button
                  type="button"
                  className="shrink-0 rounded border border-input px-1.5 py-0.5 hover:bg-muted"
                  title="Copy job ID"
                  onClick={() => {
                    void navigator.clipboard.writeText(job.id).then(() => {
                      setCopiedHint("job");
                      setTimeout(() => setCopiedHint(null), 2000);
                    });
                  }}
                >
                  {copiedHint === "job" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-mono break-all min-w-0 flex-1">
                  Token: {job.tracking_token ?? "—"}
                </p>
                {job.tracking_token ? (
                  <button
                    type="button"
                    className="shrink-0 rounded border border-input px-1.5 py-0.5 text-[11px] hover:bg-muted"
                    onClick={() => {
                      void navigator.clipboard.writeText(job.tracking_token!).then(() => {
                        setCopiedHint("token");
                        setTimeout(() => setCopiedHint(null), 2000);
                      });
                    }}
                  >
                    {copiedHint === "token" ? "Copied" : "Copy token"}
                  </button>
                ) : null}
              </div>
              {job.tracking_token ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/service/track?job_id=${encodeURIComponent(job.id)}&token=${encodeURIComponent(job.tracking_token)}`}
                    className="text-xs rounded bg-secondary px-2 py-1 w-fit"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open track page (customer view)
                  </Link>
                  <button
                    type="button"
                    className="text-xs rounded border border-input px-2 py-1"
                    onClick={() => {
                      const u = `${window.location.origin}/service/track?job_id=${encodeURIComponent(job.id)}&token=${encodeURIComponent(job.tracking_token!)}`;
                      void navigator.clipboard.writeText(u).then(() => {
                        setCopiedHint("link");
                        setTimeout(() => setCopiedHint(null), 2000);
                      });
                    }}
                  >
                    {copiedHint === "link" ? "Copied link" : "Copy track link"}
                  </button>
                </div>
              ) : null}
            </section>

            {/* 2) Portal request bridge — customer portal intake */}
            <section className="space-y-2 rounded-lg border p-3 bg-muted/15">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Portal request link
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Links this shop job to a customer portal <span className="font-mono">service_requests</span> row
                (intake from the portal). Use when the job was created from or should mirror portal intake.
              </p>
              {job.portal_request ? (
                <div className="rounded-md border bg-background/50 p-2 text-[11px] space-y-1">
                  <p>
                    <span className="font-medium text-foreground">Linked request</span>{" "}
                    <span className="font-mono break-all">{job.portal_request.id}</span>
                  </p>
                  <p className="text-muted-foreground">
                    Status: {job.portal_request.status} · Type: {job.portal_request.request_type} · Urgency:{" "}
                    {job.portal_request.urgency}
                  </p>
                  {job.portal_request.portal_customer ? (
                    <p className="text-muted-foreground">
                      Portal customer: {job.portal_request.portal_customer.first_name}{" "}
                      {job.portal_request.portal_customer.last_name} · {job.portal_request.portal_customer.email}
                    </p>
                  ) : null}
                  <p className="line-clamp-3 text-muted-foreground">{job.portal_request.description}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No portal request linked.</p>
              )}
              <div className="flex flex-col gap-2">
                <input
                  value={portalRequestId}
                  onChange={(e) => setPortalRequestId(e.target.value)}
                  placeholder="Portal service_request UUID"
                  className="text-xs rounded border px-2 py-1 font-mono"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={linkPortal.isPending || !portalRequestId.trim()}
                    onClick={() => linkPortal.mutate()}
                    className="text-xs rounded bg-secondary px-2 py-1 w-fit"
                  >
                    {linkPortal.isPending ? "Linking…" : "Link portal request"}
                  </button>
                  <button
                    type="button"
                    disabled={unlinkPortal.isPending || !job.portal_request_id}
                    onClick={() => unlinkPortal.mutate()}
                    className="text-xs rounded border border-input px-2 py-1"
                  >
                    {unlinkPortal.isPending ? "Unlinking…" : "Unlink portal request"}
                  </button>
                </div>
                {linkPortal.isError && (
                  <p className="text-xs text-destructive">{(linkPortal.error as Error).message}</p>
                )}
                {unlinkPortal.isError && (
                  <p className="text-xs text-destructive">{(unlinkPortal.error as Error).message}</p>
                )}
              </div>
            </section>

            {/* 3) Parts fulfillment bridge — shared run with portal/counter orders */}
            <section className="space-y-2 rounded-lg border p-3 bg-muted/10">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Parts fulfillment link
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Links this job to the same <span className="font-mono">parts_fulfillment_runs</span> record as a
                portal parts order so shop picks and shipping share one audit trail.
              </p>
              <p className="text-xs text-muted-foreground">
                Linked run:{" "}
                {job.fulfillment_run?.id ? (
                  <>
                    <span className="font-medium text-foreground">{job.fulfillment_run.status}</span>
                    {" · "}
                    <Link
                      to={`/service/fulfillment/${job.fulfillment_run.id}`}
                      className="font-mono break-all text-primary underline-offset-2 hover:underline"
                    >
                      {job.fulfillment_run.id}
                    </Link>
                  </>
                ) : job.fulfillment_run_id ? (
                  <Link
                    to={`/service/fulfillment/${job.fulfillment_run_id}`}
                    className="font-mono break-all text-primary underline-offset-2 hover:underline"
                  >
                    {job.fulfillment_run_id}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link
                  to="/service/portal-parts"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Open portal parts orders
                </Link>
                <Link
                  to={
                    job.fulfillment_run_id ?? job.fulfillment_run?.id
                      ? `/parts/fulfillment/${job.fulfillment_run_id ?? job.fulfillment_run?.id}`
                      : "/parts/orders"
                  }
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Open in Parts module
                </Link>
                <span className="text-muted-foreground">— search by order id, email, or name.</span>
              </div>
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Find portal order (this workspace)
                </label>
                <input
                  value={fulfillmentOrderSearch}
                  onChange={(e) => setFulfillmentOrderSearch(e.target.value)}
                  placeholder="Order UUID, customer email, or name (min 2 characters)"
                  className="text-xs rounded border px-2 py-1 bg-background"
                />
                {fulfillmentOrderHits.isFetching && (
                  <p className="text-[11px] text-muted-foreground">Searching…</p>
                )}
                {fulfillmentOrderHits.isError && (
                  <p className="text-[11px] text-destructive">
                    {(fulfillmentOrderHits.error as Error).message}
                  </p>
                )}
                {fulfillmentOrderHits.data && fulfillmentOrderHits.data.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto space-y-1.5 text-[11px]">
                    {fulfillmentOrderHits.data.map((o) => (
                      <li
                        key={o.id}
                        className="flex flex-col gap-1 rounded border border-border/60 bg-background p-2"
                      >
                        <span className="font-mono text-[10px] break-all">{o.id}</span>
                        <span className="text-muted-foreground">
                          {o.portal_customers
                            ? `${o.portal_customers.first_name} ${o.portal_customers.last_name} · ${o.portal_customers.email}`
                            : "—"}{" "}
                          · {o.status}
                        </span>
                        <span className="text-muted-foreground">
                          Run:{" "}
                          {o.fulfillment_run_id ? (
                            <Link
                              to={`/service/fulfillment/${o.fulfillment_run_id}`}
                              className="font-mono break-all text-primary underline-offset-2 hover:underline"
                            >
                              {o.fulfillment_run_id}
                            </Link>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400">
                              none — order needs a run (portal submit)
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={
                            linkFulfillment.isPending ||
                            !o.fulfillment_run_id ||
                            o.fulfillment_run_id === (job.fulfillment_run_id ?? job.fulfillment_run?.id)
                          }
                          onClick={() => {
                            if (o.fulfillment_run_id) {
                              setFulfillmentRunId(o.fulfillment_run_id);
                              linkFulfillment.mutate(o.fulfillment_run_id);
                            }
                          }}
                          className="w-fit rounded bg-secondary px-2 py-1 text-xs disabled:opacity-50"
                        >
                          {o.fulfillment_run_id
                            ? linkFulfillment.isPending
                              ? "Linking…"
                              : "Link shop job to this run"
                            : "Cannot link — no fulfillment run on order"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {debouncedOrderSearch.length >= 2 &&
                  fulfillmentOrderHits.data?.length === 0 &&
                  !fulfillmentOrderHits.isFetching &&
                  !fulfillmentOrderHits.isError && (
                    <p className="text-[11px] text-muted-foreground">No matching orders.</p>
                  )}
              </div>
              <p className="text-[11px] text-muted-foreground">Or paste run UUID manually:</p>
              <div className="flex flex-col gap-2">
                <input
                  value={fulfillmentRunId}
                  onChange={(e) => setFulfillmentRunId(e.target.value)}
                  placeholder="parts_fulfillment_runs UUID (from portal order)"
                  className="text-xs rounded border px-2 py-1 font-mono"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={linkFulfillment.isPending || !fulfillmentRunId.trim()}
                    onClick={() => linkFulfillment.mutate(fulfillmentRunId.trim())}
                    className="text-xs rounded bg-secondary px-2 py-1"
                  >
                    {linkFulfillment.isPending ? "Linking…" : "Link shop job to fulfillment run"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      linkFulfillment.isPending || !(job.fulfillment_run_id ?? job.fulfillment_run?.id)
                    }
                    onClick={() => linkFulfillment.mutate(null)}
                    className="text-xs rounded border border-input px-2 py-1"
                  >
                    Unlink
                  </button>
                </div>
                {linkFulfillment.isError && (
                  <p className="text-xs text-destructive">{(linkFulfillment.error as Error).message}</p>
                )}
              </div>
            </section>

            {/* Scheduling — branch business hours drive suggested slots */}
            <section className="space-y-2 rounded-lg border p-3 bg-muted/10">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Schedule</h3>
              <p className="text-xs text-muted-foreground">
                Branch: {job.branch_id ?? "—"} · Slots follow branch config (Service → Branch config).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs block">
                  Start
                  <input
                    type="datetime-local"
                    value={schedStartLocal}
                    onChange={(e) => setSchedStartLocal(e.target.value)}
                    className="mt-0.5 w-full rounded border px-2 py-1 text-sm bg-background"
                  />
                </label>
                <label className="text-xs block">
                  End
                  <input
                    type="datetime-local"
                    value={schedEndLocal}
                    onChange={(e) => setSchedEndLocal(e.target.value)}
                    className="mt-0.5 w-full rounded border px-2 py-1 text-sm bg-background"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-xs rounded bg-secondary px-2 py-1"
                  disabled={loadSlots.isPending || !job.branch_id}
                  onClick={() => loadSlots.mutate()}
                >
                  {loadSlots.isPending ? "Loading slots…" : "Suggest open slots"}
                </button>
                <button
                  type="button"
                  className="text-xs rounded bg-primary text-primary-foreground px-2 py-1"
                  disabled={saveSchedule.isPending}
                  onClick={() => saveSchedule.mutate()}
                >
                  {saveSchedule.isPending ? "Saving…" : "Save schedule"}
                </button>
              </div>
              {loadSlots.data?.slots && loadSlots.data.slots.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {loadSlots.data.slots.map((iso) => (
                    <button
                      key={iso}
                      type="button"
                      className="text-[10px] rounded border px-1.5 py-0.5 bg-card hover:bg-muted"
                      onClick={() => {
                        const start = iso.slice(0, 16);
                        setSchedStartLocal(start);
                        const endDate = new Date(iso);
                        endDate.setMinutes(endDate.getMinutes() + (loadSlots.data?.slot_minutes ?? 60));
                        setSchedEndLocal(endDate.toISOString().slice(0, 16));
                      }}
                    >
                      {new Date(iso).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </button>
                  ))}
                </div>
              )}
              {loadSlots.isError && (
                <p className="text-xs text-destructive">{(loadSlots.error as Error).message}</p>
              )}
              {saveSchedule.isError && (
                <p className="text-xs text-destructive">{(saveSchedule.error as Error).message}</p>
              )}
            </section>

            {/* Customer / Machine */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Customer &amp; Machine</h3>
              <div className="text-sm">
                <p><span className="font-medium">Customer:</span> {job.customer?.name ?? job.requested_by_name ?? "—"}</p>
                {job.contact && (
                  <p><span className="font-medium">Contact:</span> {job.contact.first_name} {job.contact.last_name} ({job.contact.phone})</p>
                )}
                <p>
                  <span className="font-medium">Machine:</span>{" "}
                  {job.machine ? `${job.machine.make} ${job.machine.model} (S/N: ${job.machine.serial_number})` : "—"}
                </p>
              </div>
            </section>

            {/* Problem */}
            {job.customer_problem_summary && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">Problem</h3>
                <p className="text-sm">{job.customer_problem_summary}</p>
              </section>
            )}

            {/* AI Diagnosis */}
            {job.ai_diagnosis_summary && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">AI Diagnosis</h3>
                <p className="text-sm">{job.ai_diagnosis_summary}</p>
              </section>
            )}

            <PartsRequirementEditor
              jobId={job.id}
              selectedJobCodeId={job.selected_job_code_id}
              parts={job.parts}
            />

            <section className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => upsell.mutate()}
                  disabled={!job.machine_id || upsell.isPending}
                  className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900"
                >
                  {upsell.isPending ? "Scanning…" : "PM / upsell scan"}
                </button>
                <button
                  type="button"
                  onClick={() => sched.mutate()}
                  disabled={sched.isPending}
                  className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-900"
                >
                  {sched.isPending ? "Ranking…" : "Suggest technicians"}
                </button>
              </div>
              {upsell.data && typeof upsell.data === "object" && upsell.data !== null && "recommendations" in upsell.data ? (
                <ul className="text-xs space-y-1 border rounded p-2 bg-muted/20">
                  {(upsell.data as { recommendations: Array<{ message: string }> }).recommendations.map((r, i) => (
                    <li key={i}>{r.message}</li>
                  ))}
                </ul>
              ) : null}
              {sched.data && typeof sched.data === "object" && sched.data !== null && "suggestions" in sched.data ? (
                <ul className="text-xs space-y-1 border rounded p-2 bg-muted/20">
                  {(sched.data as {
                    suggestions: Array<{ name: string; score: number; user_id: string }>;
                  }).suggestions.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span>{s.name} — score {s.score}</span>
                      <button
                        type="button"
                        className="shrink-0 rounded bg-primary/15 px-2 py-0.5 text-[10px]"
                        disabled={assignTech.isPending}
                        onClick={() => assignTech.mutate(s.user_id)}
                      >
                        Assign
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {assignTech.isError && (
                <p className="text-xs text-destructive">{(assignTech.error as Error).message}</p>
              )}
            </section>

            {/* Parts Status */}
            {job.parts && job.parts.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Parts ({job.parts.length})</h3>
                <div className="space-y-1">
                  {job.parts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start justify-between gap-2 text-sm border rounded px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {p.part_number} — {p.description ?? "No desc"}
                        </div>
                        {(p.intake_line_status || p.source) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {p.intake_line_status && (
                              <span className="uppercase tracking-wide">{p.intake_line_status}</span>
                            )}
                            {p.source && (
                              <span className={p.intake_line_status ? "ml-1" : ""}>· {p.source}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(p.intake_line_status ?? "accepted") === "suggested" && (
                          <button
                            type="button"
                            className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-900 dark:text-amber-100 hover:bg-amber-500/25"
                            disabled={acceptIntake.isPending}
                            onClick={() => acceptIntake.mutate(p.id)}
                          >
                            Accept
                          </button>
                        )}
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quote Status */}
            {job.quotes && job.quotes.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Quotes</h3>
                {job.quotes.map((q) => (
                  <div key={q.id} className="flex items-center justify-between text-sm border rounded px-2 py-1.5">
                    <span>v{q.version} — ${Number(q.total).toLocaleString()}</span>
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{q.status}</span>
                  </div>
                ))}
              </section>
            )}

            {/* Blockers */}
            {job.blockers && job.blockers.filter((b) => !b.resolved_at).length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-red-600 uppercase tracking-wide mb-2">Active Blockers</h3>
                {job.blockers.filter((b) => !b.resolved_at).map((b) => (
                  <div key={b.id} className="text-sm border border-red-200 bg-red-50 rounded px-2 py-1.5 mb-1">
                    <span className="font-medium">{b.blocker_type}</span>
                    {b.description && <span className="text-muted-foreground"> — {b.description}</span>}
                  </div>
                ))}
              </section>
            )}

            {/* Event Timeline */}
            {job.events && job.events.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Timeline</h3>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {[...job.events].reverse().map((e) => (
                    <div key={e.id} className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0 w-28">
                        {new Date(e.created_at).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                      <span className="font-medium">{e.event_type}</span>
                      {e.old_stage && e.new_stage && (
                        <span className="text-muted-foreground">
                          {STAGE_LABELS[e.old_stage as ServiceStage]} → {STAGE_LABELS[e.new_stage as ServiceStage]}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quote Builder — show when at diagnosis_selected or quote_drafted */}
            {(stage === "diagnosis_selected" || stage === "quote_drafted") && (
              <ServiceQuoteBuilder
                jobId={job.id}
                existingQuoteId={job.quotes?.[0]?.id}
              />
            )}

            {/* Field / voice notes during active repair */}
            {stage === "in_progress" && (
              <VoiceFieldNotes jobId={job.id} machineId={job.machine_id} />
            )}

            {/* Completion Feedback — show at quality_check stage */}
            {stage === "quality_check" && (
              <CompletionFeedbackForm jobId={job.id} />
            )}

            {/* Stage Transitions */}
            {nextStages.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Advance Stage</h3>
                <div className="flex flex-wrap gap-2">
                  {nextStages.map((s) => (
                    <button
                      key={s}
                      disabled={transition.isPending}
                      onClick={() => transition.mutate({ id: job.id, toStage: s })}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        s === "blocked_waiting"
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-primary/10 text-primary hover:bg-primary/20"
                      } disabled:opacity-50`}
                    >
                      → {STAGE_LABELS[s as ServiceStage] ?? s}
                    </button>
                  ))}
                </div>
                {transition.isError && (
                  <p className="text-xs text-destructive mt-1">
                    {(transition.error as Error)?.message ?? "Transition failed"}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
