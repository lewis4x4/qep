import type {
  H8PayerType,
  ServiceJobSegment,
  ServiceJobWithRelations,
  ServicePriority,
  ServiceRequestType,
  ServiceSourceType,
} from "./types";

export const H2_REQUEST_TYPES: ServiceRequestType[] = [
  "repair",
  "pm_service",
  "warranty",
  "field_service",
  "internal",
  "comeback_rework",
  "hauling_transport",
];

export const H2_SOURCE_TYPES: ServiceSourceType[] = [
  "call",
  "walk_in",
  "drop_off",
  "field_request",
  "internal_request",
];

export const H2_PRIORITIES: ServicePriority[] = ["normal", "high", "emergency"];

export const H8_PAYER_TYPES: H8PayerType[] = [
  "customer",
  "warranty_claim",
  "qep_internal",
  "oem_policy",
  "goodwill",
  "other",
];

export const H8_PAYER_LABELS: Record<H8PayerType, string> = {
  customer: "Customer",
  warranty_claim: "Warranty claim",
  qep_internal: "QEP internal",
  oem_policy: "OEM policy",
  goodwill: "Goodwill",
  other: "Other",
};

export const H8_WARRANTY_STATUS_FLOW = [
  "draft",
  "submitted",
  "oem_evaluation",
  "approved",
  "paid",
  "denied",
  "cancelled",
] as const;

export interface H2MachineSnapshot {
  name?: string | null;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  year?: number | null;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface H2IntakeDraft {
  machine: H2MachineSnapshot | null;
  machineId: string | null;
  sourceType: string;
  requestType: string;
  priority: string;
  hourMeter: string;
  odometerMiles: string;
  promisedAt: string;
  complaint: string;
  cause: string;
  correction: string;
  shopOrField: "shop" | "field";
  fieldSiteLocation: string;
  fieldSiteContactName: string;
  fieldSiteContactPhone: string;
  fieldSiteConditionsAccessNotes: string;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function textFromMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isH2GrappleTruck(machine: H2MachineSnapshot | null): boolean {
  if (!machine) return false;
  const classHints = [
    textFromMetadata(machine.metadata, "equipment_class"),
    textFromMetadata(machine.metadata, "service_equipment_class"),
    textFromMetadata(machine.metadata, "rate_class"),
    textFromMetadata(machine.metadata, "work_class"),
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\bgrapple(_truck)?\b/.test(classHints)) return true;

  const freeText = [
    machine.name,
    machine.make,
    machine.model,
    machine.category,
    textFromMetadata(machine.metadata, "description"),
    textFromMetadata(machine.metadata, "body_type"),
    textFromMetadata(machine.metadata, "equipment_type"),
  ].filter(Boolean).join(" ").toLowerCase();
  return /\bgrapple\b/.test(freeText) && /\btruck\b/.test(freeText);
}

export function validateH2IntakeDraft(draft: H2IntakeDraft): { ok: boolean; missing: string[]; invalid: string[]; isGrappleTruck: boolean } {
  const missing: string[] = [];
  const invalid: string[] = [];
  if (!draft.machineId) missing.push("machine_id");
  if (!draft.machine) missing.push("machine");
  if (!nonEmpty(draft.machine?.make)) missing.push("machine.make");
  if (!nonEmpty(draft.machine?.model)) missing.push("machine.model");
  if (!nonEmpty(draft.machine?.serial_number)) missing.push("machine.serial_number");
  if (draft.machine?.year == null) missing.push("machine.year");
  if (!H2_SOURCE_TYPES.includes(draft.sourceType as ServiceSourceType)) invalid.push("source_type");
  if (!H2_REQUEST_TYPES.includes(draft.requestType as ServiceRequestType)) invalid.push("request_type");
  if (!H2_PRIORITIES.includes(draft.priority as ServicePriority)) invalid.push("priority");
  if (!nonnegativeNumber(draft.hourMeter)) missing.push("hour_meter_reading");
  if (!dateLike(draft.promisedAt)) missing.push("promised_at");
  if (!nonEmpty(draft.complaint)) missing.push("complaint");
  if (!nonEmpty(draft.cause)) missing.push("cause");
  if (!nonEmpty(draft.correction)) missing.push("correction");
  if (!["shop", "field"].includes(draft.shopOrField)) invalid.push("shop_or_field");
  if ((draft.requestType === "field_service" || draft.sourceType === "field_request") && draft.shopOrField !== "field") {
    invalid.push("shop_or_field");
  }
  const grapple = isH2GrappleTruck(draft.machine);
  if (grapple && !nonnegativeNumber(draft.odometerMiles)) missing.push("odometer_miles");
  if (draft.shopOrField === "field") {
    if (!nonEmpty(draft.fieldSiteLocation)) missing.push("field_site_location");
    if (!nonEmpty(draft.fieldSiteContactName)) missing.push("field_site_contact_name");
    if (!nonEmpty(draft.fieldSiteContactPhone)) missing.push("field_site_contact_phone");
    if (!nonEmpty(draft.fieldSiteConditionsAccessNotes)) missing.push("field_site_conditions_access_notes");
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing: [...new Set(missing)], invalid: [...new Set(invalid)], isGrappleTruck: grapple };
}

export function nonnegativeNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function dateLike(value: string): boolean {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

export interface GateStatus {
  ok: boolean;
  code: string;
  title: string;
  reason: string;
  missing: string[];
}

export function evaluateH3EstimateGate(job: ServiceJobWithRelations | null | undefined): GateStatus {
  if (!job) return { ok: false, code: "job_missing", title: "No work order loaded", reason: "Open a work order to evaluate approval status.", missing: ["job"] };
  const required = job.estimate_authorization_required !== false;
  const status = job.estimate_authorization_status ?? (required ? "pending" : "not_required");
  if (!required || status === "not_required") {
    return { ok: true, code: "estimate_authorization_not_required", title: "Approval not required", reason: "Legacy work order is not subject to H3 approval gating.", missing: [] };
  }
  const approvedAmount = money(job.approved_estimate_amount);
  const scopeAmount = money(job.quote_total);
  const thresholdPct = typeof job.estimate_reauth_threshold_pct === "number" ? job.estimate_reauth_threshold_pct : 10;
  const thresholdAmount = approvedAmount == null ? null : roundMoney(approvedAmount * (1 + thresholdPct / 100));
  const documented = Boolean(job.approved_estimate_quote_id && job.approved_estimate_approval_id && approvedAmount != null);
  if (status !== "approved" || !documented) {
    const reauth = status === "reauthorization_required";
    return {
      ok: false,
      code: reauth ? "estimate_reauthorization_required" : "estimate_approval_required",
      title: reauth ? "Re-authorization required" : "No approval = no repair",
      reason: job.estimate_reauthorization_reason ?? (reauth
        ? "Current scope exceeds the approved estimate by more than 10%. Document customer re-authorization before work starts."
        : "Repair work is blocked until a documented approved estimate is recorded."),
      missing: reauth ? ["scope_increase_reauthorization"] : ["approved_estimate_quote_id", "approved_estimate_approval_id", "approved_estimate_amount"],
    };
  }
  if (scopeAmount != null && thresholdAmount != null && scopeAmount > thresholdAmount) {
    return {
      ok: false,
      code: "estimate_reauthorization_required",
      title: "Scope increase over threshold",
      reason: `Current estimate ${formatMoney(scopeAmount)} exceeds the ${thresholdPct}% re-authorization threshold ${formatMoney(thresholdAmount)}.`,
      missing: ["scope_increase_reauthorization"],
    };
  }
  return { ok: true, code: "estimate_authorization_approved", title: "Approved estimate on file", reason: approvedAmount == null ? "Approval is documented." : `Approved baseline ${formatMoney(approvedAmount)} is within the ${thresholdPct}% scope threshold.`, missing: [] };
}

export function evaluateH5CloseGate(job: ServiceJobWithRelations | null | undefined, requireSaReview = true): GateStatus {
  if (!job) return { ok: false, code: "job_missing", title: "No work order loaded", reason: "Open a work order to evaluate close readiness.", missing: ["job"] };
  const missing: string[] = [];
  const requiredSegments = (job.segments ?? []).filter((segment) => segment.h5_documentation_required !== false);
  if (job.h5_documentation_required !== false && requiredSegments.length === 0) {
    missing.push("At least one H5-required job segment");
  }
  if (requireSaReview && (job.documentation_review_status ?? "pending") !== "approved") {
    missing.push("Service Advisor documentation approval");
  }
  if (job.lockout_tagout_required && !job.lockout_tagout_completed) {
    missing.push("Job lock-out/tag-out completion");
  }
  for (const segment of requiredSegments) {
    missing.push(...missingForSegment(segment));
  }
  return missing.length === 0
    ? { ok: true, code: "h5_documentation_complete", title: "QC close gate clear", reason: "Segments, labor story, photos, safety, warranty turn-in, and documentation review are complete.", missing: [] }
    : { ok: false, code: "h5_documentation_incomplete", title: "QC close gate blocked", reason: "Work order cannot close or move to invoice-ready until H5 documentation requirements are complete.", missing };
}

export function missingForSegment(segment: ServiceJobSegment): string[] {
  const label = `Segment ${segment.segment_number}`;
  const missing: string[] = [];
  if (segment.diagnostic_signoff_status !== "approved") missing.push(`${label}: diagnostic sign-off approved`);
  if (segment.repair_signoff_status !== "completed") missing.push(`${label}: repair sign-off completed`);
  if ((segment.labor_story?.trim().length ?? 0) < 40) missing.push(`${label}: labor story ≥ 40 characters`);
  const storyFields: Array<[keyof ServiceJobSegment, string]> = [
    ["labor_story_complaint_verification", "complaint verification"],
    ["labor_story_diagnostic_steps", "diagnostic steps"],
    ["labor_story_root_cause", "root cause"],
    ["labor_story_parts_used", "parts used"],
    ["labor_story_work_performed", "work performed"],
  ];
  for (const [field, name] of storyFields) {
    const value = segment[field];
    if (typeof value !== "string" || value.trim().length < 10) missing.push(`${label}: ${name} ≥ 10 characters`);
  }
  const budget = segment.quoted_labor_hours ?? segment.estimated_hours;
  const actual = segment.hours_actual;
  if (budget != null && budget > 0 && actual != null && actual > roundMoney(budget * 1.1) && !segment.overrun_acknowledged_at) {
    missing.push(`${label}: quoted-time overrun acknowledged`);
  }
  if (segment.lockout_tagout_required && !segment.lockout_tagout_completed) missing.push(`${label}: lock-out/tag-out completion`);
  if (segment.warranty_parts_turn_in_required) {
    if (!segment.warranty_parts_turn_in_completed) missing.push(`${label}: warranty parts turn-in completed`);
    if ((segment.warranty_parts_label?.trim().length ?? 0) < 3) missing.push(`${label}: warranty parts label`);
  }
  const phases = new Set((segment.photos ?? []).map((photo) => photo.phase));
  for (const phase of ["before", "during", "after"] as const) {
    if (!phases.has(phase)) missing.push(`${label}: ${phase} photo`);
  }
  return missing;
}

export function shouldBlockStageTransition(job: ServiceJobWithRelations, toStage: string): GateStatus | null {
  if (toStage === "in_progress") {
    const gate = evaluateH3EstimateGate(job);
    return gate.ok ? null : gate;
  }
  if (["invoice_ready", "invoiced", "paid_closed"].includes(toStage)) {
    const gate = evaluateH5CloseGate(job, true);
    return gate.ok ? null : gate;
  }
  return null;
}

function money(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
}
