import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acknowledgeSegmentOverrun,
  assembleWarrantyClaim,
  linkServiceComeback,
  listServiceLinePayers,
  listWarrantyClaimsForJob,
  reviewSegmentDiagnosis,
  reviewServiceDocumentation,
  setServiceLinePayer,
  signOffSegmentRepair,
  submitSegmentDiagnosis,
  updateWarrantyClaimStatus,
  uploadAndRecordSegmentPhoto,
} from "../lib/api";
import {
  evaluateH3EstimateGate,
  evaluateH5CloseGate,
  H8_PAYER_LABELS,
  H8_PAYER_TYPES,
  H8_WARRANTY_STATUS_FLOW,
  shouldBlockStageTransition,
} from "../lib/service-wo-gates";
import type {
  H8LinePayerRow,
  H8PayerType,
  H8WarrantyClaimStatus,
  ServiceJobSegment,
  ServiceJobWithRelations,
} from "../lib/types";

interface Props {
  job: ServiceJobWithRelations;
  role: string;
}

const MUTATION_ROLES = new Set(["rep", "admin", "manager", "owner", "service_writer", "dispatch"]);
const FINANCE_ROLES = new Set(["finance_admin", "admin", "manager", "owner", "service_writer"]);
const PHOTO_CATEGORIES = ["overall_condition", "hour_meter", "problem_area", "fluids", "failed_components", "fault_codes", "other"];

export function ServiceWorkOrderGatePanels({ job, role }: Props) {
  const qc = useQueryClient();
  const canOperate = MUTATION_ROLES.has(role);
  const canExecute = canOperate || role === "technician";
  const canFinance = FINANCE_ROLES.has(role);
  const canReview = canOperate;
  const h3Gate = useMemo(() => evaluateH3EstimateGate(job), [job]);
  const h5Gate = useMemo(() => evaluateH5CloseGate(job, true), [job]);
  const h5SegmentGate = useMemo(() => evaluateH5CloseGate(job, false), [job]);
  const workStartBlock = useMemo(() => shouldBlockStageTransition(job, "in_progress"), [job]);
  const invoiceBlock = useMemo(() => shouldBlockStageTransition(job, "invoice_ready"), [job]);

  const invalidateJob = () => {
    qc.invalidateQueries({ queryKey: ["service-job", job.id] });
    qc.invalidateQueries({ queryKey: ["service-jobs"] });
  };

  return (
    <div className="space-y-4" data-testid="service-wo-gate-panels">
      <IntakeGatePanel job={job} />
      <ApprovalGatePanel gate={h3Gate} job={job} workStartBlocked={Boolean(workStartBlock)} />
      <ExecutionGatePanel
        job={job}
        gate={h5Gate}
        segmentGate={h5SegmentGate}
        invoiceBlocked={Boolean(invoiceBlock)}
        canExecute={canExecute}
        canReview={canReview}
        onChanged={invalidateJob}
      />
      <WarrantyGatePanel
        job={job}
        canFinance={canFinance}
        canOperate={canOperate}
        onChanged={invalidateJob}
      />
    </div>
  );
}

function IntakeGatePanel({ job }: { job: ServiceJobWithRelations }) {
  const fieldItems: Array<[string, string | null]> = [
    ["Type", job.request_type],
    ["Channel", job.source_type],
    ["Priority", job.priority],
    ["Promised", job.promised_at ? formatDate(job.promised_at) : null],
    ["Hour meter", numberOrDash(job.hour_meter_reading)],
    ["Miles", numberOrDash(job.odometer_miles)],
  ];
  const missing: string[] = [
    ["Hour meter", job.hour_meter_reading],
    ["Complaint", job.complaint],
    ["Cause", job.cause],
    ["Correction", job.correction],
    ["Promised date", job.promised_at],
  ].flatMap(([label, value]) => value == null || value === "" ? [String(label)] : []);

  return (
    <section className="rounded-xl border border-border/70 bg-card p-3 space-y-3">
      <GateHeader eyebrow="H2 intake" title="Complete work-order header" ok={missing.length === 0} />
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {fieldItems.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-background/60 p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 font-medium break-words">{value ?? "—"}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <ThreeC label="Complaint" value={job.complaint ?? job.customer_problem_summary} />
        <ThreeC label="Cause" value={job.cause} />
        <ThreeC label="Correction" value={job.correction} />
      </div>
      {job.shop_or_field === "field" ? (
        <div className="rounded-lg border bg-muted/30 p-2 text-xs">
          <p className="font-medium">Field-site details</p>
          <p className="mt-1 text-muted-foreground">
            {job.field_site_location ?? "No location"} · {job.field_site_contact_name ?? "No contact"} · {job.field_site_contact_phone ?? "No phone"}
          </p>
          <p className="mt-1 text-muted-foreground">{job.field_site_conditions_access_notes ?? "No site/access notes"}</p>
        </div>
      ) : null}
      {missing.length > 0 ? <MissingList items={missing} prefix="Legacy/header gap" /> : null}
    </section>
  );
}

function ApprovalGatePanel({ gate, job, workStartBlocked }: { gate: ReturnType<typeof evaluateH3EstimateGate>; job: ServiceJobWithRelations; workStartBlocked: boolean }) {
  const approved = formatCurrency(job.approved_estimate_amount);
  const current = formatCurrency(job.quote_total);
  const thresholdPct = job.estimate_reauth_threshold_pct ?? 10;
  const threshold = typeof job.approved_estimate_amount === "number"
    ? formatCurrency(job.approved_estimate_amount * (1 + thresholdPct / 100))
    : "—";
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3 space-y-3">
      <GateHeader eyebrow="H3 approval" title={gate.title} ok={gate.ok} />
      <p className="text-xs text-muted-foreground">{gate.reason}</p>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Metric label="Status" value={job.estimate_authorization_status ?? "pending"} />
        <Metric label="Approved" value={approved} />
        <Metric label="Current scope" value={current} />
        <Metric label={`${thresholdPct}% threshold`} value={threshold} />
      </div>
      {workStartBlocked ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-200">
          No approval = no repair. Start-work and technician clock-on are blocked until this gate clears.
        </div>
      ) : null}
    </section>
  );
}

function ExecutionGatePanel({
  job,
  gate,
  segmentGate,
  invoiceBlocked,
  canExecute,
  canReview,
  onChanged,
}: {
  job: ServiceJobWithRelations;
  gate: ReturnType<typeof evaluateH5CloseGate>;
  segmentGate: ReturnType<typeof evaluateH5CloseGate>;
  invoiceBlocked: boolean;
  canExecute: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [reviewNotes, setReviewNotes] = useState("");
  const reviewMutation = useMutation({
    mutationFn: (decision: "approve" | "return") => reviewServiceDocumentation({
      job_id: job.id,
      decision,
      notes: reviewNotes,
      return_reason: reviewNotes,
    }),
    onSuccess: onChanged,
  });

  return (
    <section className="rounded-xl border border-border/70 bg-card p-3 space-y-3">
      <GateHeader eyebrow="H5 execution / QC" title={gate.title} ok={gate.ok} />
      <p className="text-xs text-muted-foreground">{gate.reason}</p>
      {invoiceBlocked ? <MissingList items={gate.missing.slice(0, 8)} prefix="Close blocked" /> : null}
      <div className="space-y-2">
        {(job.segments ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            No job segments yet. Add/assign segments in the service workflow before documentation review.
          </div>
        ) : (
          (job.segments ?? []).map((segment) => (
            <SegmentExecutionCard
              key={segment.id}
              job={job}
              segment={segment}
              canExecute={canExecute}
              canReview={canReview}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
      <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
        <p className="text-xs font-medium">Service Advisor documentation review</p>
        <p className="text-[11px] text-muted-foreground">
          Segment gate: {segmentGate.ok ? "ready for advisor approval" : "waiting on segment documentation"}. Job review: {job.documentation_review_status ?? "pending"}.
        </p>
        <textarea
          value={reviewNotes}
          onChange={(event) => setReviewNotes(event.target.value)}
          rows={2}
          placeholder="Approval notes or return reason"
          className="w-full rounded border bg-background px-2 py-1 text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canReview || !segmentGate.ok || reviewMutation.isPending}
            onClick={() => reviewMutation.mutate("approve")}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            Approve QC documentation
          </button>
          <button
            type="button"
            disabled={!canReview || reviewMutation.isPending}
            onClick={() => reviewMutation.mutate("return")}
            className="rounded border border-input px-2 py-1 text-xs disabled:opacity-50"
          >
            Return to technician
          </button>
        </div>
        {!canReview ? <p className="text-[11px] text-muted-foreground">Role-gated: advisor/dispatch/manager access required.</p> : null}
        {reviewMutation.isError ? <ErrorText error={reviewMutation.error} /> : null}
      </div>
    </section>
  );
}

function SegmentExecutionCard({ job, segment, canExecute, canReview, onChanged }: {
  job: ServiceJobWithRelations;
  segment: ServiceJobSegment;
  canExecute: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [story, setStory] = useState({
    labor_story: segment.labor_story ?? "",
    labor_story_complaint_verification: segment.labor_story_complaint_verification ?? "",
    labor_story_diagnostic_steps: segment.labor_story_diagnostic_steps ?? "",
    labor_story_root_cause: segment.labor_story_root_cause ?? "",
    labor_story_parts_used: segment.labor_story_parts_used ?? "",
    labor_story_work_performed: segment.labor_story_work_performed ?? "",
    hours_actual: segment.hours_actual?.toString() ?? "",
    quoted_labor_hours: segment.quoted_labor_hours?.toString() ?? "",
    warranty_parts_label: segment.warranty_parts_label ?? "",
    warranty_parts_turn_in_completed: segment.warranty_parts_turn_in_completed,
    lockout_tagout_completed: segment.lockout_tagout_completed,
  });
  const [photo, setPhoto] = useState<{ phase: "before" | "during" | "after"; category: string; caption: string; file: File | null }>({
    phase: "before",
    category: "overall_condition",
    caption: "",
    file: null,
  });
  const [reviewNotes, setReviewNotes] = useState("");
  const [overrunReason, setOverrunReason] = useState("");

  const submitDiagnosis = useMutation({
    mutationFn: () => submitSegmentDiagnosis({
      segment_id: segment.id,
      labor_story_complaint_verification: story.labor_story_complaint_verification,
      labor_story_diagnostic_steps: story.labor_story_diagnostic_steps,
      labor_story_root_cause: story.labor_story_root_cause,
    }),
    onSuccess: onChanged,
  });
  const reviewDiagnosis = useMutation({
    mutationFn: (decision: "approve" | "return") => reviewSegmentDiagnosis({ segment_id: segment.id, decision, notes: reviewNotes }),
    onSuccess: onChanged,
  });
  const signOff = useMutation({
    mutationFn: () => signOffSegmentRepair({
      segment_id: segment.id,
      labor_story: story.labor_story,
      labor_story_complaint_verification: story.labor_story_complaint_verification,
      labor_story_diagnostic_steps: story.labor_story_diagnostic_steps,
      labor_story_root_cause: story.labor_story_root_cause,
      labor_story_parts_used: story.labor_story_parts_used,
      labor_story_work_performed: story.labor_story_work_performed,
      hours_actual: optionalNumber(story.hours_actual),
      quoted_labor_hours: optionalNumber(story.quoted_labor_hours),
      lockout_tagout_required: segment.lockout_tagout_required,
      lockout_tagout_completed: story.lockout_tagout_completed,
      warranty_parts_turn_in_required: segment.warranty_parts_turn_in_required,
      warranty_parts_turn_in_completed: story.warranty_parts_turn_in_completed,
      warranty_parts_label: story.warranty_parts_label,
    }),
    onSuccess: onChanged,
  });
  const acknowledgeOverrun = useMutation({
    mutationFn: () => acknowledgeSegmentOverrun({ segment_id: segment.id, overrun_reason: overrunReason }),
    onSuccess: onChanged,
  });
  const uploadPhoto = useMutation({
    mutationFn: () => {
      if (!photo.file) throw new Error("Choose a photo first.");
      return uploadAndRecordSegmentPhoto({
        workspace_id: job.workspace_id,
        service_job_id: job.id,
        segment_id: segment.id,
        phase: photo.phase,
        category: photo.category,
        caption: photo.caption,
        file: photo.file,
      });
    },
    onSuccess: () => {
      setPhoto((prev) => ({ ...prev, file: null, caption: "" }));
      onChanged();
    },
  });

  const photos = new Set((segment.photos ?? []).map((item) => item.phase));
  const segmentMissing = useMemo(() => {
    // Reuse the parent gate summary by inspecting status labels in-place.
    const missing: string[] = [];
    if (segment.diagnostic_signoff_status !== "approved") missing.push("diagnostic approval");
    if (segment.repair_signoff_status !== "completed") missing.push("repair sign-off");
    for (const phase of ["before", "during", "after"] as const) if (!photos.has(phase)) missing.push(`${phase} photo`);
    return missing;
  }, [segment, photos]);

  return (
    <div className="rounded-lg border bg-background/60 p-2 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Segment {segment.segment_number}: {segment.description ?? "Service work"}</p>
          <p className="text-[11px] text-muted-foreground">
            Diagnostic {segment.diagnostic_signoff_status} · Repair {segment.repair_signoff_status} · Overrun {segment.overrun_status}
          </p>
        </div>
        <div className="flex gap-1 text-[10px]">
          {["before", "during", "after"].map((phase) => (
            <span key={phase} className={`rounded-full px-2 py-0.5 ${photos.has(phase as "before" | "during" | "after") ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "bg-red-500/10 text-red-700 dark:text-red-200"}`}>
              {phase}
            </span>
          ))}
        </div>
      </div>
      {segmentMissing.length > 0 ? <MissingList items={segmentMissing} prefix="Segment needs" /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Textarea label="Complaint verification" value={story.labor_story_complaint_verification} onChange={(value) => setStory({ ...story, labor_story_complaint_verification: value })} />
        <Textarea label="Diagnostic steps" value={story.labor_story_diagnostic_steps} onChange={(value) => setStory({ ...story, labor_story_diagnostic_steps: value })} />
        <Textarea label="Root cause" value={story.labor_story_root_cause} onChange={(value) => setStory({ ...story, labor_story_root_cause: value })} />
        <Textarea label="Parts used" value={story.labor_story_parts_used} onChange={(value) => setStory({ ...story, labor_story_parts_used: value })} />
        <Textarea label="Work performed" value={story.labor_story_work_performed} onChange={(value) => setStory({ ...story, labor_story_work_performed: value })} />
        <Textarea label="Labor story (customer-readable, min 40 chars)" value={story.labor_story} onChange={(value) => setStory({ ...story, labor_story: value })} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Input label="Quoted hours" value={story.quoted_labor_hours} onChange={(value) => setStory({ ...story, quoted_labor_hours: value })} />
        <Input label="Actual hours" value={story.hours_actual} onChange={(value) => setStory({ ...story, hours_actual: value })} />
        <label className="flex items-center gap-2 rounded border p-2">
          <input type="checkbox" checked={story.lockout_tagout_completed} onChange={(event) => setStory({ ...story, lockout_tagout_completed: event.target.checked })} /> LOTO complete
        </label>
        <label className="flex items-center gap-2 rounded border p-2">
          <input type="checkbox" checked={story.warranty_parts_turn_in_completed} onChange={(event) => setStory({ ...story, warranty_parts_turn_in_completed: event.target.checked })} /> Warranty parts in
        </label>
      </div>
      {segment.warranty_parts_turn_in_required ? (
        <Input label="Warranty parts label" value={story.warranty_parts_label} onChange={(value) => setStory({ ...story, warranty_parts_label: value })} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canExecute || submitDiagnosis.isPending} onClick={() => submitDiagnosis.mutate()} className="rounded bg-secondary px-2 py-1 text-xs disabled:opacity-50">Submit diagnosis</button>
        <button type="button" disabled={!canReview || reviewDiagnosis.isPending} onClick={() => reviewDiagnosis.mutate("approve")} className="rounded bg-secondary px-2 py-1 text-xs disabled:opacity-50">Approve diagnosis</button>
        <button type="button" disabled={!canReview || reviewDiagnosis.isPending} onClick={() => reviewDiagnosis.mutate("return")} className="rounded border px-2 py-1 text-xs disabled:opacity-50">Return diagnosis</button>
        <button type="button" disabled={!canExecute || signOff.isPending} onClick={() => signOff.mutate()} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">Sign off repair</button>
      </div>
      <div className="grid gap-2 rounded border bg-muted/20 p-2 text-xs sm:grid-cols-[1fr_auto]">
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={photo.phase} onChange={(event) => setPhoto({ ...photo, phase: event.target.value as "before" | "during" | "after" })} className="rounded border bg-background px-2 py-1">
            <option value="before">Before</option><option value="during">During</option><option value="after">After</option>
          </select>
          <select value={photo.category} onChange={(event) => setPhoto({ ...photo, category: event.target.value })} className="rounded border bg-background px-2 py-1">
            {PHOTO_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input type="file" accept="image/*" capture="environment" onChange={(event) => setPhoto({ ...photo, file: event.target.files?.[0] ?? null })} className="text-[11px]" />
        </div>
        <button type="button" disabled={!canExecute || !photo.file || uploadPhoto.isPending} onClick={() => uploadPhoto.mutate()} className="rounded bg-secondary px-2 py-1 disabled:opacity-50">{uploadPhoto.isPending ? "Uploading…" : "Capture photo"}</button>
      </div>
      {segment.overrun_status === "overrun_unacknowledged" ? (
        <div className="flex flex-col gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs sm:flex-row">
          <input value={overrunReason} onChange={(event) => setOverrunReason(event.target.value)} placeholder="Reason for quoted-time overrun" className="min-w-0 flex-1 rounded border bg-background px-2 py-1" />
          <button type="button" disabled={!canReview || !overrunReason.trim() || acknowledgeOverrun.isPending} onClick={() => acknowledgeOverrun.mutate()} className="rounded bg-amber-600 px-2 py-1 text-white disabled:opacity-50">Acknowledge overrun</button>
        </div>
      ) : null}
      {[submitDiagnosis, reviewDiagnosis, signOff, acknowledgeOverrun, uploadPhoto].map((mutation, index) => mutation.isError ? <ErrorText key={index} error={mutation.error} /> : null)}
    </div>
  );
}

function WarrantyGatePanel({ job, canFinance, canOperate, onChanged }: { job: ServiceJobWithRelations; canFinance: boolean; canOperate: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const [originalJobId, setOriginalJobId] = useState(job.original_service_job_id ?? "");
  const [fault, setFault] = useState<string>(job.comeback_fault_attribution ?? "unknown");
  const [comebackNotes, setComebackNotes] = useState(job.comeback_notes ?? "");
  const [claimDraft, setClaimDraft] = useState({ claim_number: "", oem_name: job.machine?.warranty_provider ?? "", oem_reference: "" });
  const [payerDraft, setPayerDraft] = useState<Record<string, H8PayerType>>({});
  const [claimStatusDraft, setClaimStatusDraft] = useState<Record<string, H8WarrantyClaimStatus>>({});

  const claims = useQuery({ queryKey: ["service-warranty-claims", job.id], queryFn: () => listWarrantyClaimsForJob(job.id), staleTime: 15_000 });
  const lines = useQuery({ queryKey: ["service-line-payers", job.id], queryFn: () => listServiceLinePayers(job.id), staleTime: 15_000 });
  const refresh = () => {
    onChanged();
    qc.invalidateQueries({ queryKey: ["service-warranty-claims", job.id] });
    qc.invalidateQueries({ queryKey: ["service-line-payers", job.id] });
  };
  const linkComeback = useMutation({
    mutationFn: () => linkServiceComeback({ job_id: job.id, original_job_id: originalJobId.trim(), fault_attribution: fault, notes: comebackNotes }),
    onSuccess: refresh,
  });
  const assembleClaim = useMutation({
    mutationFn: () => assembleWarrantyClaim({ job_id: job.id, ...claimDraft }),
    onSuccess: refresh,
  });
  const updateClaimStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: H8WarrantyClaimStatus }) => updateWarrantyClaimStatus({ warranty_claim_id: id, status }),
    onSuccess: refresh,
  });
  const setPayer = useMutation({
    mutationFn: (line: H8LinePayerRow) => setServiceLinePayer({
      line_type: line.line_type,
      line_id: line.id,
      payer_type: payerDraft[line.id] ?? line.payer_type ?? "customer",
      warranty_claim_id: (payerDraft[line.id] ?? line.payer_type) === "warranty_claim" ? claims.data?.[0]?.id ?? null : null,
    }),
    onSuccess: refresh,
  });

  return (
    <section className="rounded-xl border border-border/70 bg-card p-3 space-y-3">
      <GateHeader eyebrow="H8 comeback / warranty" title="Payer routing and warranty lifecycle" ok={!job.comeback_no_rebill && (claims.data?.some((claim) => claim.status === "denied") !== true)} />
      {job.machine?.warranty_registered ? (
        <div className="rounded-lg border bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-200">
          Warranty registered: {job.machine.warranty_provider ?? "Provider unknown"} {job.machine.warranty_registration_number ? `· ${job.machine.warranty_registration_number}` : ""} {job.machine.warranty_end_date ? `· expires ${formatDate(job.machine.warranty_end_date)}` : ""}
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/20 p-2 text-xs text-muted-foreground">No registered warranty found on the machine snapshot.</div>
      )}
      {job.request_type === "comeback_rework" ? (
        <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
          <p className="text-xs font-medium">Comeback linkage</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={originalJobId} onChange={(event) => setOriginalJobId(event.target.value)} placeholder="Original service job UUID" className="rounded border bg-background px-2 py-1 text-xs font-mono" />
            <select value={fault} onChange={(event) => setFault(event.target.value)} className="rounded border bg-background px-2 py-1 text-xs">
              {['qep_fault','customer_fault','oem_fault','vendor_fault','parts_defect','other','unknown'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <textarea value={comebackNotes} onChange={(event) => setComebackNotes(event.target.value)} rows={2} placeholder="Comeback notes / attribution evidence" className="w-full rounded border bg-background px-2 py-1 text-xs" />
          <button type="button" disabled={!canOperate || !originalJobId.trim() || linkComeback.isPending} onClick={() => linkComeback.mutate()} className="rounded bg-secondary px-2 py-1 text-xs disabled:opacity-50">Link comeback</button>
          {job.comeback_no_rebill ? <p className="text-xs font-medium text-red-700 dark:text-red-200">QEP-fault no-rebill is active. Customer billing is blocked and payer lines are internal.</p> : null}
          {linkComeback.isError ? <ErrorText error={linkComeback.error} /> : null}
        </div>
      ) : null}
      <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
        <p className="text-xs font-medium">Warranty claim flow</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input value={claimDraft.claim_number} onChange={(event) => setClaimDraft({ ...claimDraft, claim_number: event.target.value })} placeholder="Claim #" className="rounded border bg-background px-2 py-1 text-xs" />
          <input value={claimDraft.oem_name} onChange={(event) => setClaimDraft({ ...claimDraft, oem_name: event.target.value })} placeholder="OEM" className="rounded border bg-background px-2 py-1 text-xs" />
          <input value={claimDraft.oem_reference} onChange={(event) => setClaimDraft({ ...claimDraft, oem_reference: event.target.value })} placeholder="OEM reference" className="rounded border bg-background px-2 py-1 text-xs" />
        </div>
        <button type="button" disabled={!canFinance || assembleClaim.isPending} onClick={() => assembleClaim.mutate()} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">Assemble/update claim</button>
        {claims.isLoading ? <p className="text-xs text-muted-foreground">Loading warranty claims…</p> : null}
        {claims.isError ? <ErrorText error={claims.error} /> : null}
        {claims.data?.length === 0 ? <p className="text-xs text-muted-foreground">No warranty claim assembled for this work order yet.</p> : null}
        {claims.data?.map((claim) => (
          <div key={claim.id} className="rounded border bg-background/60 p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{claim.claim_number ?? claim.id.slice(0, 8)} · {claim.status}</span>
              <span>{formatCents(claim.requested_amount_cents)} requested</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={claimStatusDraft[claim.id] ?? claim.status} onChange={(event) => setClaimStatusDraft({ ...claimStatusDraft, [claim.id]: event.target.value as H8WarrantyClaimStatus })} className="rounded border bg-background px-2 py-1">
                {H8_WARRANTY_STATUS_FLOW.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button type="button" disabled={!canFinance || updateClaimStatus.isPending} onClick={() => updateClaimStatus.mutate({ id: claim.id, status: claimStatusDraft[claim.id] ?? claim.status })} className="rounded border px-2 py-1 disabled:opacity-50">Update status</button>
            </div>
          </div>
        ))}
        {assembleClaim.isError ? <ErrorText error={assembleClaim.error} /> : null}
        {updateClaimStatus.isError ? <ErrorText error={updateClaimStatus.error} /> : null}
      </div>
      <div className="rounded-lg border bg-muted/20 p-2 space-y-2">
        <p className="text-xs font-medium">Per-line payer assignment</p>
        {lines.isLoading ? <p className="text-xs text-muted-foreground">Loading payer lines…</p> : null}
        {lines.isError ? <ErrorText error={lines.error} /> : null}
        {lines.data?.length === 0 ? <p className="text-xs text-muted-foreground">No quote, labor, or billing lines to assign yet.</p> : null}
        {lines.data?.map((line) => (
          <div key={`${line.line_type}-${line.id}`} className="flex flex-col gap-2 rounded border bg-background/60 p-2 text-xs sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{line.label}</p>
              <p className="text-muted-foreground">{formatCents(line.amount_cents)} · current {line.payer_type ? H8_PAYER_LABELS[line.payer_type] : "Customer (legacy default)"}</p>
            </div>
            <select value={payerDraft[line.id] ?? line.payer_type ?? "customer"} onChange={(event) => setPayerDraft({ ...payerDraft, [line.id]: event.target.value as H8PayerType })} className="rounded border bg-background px-2 py-1">
              {H8_PAYER_TYPES.map((payer) => <option key={payer} value={payer}>{H8_PAYER_LABELS[payer]}</option>)}
            </select>
            <button type="button" disabled={!canFinance || setPayer.isPending} onClick={() => setPayer.mutate(line)} className="rounded bg-secondary px-2 py-1 disabled:opacity-50">Save payer</button>
          </div>
        ))}
        {setPayer.isError ? <ErrorText error={setPayer.error} /> : null}
      </div>
      {!canFinance ? <p className="text-[11px] text-muted-foreground">Role-gated: finance/admin/service leadership can change claims and payers; technicians have read-only warranty context.</p> : null}
    </section>
  );
}

function GateHeader({ eyebrow, title, ok }: { eyebrow: string; title: string; ok: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "bg-red-500/15 text-red-700 dark:text-red-200"}`}>
        {ok ? "Clear" : "Blocked"}
      </span>
    </div>
  );
}

function ThreeC({ label, value }: { label: string; value?: string | null }) {
  return <div className="rounded-lg border bg-background/60 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 line-clamp-3">{value || "—"}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-background/60 p-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 font-medium">{value}</p></div>;
}

function MissingList({ items, prefix }: { items: string[]; prefix: string }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs">
      <p className="font-medium text-red-700 dark:text-red-200">{prefix}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-red-700 dark:text-red-100">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs"><span className="text-muted-foreground">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={2} className="mt-1 w-full rounded border bg-background px-2 py-1" /></label>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs"><span className="text-muted-foreground">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border bg-background px-2 py-1" /></label>;
}

function ErrorText({ error }: { error: unknown }) {
  return <p className="text-xs text-destructive" role="alert">{error instanceof Error ? error.message : "Action failed"}</p>;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatCurrency(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(parsed);
}

function formatCents(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return formatCurrency(parsed / 100);
}

function numberOrDash(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : "—";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : value;
}
