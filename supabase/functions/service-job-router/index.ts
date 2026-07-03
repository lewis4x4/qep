/**
 * Service Job Router — CRUD + lifecycle transitions for service_jobs.
 *
 * Auth: user JWT only (service_role rejected — use RLS via user session).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  requireServiceUser,
  SERVICE_JOB_ACCESS_ROLES,
} from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonErrorWithFields,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  notifyAfterStageChange,
  notifyPromisedDateChanged,
} from "../_shared/service-lifecycle-notify.ts";
import { generateInvoiceForServiceJob } from "../_shared/service-invoice.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  populatePartsFromJobCode,
  resyncPartsFromJobCode,
} from "../_shared/service-parts-from-job-code.ts";
import { validateH2ServiceJobIntake } from "../_shared/service-intake-hardening.ts";
import { evaluateEstimateAuthorizationGate } from "../_shared/service-estimate-authorization.ts";
import {
  normalizeServiceHoldState,
  SERVICE_HOLD_STATES,
} from "../_shared/service-hold-integrity.ts";
import {
  calculateQuotedTimeOverrun,
  H5_LABOR_STORY_FIELDS,
  normalizeH5PhotoCategory,
  normalizeH5PhotoPhase,
  validateH5LaborStory,
} from "../_shared/service-h5-execution.ts";
import {
  canTransitionH8WarrantyClaim,
  h8NoRebillFieldsForFault,
  h8PayerBillingFields,
  normalizeH8ComebackFaultAttribution,
  normalizeH8PayerType,
  normalizeH8WarrantyClaimStatus,
} from "../_shared/service-h8-comeback-warranty.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(s: string): boolean {
  return UUID_RE.test(s.trim());
}

function isMigratedGrappleProductionJob(
  job: Record<string, unknown> | null | undefined,
): boolean {
  return job?.grapple_production_routing_status === "migrated_to_grapple_builds";
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  request_received: ["triaging"],
  triaging: ["diagnosis_selected"],
  diagnosis_selected: ["quote_drafted"],
  quote_drafted: ["quote_sent"],
  quote_sent: ["approved", "quote_drafted"],
  approved: ["parts_pending"],
  parts_pending: ["parts_staged"],
  parts_staged: ["scheduled", "haul_scheduled"],
  haul_scheduled: ["scheduled"],
  scheduled: ["in_progress"],
  in_progress: ["blocked_waiting", "quality_check"],
  blocked_waiting: ["in_progress"],
  quality_check: ["ready_for_pickup"],
  ready_for_pickup: ["invoice_ready"],
  invoice_ready: ["invoiced"],
  invoiced: ["paid_closed"],
};

const BLOCKED_ALLOWED_FROM = new Set([
  "parts_pending",
  "parts_staged",
  "haul_scheduled",
  "scheduled",
  "in_progress",
]);

const H2_INTAKE_FIELD_NAMES = [
  "machine_id",
  "source_type",
  "request_type",
  "priority",
  "shop_or_field",
  "hour_meter_reading",
  "odometer_miles",
  "machine_make",
  "machine_model",
  "machine_serial_number",
  "machine_year",
  "complaint",
  "cause",
  "correction",
  "promised_at",
  "field_site_location",
  "field_site_contact_name",
  "field_site_contact_phone",
  "field_site_conditions_access_notes",
];
const H2_INTAKE_FIELDS = new Set(H2_INTAKE_FIELD_NAMES);

const ALLOWED_UPDATE_FIELDS = new Set([
  "customer_id",
  "contact_id",
  "machine_id",
  "source_type",
  "request_type",
  "priority",
  "status_flags",
  "branch_id",
  "advisor_id",
  "service_manager_id",
  "technician_id",
  "requested_by_name",
  "customer_problem_summary",
  "ai_diagnosis_summary",
  "selected_job_code_id",
  "haul_required",
  "shop_or_field",
  "hour_meter_reading",
  "odometer_miles",
  "machine_make",
  "machine_model",
  "machine_serial_number",
  "machine_year",
  "complaint",
  "cause",
  "correction",
  "promised_at",
  "field_site_location",
  "field_site_contact_name",
  "field_site_contact_phone",
  "field_site_conditions_access_notes",
  "field_mileage_miles",
  "field_mileage_source",
  "field_mileage_recorded_at",
  "field_mileage_provider",
  "field_mileage_provider_trip_id",
  "field_mileage_metadata",
  "scheduled_start_at",
  "scheduled_end_at",
  "invoice_total",
  "portal_request_id",
  "lockout_tagout_required",
  "lockout_tagout_completed",
  "lockout_tagout_notes",
]);

const READ_ONLY_JOB_ACTIONS = new Set(["get", "list"]);
const TECHNICIAN_EXECUTION_ACTIONS = new Set([
  "submit_segment_diagnosis",
  "sign_off_segment_repair",
  "acknowledge_segment_overrun",
  "record_segment_labor",
  "record_segment_photo",
]);
const H8_FINANCE_WARRANTY_ACTIONS = new Set([
  "set_line_payer",
  "assemble_warranty_claim",
  "update_warranty_claim_status",
]);
const SERVICE_JOB_MUTATION_ROLES = new Set([
  "rep",
  "admin",
  "manager",
  "owner",
  "service_writer",
  "dispatch",
]);

function canRunServiceJobAction(role: string, action: string): boolean {
  if (SERVICE_JOB_MUTATION_ROLES.has(role)) return true;
  if (role === "technician") {
    return READ_ONLY_JOB_ACTIONS.has(action) ||
      TECHNICIAN_EXECUTION_ACTIONS.has(action);
  }
  if (role === "finance_admin") {
    return READ_ONLY_JOB_ACTIONS.has(action) ||
      H8_FINANCE_WARRANTY_ACTIONS.has(action);
  }
  if (role === "parts_counter") {
    return READ_ONLY_JOB_ACTIONS.has(action);
  }
  return false;
}

interface RouterPayload {
  action: string;
  [key: string]: unknown;
}

/** Single source of truth for job detail + relations (drawer, link mutations). */
const SERVICE_JOB_ENRICHED_SELECT = `
      *,
      customer:crm_companies(id, name),
      contact:crm_contacts(id, first_name, last_name, email, phone),
      machine:crm_equipment(id, make, model, serial_number, year, warranty_registered, warranty_registration_number, warranty_provider, warranty_start_date, warranty_end_date, warranty_coverage_terms, warranty_coverage_notes),
      advisor:profiles!service_jobs_advisor_id_fkey(id, full_name, email),
      technician:profiles!service_jobs_technician_id_fkey(id, full_name, email),
      job_code:job_codes(id, job_name, make, model_family, manufacturer_estimated_hours),
      events:service_job_events(id, event_type, actor_id, old_stage, new_stage, metadata, created_at),
      blockers:service_job_blockers(id, blocker_type, description, resolved_at, created_at),
      parts:service_parts_requirements(id, part_number, description, quantity, status, need_by_date, source, intake_line_status),
      quotes:service_quotes(id, version, total, status, sent_at),
      fulfillment_run:parts_fulfillment_runs(id, status, created_at),
      portal_request:service_requests!service_jobs_portal_request_id_fkey(
        id,
        status,
        request_type,
        urgency,
        description,
        created_at,
        portal_customer:portal_customers(first_name, last_name, email)
      ),
      segments:service_job_segments(
        id,
        segment_number,
        description,
        status,
        technician_id,
        estimated_hours,
        quoted_labor_hours,
        hours_actual,
        diagnostic_signoff_status,
        diagnostic_submitted_at,
        diagnostic_approved_at,
        repair_signoff_status,
        repair_signed_off_at,
        labor_story,
        labor_story_complaint_verification,
        labor_story_diagnostic_steps,
        labor_story_root_cause,
        labor_story_parts_used,
        labor_story_work_performed,
        overrun_status,
        overrun_flagged_at,
        overrun_acknowledged_at,
        lockout_tagout_required,
        lockout_tagout_completed,
        warranty_parts_turn_in_required,
        warranty_parts_turn_in_completed,
        warranty_parts_label,
        photos:service_job_segment_photos(
          id,
          phase,
          category,
          storage_bucket,
          storage_path,
          caption,
          uploaded_by,
          uploaded_at
        )
      )
    `;

async function fetchJobEnriched(
  supabase: SupabaseClient,
  jobId: string,
) {
  return await supabase
    .from("service_jobs")
    .select(SERVICE_JOB_ENRICHED_SELECT)
    .eq("id", jobId)
    .single();
}

async function fetchH2IntakeMachine(
  supabase: SupabaseClient,
  machineId: unknown,
): Promise<Record<string, unknown> | null> {
  if (typeof machineId !== "string" || !isUuidString(machineId)) return null;
  const { data, error } = await supabase
    .from("crm_equipment")
    .select(
      "id, name, make, model, serial_number, year, category, metadata, warranty_registered, warranty_registration_number, warranty_provider, warranty_start_date, warranty_end_date, warranty_coverage_terms, warranty_coverage_notes",
    )
    .eq("id", machineId)
    .maybeSingle();
  if (error) {
    console.warn("H2 machine lookup failed during intake:", error);
    return null;
  }
  return data as Record<string, unknown> | null;
}

function hasH2IntakeShape(
  row: Record<string, unknown> | null | undefined,
): boolean {
  if (!row) return false;
  return [
    "hour_meter_reading",
    "odometer_miles",
    "machine_make",
    "machine_model",
    "machine_serial_number",
    "machine_year",
    "complaint",
    "cause",
    "correction",
    "promised_at",
    "field_site_location",
    "field_site_contact_name",
    "field_site_contact_phone",
    "field_site_conditions_access_notes",
  ].some((field) => row[field] != null && row[field] !== "");
}

function estimateAuthorizationFields(
  gate: ReturnType<typeof evaluateEstimateAuthorizationGate>,
) {
  return {
    code: gate.code,
    approved_amount: gate.approvedAmount,
    threshold_amount: gate.thresholdAmount,
    scope_estimate_amount: gate.scopeEstimateAmount,
    threshold_pct: gate.thresholdPct,
    status: gate.status,
    scope_increase_pct: gate.scopeIncreasePct,
    documented_approval: gate.documentedApproval,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
      SERVICE_JOB_ACCESS_ROLES,
    );
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const actorId = auth.userId;

    const body: RouterPayload = await req.json();
    const { action } = body;
    if (!canRunServiceJobAction(auth.role, action)) {
      return safeJsonError("Forbidden for service role", 403, origin);
    }

    switch (action) {
      case "create":
        return await handleCreate(supabase, body, actorId, origin);
      case "update":
        return await handleUpdate(supabase, body, actorId, origin);
      case "transition":
        return await handleTransition(supabase, body, actorId, origin);
      case "populate_parts":
        return await handlePopulateParts(supabase, body, origin);
      case "get":
        return await handleGet(supabase, body, origin);
      case "list":
        return await handleList(supabase, body, origin);
      case "reassign_pool":
        return await handleReassignPool(supabase, body, actorId, origin);
      case "resync_parts_from_job_code":
        return await handleResyncPartsFromJobCode(
          supabase,
          body,
          actorId,
          origin,
        );
      case "assign_technician":
        return await handleAssignTechnician(supabase, body, actorId, origin);
      case "link_portal_request":
        return await handleLinkPortalRequest(supabase, body, actorId, origin);
      case "unlink_portal_request":
        return await handleUnlinkPortalRequest(supabase, body, actorId, origin);
      case "search_portal_orders":
        return await handleSearchPortalOrders(supabase, body, origin);
      case "link_fulfillment_run":
        return await handleLinkFulfillmentRun(supabase, body, actorId, origin);
      case "submit_segment_diagnosis":
        return await handleSubmitSegmentDiagnosis(
          supabase,
          body,
          actorId,
          origin,
        );
      case "review_segment_diagnosis":
        return await handleReviewSegmentDiagnosis(
          supabase,
          body,
          actorId,
          origin,
        );
      case "sign_off_segment_repair":
        return await handleSignOffSegmentRepair(
          supabase,
          body,
          actorId,
          origin,
        );
      case "acknowledge_segment_overrun":
        return await handleAcknowledgeSegmentOverrun(
          supabase,
          body,
          actorId,
          origin,
        );
      case "record_segment_labor":
        return await handleRecordSegmentLabor(supabase, body, actorId, origin);
      case "record_segment_photo":
        return await handleRecordSegmentPhoto(supabase, body, actorId, origin);
      case "review_documentation":
        return await handleReviewDocumentation(supabase, body, actorId, origin);
      case "link_comeback":
        return await handleLinkComeback(supabase, body, actorId, origin);
      case "set_line_payer":
        return await handleSetLinePayer(supabase, body, actorId, origin);
      case "assemble_warranty_claim":
        return await handleAssembleWarrantyClaim(
          supabase,
          body,
          actorId,
          origin,
        );
      case "update_warranty_claim_status":
        return await handleUpdateWarrantyClaimStatus(
          supabase,
          body,
          actorId,
          origin,
        );
      case "register_machine_warranty":
        return await handleRegisterMachineWarranty(
          supabase,
          body,
          actorId,
          origin,
        );
      default:
        return safeJsonError(`Unknown action: ${action}`, 400, origin);
    }
  } catch (err) {
    captureEdgeException(err, { fn: "service-job-router", req });
    console.error("service-job-router error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("Origin"),
    );
  }
});

type H5GateRow = {
  ok: boolean;
  code: string;
  reason: string;
  missing: unknown;
};

function isNonEmptyText(value: unknown, minLength = 1): boolean {
  return typeof value === "string" && value.trim().length >= minLength;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function normalizedIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function promisedAtChanged(previous: unknown, next: unknown): boolean {
  return normalizedIsoDate(previous) !== normalizedIsoDate(next);
}

function copyOptionalTextFields(
  body: RouterPayload,
  fields: Record<string, unknown>,
  names: readonly string[],
) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(body, name)) {
      fields[name] = optionalString(body[name]);
    }
  }
}

function validateOptionalNumberFields(
  body: RouterPayload,
  names: readonly string[],
): string[] {
  return names.filter((name) => {
    if (!Object.prototype.hasOwnProperty.call(body, name)) return false;
    const value = body[name];
    return value !== null && value !== undefined && value !== "" &&
      optionalNumber(value) === null;
  });
}

function copyOptionalNumberFields(
  body: RouterPayload,
  fields: Record<string, unknown>,
  names: readonly string[],
) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(body, name)) {
      fields[name] = optionalNumber(body[name]);
    }
  }
}

function copyOptionalBooleanFields(
  body: RouterPayload,
  fields: Record<string, unknown>,
  names: readonly string[],
) {
  for (const name of names) {
    const value = optionalBoolean(body[name]);
    if (value !== null) fields[name] = value;
  }
}

function segmentOverrunUpdateFields(
  segment: Record<string, unknown>,
  fields: Record<string, unknown>,
  nowIso: string,
): {
  fields: Record<string, unknown>;
  overrun: ReturnType<typeof calculateQuotedTimeOverrun>;
} {
  const overrun = calculateQuotedTimeOverrun({
    quotedLaborHours: fields.quoted_labor_hours ?? segment.quoted_labor_hours,
    estimatedHours: fields.estimated_hours ?? segment.estimated_hours,
    actualHours: fields.hours_actual ?? segment.hours_actual,
    thresholdPct: fields.overrun_threshold_pct ?? segment.overrun_threshold_pct,
    acknowledgedAt: fields.overrun_acknowledged_at ??
      segment.overrun_acknowledged_at,
  });

  fields.overrun_status = overrun.status;
  if (
    overrun.status === "overrun_unacknowledged" &&
    !segment.overrun_flagged_at
  ) {
    fields.overrun_flagged_at = nowIso;
  }

  return { fields, overrun };
}

async function fetchSegment(
  supabase: SupabaseClient,
  segmentId: string,
) {
  return await supabase
    .from("service_job_segments")
    .select("*")
    .eq("id", segmentId)
    .single();
}

async function fetchJobForH5(
  supabase: SupabaseClient,
  jobId: string,
) {
  return await supabase
    .from("service_jobs")
    .select(
      "id, workspace_id, current_stage, closed_at, h5_documentation_required, documentation_review_status",
    )
    .eq("id", jobId)
    .single();
}

async function insertH5Event(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    jobId: string;
    actorId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
    oldStage?: string | null;
    newStage?: string | null;
  },
) {
  await supabase.from("service_job_events").insert({
    workspace_id: params.workspaceId,
    job_id: params.jobId,
    event_type: params.eventType,
    actor_id: params.actorId,
    old_stage: params.oldStage ?? null,
    new_stage: params.newStage ?? null,
    metadata: params.metadata ?? {},
  });
}

async function runH5DocumentationGate(
  supabase: SupabaseClient,
  jobId: string,
  requireSaReview: boolean,
): Promise<{ gate: H5GateRow | null; error: unknown }> {
  const { data, error } = await supabase.rpc(
    "service_job_h5_documentation_gate",
    { p_job_id: jobId, p_require_sa_review: requireSaReview },
  );
  if (error) return { gate: null, error };
  const rows = Array.isArray(data) ? data as H5GateRow[] : [];
  return { gate: rows[0] ?? null, error: null };
}

function gateErrorPayload(gate: H5GateRow | null) {
  return {
    documentation_gate: {
      ok: gate?.ok ?? false,
      code: gate?.code ?? "h5_documentation_gate_failed",
      reason: gate?.reason ?? "H5 documentation gate failed.",
      missing: gate?.missing ?? [],
    },
  };
}

async function handleCreate(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const {
    customer_id,
    contact_id,
    machine_id,
    source_type,
    request_type,
    priority,
    status_flags = [],
    branch_id,
    advisor_id,
    service_manager_id,
    requested_by_name,
    customer_problem_summary,
    haul_required = false,
    shop_or_field,
    scheduled_start_at,
    scheduled_end_at,
    selected_job_code_id,
    portal_request_id,
  } = body;

  const machine = await fetchH2IntakeMachine(supabase, machine_id);

  const h2Validation = validateH2ServiceJobIntake(body, machine);
  if (!h2Validation.ok) {
    return safeJsonErrorWithFields(
      "Incomplete service work-order intake",
      422,
      origin,
      {
        code: "service_intake_incomplete",
        missing: h2Validation.missing,
        invalid: h2Validation.invalid,
        is_grapple_truck: h2Validation.is_grapple_truck,
        is_grapple_production_service_route:
          h2Validation.is_grapple_production_service_route,
      },
    );
  }

  const nowIso = new Date().toISOString();

  const { data: job, error } = await supabase
    .from("service_jobs")
    .insert({
      customer_id: customer_id || null,
      contact_id: contact_id || null,
      machine_id: machine_id || null,
      source_type: h2Validation.normalized.source_type,
      request_type: h2Validation.normalized.request_type,
      priority: h2Validation.normalized.priority,
      current_stage: "request_received",
      current_stage_entered_at: nowIso,
      status_flags,
      branch_id: branch_id || null,
      advisor_id: advisor_id || actorId,
      service_manager_id: service_manager_id || null,
      requested_by_name: requested_by_name || null,
      customer_problem_summary: customer_problem_summary ||
        h2Validation.normalized.complaint || null,
      haul_required,
      shop_or_field: h2Validation.normalized.shop_or_field,
      hour_meter_reading: h2Validation.normalized.hour_meter_reading,
      odometer_miles: h2Validation.normalized.odometer_miles ?? null,
      machine_make: h2Validation.normalized.machine_make,
      machine_model: h2Validation.normalized.machine_model,
      machine_serial_number: h2Validation.normalized.machine_serial_number,
      machine_year: h2Validation.normalized.machine_year,
      complaint: h2Validation.normalized.complaint,
      cause: h2Validation.normalized.cause,
      correction: h2Validation.normalized.correction,
      promised_at: h2Validation.normalized.promised_at,
      field_site_location: h2Validation.normalized.field_site_location ?? null,
      field_site_contact_name:
        h2Validation.normalized.field_site_contact_name ?? null,
      field_site_contact_phone:
        h2Validation.normalized.field_site_contact_phone ?? null,
      field_site_conditions_access_notes:
        h2Validation.normalized.field_site_conditions_access_notes ?? null,
      scheduled_start_at: scheduled_start_at || null,
      scheduled_end_at: scheduled_end_at || null,
      selected_job_code_id: selected_job_code_id || null,
      portal_request_id: portal_request_id || null,
      estimate_authorization_required: true,
      estimate_authorization_status: "pending",
      estimate_reauth_threshold_pct: 10,
    })
    .select()
    .single();

  if (error) {
    console.error("create error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "created",
    actor_id: actorId,
    new_stage: "request_received",
    metadata: {
      source_type: h2Validation.normalized.source_type,
      request_type: h2Validation.normalized.request_type,
      priority: h2Validation.normalized.priority,
    },
  });

  if (job.selected_job_code_id) {
    await populatePartsFromJobCode(
      supabase,
      job.id,
      job.selected_job_code_id as string,
      job.workspace_id as string,
    );
  }

  const { data: jobWithParts } = await supabase
    .from("service_jobs")
    .select("*")
    .eq("id", job.id)
    .single();

  return safeJsonOk({ job: jobWithParts ?? job }, origin, 201);
}

async function handlePopulateParts(
  supabase: SupabaseClient,
  body: RouterPayload,
  origin: string | null,
) {
  const { job_id } = body as { job_id?: string };
  if (!job_id) return safeJsonError("job_id required", 400, origin);

  const { data: job, error } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, selected_job_code_id")
    .eq("id", job_id)
    .single();
  if (error || !job) return safeJsonError("Job not found", 404, origin);
  if (!job.selected_job_code_id) {
    return safeJsonError("Job has no selected job code", 400, origin);
  }

  const { inserted } = await populatePartsFromJobCode(
    supabase,
    job.id,
    job.selected_job_code_id,
    job.workspace_id,
  );

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "parts_populated",
    metadata: { source: "job_code_template", lines_inserted: inserted },
  });

  return safeJsonOk({ populated: inserted }, origin);
}

async function handleUpdate(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const { id, ...raw } = body;
  if (!id) return safeJsonError("Missing job id", 400, origin);

  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (key === "action") continue;
    if (ALLOWED_UPDATE_FIELDS.has(key)) {
      fields[key] = raw[key];
    }
  }

  if (fields.lockout_tagout_completed === true) {
    fields.lockout_tagout_completed_by = actorId;
    fields.lockout_tagout_completed_at = new Date().toISOString();
  }

  if (Object.keys(fields).length === 0) {
    return safeJsonError("No valid fields to update", 400, origin);
  }

  const { data: before } = await supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (isMigratedGrappleProductionJob(before as Record<string, unknown> | null)) {
    return safeJsonError(
      "Migrated grapple production builds are read-only in service_jobs; use grapple_builds instead.",
      409,
      origin,
    );
  }

  const touchesH2Intake = Object.keys(fields).some((key) =>
    H2_INTAKE_FIELDS.has(key)
  );
  if (
    touchesH2Intake &&
    hasH2IntakeShape(before as Record<string, unknown> | null)
  ) {
    const merged = { ...(before as Record<string, unknown>), ...fields };
    const machine = await fetchH2IntakeMachine(supabase, merged.machine_id);
    const h2Validation = validateH2ServiceJobIntake(merged, machine);
    if (!h2Validation.ok) {
      return safeJsonErrorWithFields(
        "Service work-order intake fields cannot be made incomplete",
        422,
        origin,
        {
          code: "service_intake_incomplete",
          missing: h2Validation.missing,
          invalid: h2Validation.invalid,
          is_grapple_truck: h2Validation.is_grapple_truck,
          is_grapple_production_service_route:
            h2Validation.is_grapple_production_service_route,
        },
      );
    }

    for (const [key, value] of Object.entries(h2Validation.normalized)) {
      if (H2_INTAKE_FIELDS.has(key)) fields[key] = value;
    }
  }

  const { data: job, error } = await supabase
    .from("service_jobs")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("update error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "updated",
    actor_id: actorId,
    metadata: { updated_fields: Object.keys(fields) },
  });

  const newCode = fields.selected_job_code_id;
  if (
    newCode != null &&
    before &&
    String(newCode) !== String(before.selected_job_code_id ?? "")
  ) {
    const { inserted, cancelled } = await resyncPartsFromJobCode(
      supabase,
      id as string,
      newCode as string,
      job.workspace_id as string,
      "replace_cancelled_only",
    );
    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: job.id,
      event_type: "parts_resynced_from_job_code",
      actor_id: actorId,
      metadata: { trigger: "job_code_changed", inserted, cancelled },
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(fields, "promised_at") &&
    before &&
    fields.promised_at != null &&
    promisedAtChanged(before.promised_at, fields.promised_at)
  ) {
    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: job.id,
      event_type: "promised_date_changed",
      actor_id: actorId,
      metadata: {
        previous_promised_at: before.promised_at ?? null,
        new_promised_at: job.promised_at ?? fields.promised_at,
      },
    });
    await notifyPromisedDateChanged(
      supabase,
      job as Record<string, unknown>,
      before.promised_at,
      job.promised_at ?? fields.promised_at,
    );
  }

  return safeJsonOk({ job }, origin);
}

async function handleTransition(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const { id, to_stage, blocker_type, blocker_description } = body as {
    id?: string;
    to_stage?: string;
    blocker_type?: string;
    blocker_description?: string;
  };

  if (!id || !to_stage) {
    return safeJsonError("Missing id or to_stage", 400, origin);
  }

  const normalizedBlockerType = to_stage === "blocked_waiting"
    ? normalizeServiceHoldState(blocker_type)
    : null;

  if (to_stage === "blocked_waiting" && !normalizedBlockerType) {
    return safeJsonError(
      `blocker_type must be one of: ${SERVICE_HOLD_STATES.join(", ")}`,
      422,
      origin,
    );
  }

  const { data: job, error: fetchErr } = await supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !job) {
    return safeJsonError("Service job not found", 404, origin);
  }

  if (isMigratedGrappleProductionJob(job as Record<string, unknown>)) {
    return safeJsonError(
      "Migrated grapple production builds cannot transition through service_jobs; use grapple_builds instead.",
      409,
      origin,
    );
  }

  const fromStage = job.current_stage as string;

  const allowed = ALLOWED_TRANSITIONS[fromStage] ?? [];
  const isBlockTransition = to_stage === "blocked_waiting" &&
    BLOCKED_ALLOWED_FROM.has(fromStage);

  if (!allowed.includes(to_stage) && !isBlockTransition) {
    return safeJsonError(
      `Invalid transition: ${fromStage} -> ${to_stage}`,
      422,
      origin,
    );
  }

  if (to_stage === "in_progress") {
    const gate = evaluateEstimateAuthorizationGate({
      authorizationRequired: job.estimate_authorization_required,
      authorizationStatus: job.estimate_authorization_status,
      approvedAmount: job.approved_estimate_amount,
      approvedQuoteId: job.approved_estimate_quote_id,
      approvedApprovalId: job.approved_estimate_approval_id,
      thresholdPct: job.estimate_reauth_threshold_pct,
      scopeEstimateAmount: job.quote_total,
    });
    if (!gate.ok) {
      return safeJsonErrorWithFields(gate.reason, 422, origin, {
        estimate_authorization: estimateAuthorizationFields(gate),
      });
    }
  }

  if (["invoice_ready", "invoiced", "paid_closed"].includes(to_stage)) {
    const { gate, error: gateErr } = await runH5DocumentationGate(
      supabase,
      id,
      true,
    );
    if (gateErr) {
      return safeJsonError("H5 documentation gate failed", 400, origin);
    }
    if (!gate?.ok) {
      return safeJsonErrorWithFields(
        gate?.reason ?? "H5 documentation is incomplete.",
        422,
        origin,
        gateErrorPayload(gate),
      );
    }
  }

  if (to_stage === "blocked_waiting" && normalizedBlockerType) {
    await supabase.from("service_job_blockers").insert({
      workspace_id: job.workspace_id,
      job_id: id,
      blocker_type: normalizedBlockerType,
      description: blocker_description || null,
      created_by: actorId,
    });
  }

  if (fromStage === "blocked_waiting") {
    await supabase
      .from("service_job_blockers")
      .update({ resolved_at: new Date().toISOString(), resolved_by: actorId })
      .eq("job_id", id)
      .is("resolved_at", null);
  }

  const stageNow = new Date().toISOString();
  const updates: Record<string, unknown> = {
    current_stage: to_stage,
    current_stage_entered_at: stageNow,
  };
  if (to_stage === "paid_closed") {
    updates.closed_at = new Date().toISOString();
  }

  const { data: updated, error: updateErr } = await supabase
    .from("service_jobs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    console.error("transition error:", updateErr);
    return safeJsonError(updateErr.message, 400, origin);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: id,
    event_type: "stage_transition",
    actor_id: actorId,
    old_stage: fromStage,
    new_stage: to_stage,
    metadata: {
      ...(normalizedBlockerType
        ? {
          blocker_type: normalizedBlockerType,
          original_blocker_type: blocker_type,
          blocker_description,
        }
        : {}),
      ...(to_stage === "in_progress"
        ? { estimate_authorization_gate: "passed" }
        : {}),
    },
  });

  await notifyAfterStageChange(
    supabase,
    updated as Record<string, unknown>,
    to_stage,
    {
      blockerType: normalizedBlockerType,
      blockerDescription: blocker_description ?? null,
    },
  );

  if (to_stage === "invoice_ready") {
    const inv = await generateInvoiceForServiceJob(supabase, id);
    if (inv.error) console.warn("generateInvoiceForServiceJob:", inv.error);
  }

  if (to_stage === "diagnosis_selected" && updated.selected_job_code_id) {
    await populatePartsFromJobCode(
      supabase,
      id,
      updated.selected_job_code_id as string,
      updated.workspace_id as string,
    );
  }

  const { data: refreshed } = await supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .single();

  return safeJsonOk({ job: refreshed ?? updated }, origin);
}

async function handleGet(
  supabase: SupabaseClient,
  body: RouterPayload,
  origin: string | null,
) {
  const { id } = body;
  if (!id) return safeJsonError("Missing job id", 400, origin);

  const { data: job, error } = await fetchJobEnriched(supabase, id as string);

  if (error) {
    console.error("get error:", error);
    return safeJsonError("Service job not found", 404, origin);
  }

  return safeJsonOk({ job }, origin);
}

function sanitizeIlikeTerm(raw: string): string {
  return raw.replace(/[%_\\]/g, "").slice(0, 200);
}

async function handleList(
  supabase: SupabaseClient,
  body: RouterPayload,
  origin: string | null,
) {
  const {
    stage,
    stages,
    priority,
    branch_id,
    advisor_id,
    technician_id,
    status_flag,
    from_date,
    to_date,
    search,
    page = 1,
    per_page = 50,
    include_closed = false,
    include_grapple_migrated = false,
  } = body as Record<string, unknown>;

  let query = supabase
    .from("service_jobs")
    .select(
      `
      *,
      customer:crm_companies(id, name),
      machine:crm_equipment(id, make, model, serial_number, warranty_registered, warranty_registration_number, warranty_provider, warranty_start_date, warranty_end_date, warranty_coverage_terms, warranty_coverage_notes),
      advisor:profiles!service_jobs_advisor_id_fkey(id, full_name),
      technician:profiles!service_jobs_technician_id_fkey(id, full_name)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (!include_closed) {
    query = query.is("closed_at", null).is("deleted_at", null);
  }
  if (!include_grapple_migrated) {
    query = query.neq(
      "grapple_production_routing_status",
      "migrated_to_grapple_builds",
    );
  }

  if (stage) {
    query = query.eq("current_stage", stage as string);
  }
  if (Array.isArray(stages) && stages.length > 0) {
    query = query.in("current_stage", stages as string[]);
  }
  if (priority) {
    query = query.eq("priority", priority as string);
  }
  if (branch_id) {
    query = query.eq("branch_id", branch_id as string);
  }
  if (advisor_id) {
    query = query.eq("advisor_id", advisor_id as string);
  }
  if (technician_id) {
    query = query.eq("technician_id", technician_id as string);
  }
  if (status_flag) {
    query = query.contains("status_flags", [status_flag as string]);
  }
  if (from_date) {
    query = query.gte("created_at", from_date as string);
  }
  if (to_date) {
    query = query.lte("created_at", to_date as string);
  }
  if (search && typeof search === "string") {
    const term = sanitizeIlikeTerm(search);
    if (term.length > 0) {
      const p = `%${term}%`;
      query = query.or(
        `customer_problem_summary.ilike.${p},requested_by_name.ilike.${p}`,
      );
    }
  }

  const pageNum = Math.max(1, Number(page));
  const limit = Math.min(100, Math.max(1, Number(per_page)));
  const from = (pageNum - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data: jobs, error, count } = await query;

  if (error) {
    console.error("list error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  return safeJsonOk({
    jobs: jobs ?? [],
    total: count ?? 0,
    page: pageNum,
    per_page: limit,
  }, origin);
}

/** Reassign open jobs from a departing advisor/tech using branch pool UUIDs in service_branch_config. */
async function handleReassignPool(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const branch_id = body.branch_id as string | undefined;
  const from_user_id = body.from_user_id as string | undefined;
  const role = body.role as string | undefined;
  if (
    !branch_id || !from_user_id || (role !== "advisor" && role !== "technician")
  ) {
    return safeJsonError(
      "branch_id, from_user_id, and role (advisor|technician) required",
      400,
      origin,
    );
  }

  const { data: cfg, error: cfgErr } = await supabase
    .from("service_branch_config")
    .select("default_advisor_pool, default_technician_pool")
    .eq("branch_id", branch_id)
    .maybeSingle();
  if (cfgErr) return safeJsonError(cfgErr.message, 400, origin);
  if (!cfg) {
    return safeJsonError("No branch config for this branch", 404, origin);
  }

  const pool = role === "advisor"
    ? cfg.default_advisor_pool
    : cfg.default_technician_pool;
  const ids = Array.isArray(pool)
    ? pool.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const replacement = ids.find((id) => id !== from_user_id) ?? ids[0];
  if (!replacement) {
    return safeJsonError(
      "Pool is empty — add advisor/tech UUIDs in branch config",
      400,
      origin,
    );
  }

  const field = role === "advisor" ? "advisor_id" : "technician_id";

  const { data: updated, error } = await supabase
    .from("service_jobs")
    .update({ [field]: replacement })
    .eq("branch_id", branch_id)
    .eq(field, from_user_id)
    .is("closed_at", null)
    .select("id, workspace_id");

  if (error) return safeJsonError(error.message, 400, origin);

  for (const j of updated ?? []) {
    await supabase.from("service_job_events").insert({
      workspace_id: j.workspace_id,
      job_id: j.id,
      event_type: "reassigned_from_pool",
      actor_id: actorId,
      metadata: { from_user_id, replacement, role },
    });
  }

  return safeJsonOk({
    reassigned: (updated ?? []).length,
    replacement,
  }, origin);
}

async function handleResyncPartsFromJobCode(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const modeRaw = body.mode as string | undefined;
  const mode: "replace_cancelled_only" | "full" = modeRaw === "full"
    ? "full"
    : "replace_cancelled_only";
  if (!job_id) return safeJsonError("job_id required", 400, origin);

  const { data: job, error } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, selected_job_code_id")
    .eq("id", job_id)
    .single();
  if (error || !job?.selected_job_code_id) {
    return safeJsonError("Job not found or no selected job code", 400, origin);
  }

  const { inserted, cancelled } = await resyncPartsFromJobCode(
    supabase,
    job.id,
    job.selected_job_code_id,
    job.workspace_id,
    mode,
  );

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "parts_resynced_from_job_code",
    actor_id: actorId,
    metadata: { mode, inserted, cancelled },
  });

  return safeJsonOk({ inserted, cancelled, mode }, origin);
}

async function handleAssignTechnician(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const technician_user_id = body.technician_user_id as string | undefined;
  if (!job_id || !technician_user_id) {
    return safeJsonError("job_id and technician_user_id required", 400, origin);
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, technician_id")
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Job not found", 404, origin);

  if (job.technician_id === technician_user_id) {
    const { data: same } = await supabase.from("service_jobs").select("*").eq(
      "id",
      job_id,
    ).single();
    return safeJsonOk({ job: same }, origin);
  }

  const adjustWorkload = async (userId: string | null, delta: number) => {
    if (!userId) return;
    const { data: prof } = await supabase
      .from("technician_profiles")
      .select("id, active_workload")
      .eq("user_id", userId)
      .eq("workspace_id", job.workspace_id as string)
      .maybeSingle();
    if (!prof) return;
    await supabase
      .from("technician_profiles")
      .update({
        active_workload: Math.max(0, (prof.active_workload ?? 0) + delta),
        updated_at: new Date().toISOString(),
      })
      .eq("id", prof.id);
  };

  await adjustWorkload(job.technician_id as string | null, -1);
  await adjustWorkload(technician_user_id, 1);

  const { data: updated, error } = await supabase
    .from("service_jobs")
    .update({ technician_id: technician_user_id })
    .eq("id", job_id)
    .select()
    .single();

  if (error) return safeJsonError(error.message, 400, origin);

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job_id,
    event_type: "technician_assigned",
    actor_id: actorId,
    metadata: { technician_user_id },
  });

  return safeJsonOk({ job: updated }, origin);
}

async function handleLinkPortalRequest(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const portal_request_id = body.portal_request_id as string | undefined;
  if (!job_id || !portal_request_id) {
    return safeJsonError("job_id and portal_request_id required", 400, origin);
  }
  if (!isUuidString(job_id) || !isUuidString(portal_request_id)) {
    return safeJsonError(
      "job_id and portal_request_id must be valid UUIDs",
      400,
      origin,
    );
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, portal_request_id")
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Job not found", 404, origin);

  const { data: portalReq, error: pErr } = await supabase
    .from("service_requests")
    .select("id, workspace_id, service_job_id")
    .eq("id", portal_request_id)
    .single();
  if (pErr || !portalReq) {
    return safeJsonError("Portal service request not found", 404, origin);
  }
  if (portalReq.workspace_id !== job.workspace_id) {
    return safeJsonError(
      "Portal request is not in the same workspace as this job",
      400,
      origin,
    );
  }

  const prevOnJob = job.portal_request_id as string | null;
  const prevJobForPortal = portalReq.service_job_id as string | null;

  if (prevJobForPortal && prevJobForPortal !== job_id) {
    await supabase
      .from("service_jobs")
      .update({ portal_request_id: null })
      .eq("id", prevJobForPortal)
      .eq("portal_request_id", portal_request_id);
  }

  if (prevOnJob && prevOnJob !== portal_request_id) {
    await supabase
      .from("service_requests")
      .update({ service_job_id: null })
      .eq("id", prevOnJob);
  }

  const { error: uJob } = await supabase
    .from("service_jobs")
    .update({ portal_request_id })
    .eq("id", job_id);
  if (uJob) return safeJsonError(uJob.message, 400, origin);

  const { error: uPortal } = await supabase
    .from("service_requests")
    .update({ service_job_id: job_id })
    .eq("id", portal_request_id);
  if (uPortal) return safeJsonError(uPortal.message, 400, origin);

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id,
    event_type: "portal_request_linked",
    actor_id: actorId,
    metadata: {
      portal_request_id,
      previous_portal_request_id_on_job: prevOnJob,
      previous_job_for_portal_request: prevJobForPortal,
    },
  });

  const { data: full, error: gErr } = await fetchJobEnriched(supabase, job_id);
  if (gErr || !full) {
    return safeJsonError(gErr?.message ?? "Failed to load job", 400, origin);
  }
  return safeJsonOk({ job: full }, origin);
}

async function handleUnlinkPortalRequest(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  if (!job_id) return safeJsonError("job_id required", 400, origin);
  if (!isUuidString(job_id)) {
    return safeJsonError("job_id must be a valid UUID", 400, origin);
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, portal_request_id")
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Job not found", 404, origin);

  const prev = job.portal_request_id as string | null;
  if (!prev) {
    const { data: full, error: gErr } = await fetchJobEnriched(
      supabase,
      job_id,
    );
    if (gErr || !full) {
      return safeJsonError(gErr?.message ?? "Failed to load job", 400, origin);
    }
    return safeJsonOk({ job: full }, origin);
  }

  await supabase
    .from("service_requests")
    .update({ service_job_id: null })
    .eq("id", prev);

  const { error: uErr } = await supabase
    .from("service_jobs")
    .update({ portal_request_id: null })
    .eq("id", job_id);
  if (uErr) return safeJsonError(uErr.message, 400, origin);

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id,
    event_type: "portal_request_unlinked",
    actor_id: actorId,
    metadata: { portal_request_id: prev },
  });

  const { data: full, error: gErr } = await fetchJobEnriched(supabase, job_id);
  if (gErr || !full) {
    return safeJsonError(gErr?.message ?? "Failed to load job", 400, origin);
  }
  return safeJsonOk({ job: full }, origin);
}

async function handleSearchPortalOrders(
  supabase: SupabaseClient,
  body: RouterPayload,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const q = typeof body.q === "string" ? body.q : "";
  const term = sanitizeIlikeTerm(q);
  if (!job_id) return safeJsonError("job_id required", 400, origin);
  if (!isUuidString(job_id)) {
    return safeJsonError("job_id must be a valid UUID", 400, origin);
  }
  if (term.length < 2) {
    return safeJsonError("q must be at least 2 characters", 400, origin);
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id")
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Job not found", 404, origin);

  const { data: rows, error: rErr } = await supabase.rpc(
    "search_parts_orders_for_link",
    { p_workspace: job.workspace_id, p_term: term },
  );
  if (rErr) {
    console.error("search_parts_orders_for_link:", rErr);
    return safeJsonError(rErr.message, 400, origin);
  }

  const mapped = (rows as Record<string, unknown>[] | null ?? []).map((
    row,
  ) => ({
    id: row.id as string,
    status: row.status as string,
    fulfillment_run_id: row.fulfillment_run_id as string | null,
    created_at: row.created_at as string,
    portal_customers: {
      first_name: row.customer_first_name as string,
      last_name: row.customer_last_name as string,
      email: row.customer_email as string,
    },
  }));

  return safeJsonOk({ orders: mapped }, origin);
}

async function handleSubmitSegmentDiagnosis(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const segment_id = body.segment_id as string | undefined;
  if (!segment_id) return safeJsonError("segment_id required", 400, origin);
  if (!isUuidString(segment_id)) {
    return safeJsonError("segment_id must be a valid UUID", 400, origin);
  }

  const { data: segment, error: sErr } = await fetchSegment(
    supabase,
    segment_id,
  );
  if (sErr || !segment) return safeJsonError("Segment not found", 404, origin);

  const nowIso = new Date().toISOString();
  const fields: Record<string, unknown> = {
    diagnostic_signoff_status: "submitted",
    diagnostic_submitted_by: actorId,
    diagnostic_submitted_at: nowIso,
  };
  copyOptionalTextFields(body, fields, [
    "complaint",
    "cause",
    "correction",
    "labor_story_complaint_verification",
    "labor_story_diagnostic_steps",
    "labor_story_root_cause",
  ]);

  const merged = { ...(segment as Record<string, unknown>), ...fields };
  const missingDiagnostic = [
    "labor_story_complaint_verification",
    "labor_story_diagnostic_steps",
    "labor_story_root_cause",
  ].filter((field) => !isNonEmptyText(merged[field], 10));
  if (
    segment.h5_documentation_required !== false && missingDiagnostic.length > 0
  ) {
    return safeJsonErrorWithFields(
      "Diagnostic sign-off needs complaint verification, diagnostic steps, and root cause.",
      422,
      origin,
      { missing: missingDiagnostic },
    );
  }

  const { data: updated, error } = await supabase
    .from("service_job_segments")
    .update(fields)
    .eq("id", segment_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId: updated.workspace_id as string,
    jobId: updated.service_job_id as string,
    actorId,
    eventType: "segment_diagnosis_submitted",
    metadata: { segment_id, missing_resolved: missingDiagnostic.length === 0 },
  });

  return safeJsonOk({ segment: updated }, origin);
}

async function handleReviewSegmentDiagnosis(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const segment_id = body.segment_id as string | undefined;
  const decision = optionalString(body.decision);
  if (!segment_id || !decision) {
    return safeJsonError("segment_id and decision required", 400, origin);
  }
  if (!isUuidString(segment_id)) {
    return safeJsonError("segment_id must be a valid UUID", 400, origin);
  }
  if (!["approve", "return"].includes(decision)) {
    return safeJsonError("decision must be approve or return", 400, origin);
  }

  const { data: segment, error: sErr } = await fetchSegment(
    supabase,
    segment_id,
  );
  if (sErr || !segment) return safeJsonError("Segment not found", 404, origin);

  if (
    decision === "approve" && segment.diagnostic_signoff_status !== "submitted"
  ) {
    return safeJsonErrorWithFields(
      "Diagnostic approval requires a submitted diagnosis.",
      422,
      origin,
      { diagnostic_signoff_status: segment.diagnostic_signoff_status },
    );
  }

  if (decision === "approve") {
    const missingDiagnostic = [
      "labor_story_complaint_verification",
      "labor_story_diagnostic_steps",
      "labor_story_root_cause",
    ].filter((field) => !isNonEmptyText(segment[field], 10));
    if (missingDiagnostic.length > 0) {
      return safeJsonErrorWithFields(
        "Diagnostic approval needs complaint verification, diagnostic steps, and root cause.",
        422,
        origin,
        { missing: missingDiagnostic },
      );
    }
  }

  const nowIso = new Date().toISOString();
  const notes = optionalString(body.notes);
  const fields: Record<string, unknown> = {
    diagnostic_review_notes: notes,
  };
  if (decision === "approve") {
    fields.diagnostic_signoff_status = "approved";
    fields.diagnostic_approved_by = actorId;
    fields.diagnostic_approved_at = nowIso;
  } else {
    fields.diagnostic_signoff_status = "returned";
    fields.diagnostic_returned_by = actorId;
    fields.diagnostic_returned_at = nowIso;
  }

  const { data: updated, error } = await supabase
    .from("service_job_segments")
    .update(fields)
    .eq("id", segment_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId: updated.workspace_id as string,
    jobId: updated.service_job_id as string,
    actorId,
    eventType: decision === "approve"
      ? "segment_diagnosis_approved"
      : "segment_diagnosis_returned",
    metadata: { segment_id, notes },
  });

  return safeJsonOk({ segment: updated }, origin);
}

async function handleSignOffSegmentRepair(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const segment_id = body.segment_id as string | undefined;
  if (!segment_id) return safeJsonError("segment_id required", 400, origin);
  if (!isUuidString(segment_id)) {
    return safeJsonError("segment_id must be a valid UUID", 400, origin);
  }

  const { data: segment, error: sErr } = await fetchSegment(
    supabase,
    segment_id,
  );
  if (sErr || !segment) return safeJsonError("Segment not found", 404, origin);

  if (
    segment.h5_documentation_required !== false &&
    segment.diagnostic_signoff_status !== "approved"
  ) {
    return safeJsonErrorWithFields(
      "Repair sign-off is blocked until the diagnostic sign-off is approved.",
      422,
      origin,
      { diagnostic_signoff_status: segment.diagnostic_signoff_status },
    );
  }

  const nowIso = new Date().toISOString();
  const fields: Record<string, unknown> = {
    repair_signoff_status: "completed",
    repair_signed_off_by: actorId,
    repair_signed_off_at: nowIso,
  };

  copyOptionalTextFields(body, fields, H5_LABOR_STORY_FIELDS);
  copyOptionalTextFields(body, fields, [
    "lockout_tagout_notes",
    "warranty_parts_label",
    "warranty_parts_turn_in_notes",
  ]);
  const numericFields = [
    "hours_actual",
    "quoted_labor_hours",
    "estimated_hours",
    "overrun_threshold_pct",
  ];
  const invalidNumeric = validateOptionalNumberFields(body, numericFields);
  if (invalidNumeric.length > 0) {
    return safeJsonErrorWithFields(
      "H5 numeric fields must be finite numbers.",
      422,
      origin,
      { invalid: invalidNumeric },
    );
  }
  copyOptionalNumberFields(body, fields, numericFields);
  copyOptionalBooleanFields(body, fields, [
    "lockout_tagout_required",
    "lockout_tagout_completed",
    "warranty_parts_turn_in_required",
    "warranty_parts_turn_in_completed",
  ]);

  if (fields.lockout_tagout_completed === true) {
    fields.lockout_tagout_completed_by = actorId;
    fields.lockout_tagout_completed_at = nowIso;
  }
  if (fields.warranty_parts_turn_in_completed === true) {
    fields.warranty_parts_turn_in_completed_by = actorId;
    fields.warranty_parts_turn_in_completed_at = nowIso;
  }

  const merged = { ...(segment as Record<string, unknown>), ...fields };
  const story = validateH5LaborStory(merged);
  if (segment.h5_documentation_required !== false && !story.ok) {
    return safeJsonErrorWithFields(
      "Labor story does not meet the H5 quality standard.",
      422,
      origin,
      { missing: story.missing, field_lengths: story.fieldLengths },
    );
  }

  const { overrun } = segmentOverrunUpdateFields(
    segment as Record<string, unknown>,
    fields,
    nowIso,
  );

  const { data: updated, error } = await supabase
    .from("service_job_segments")
    .update(fields)
    .eq("id", segment_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId: updated.workspace_id as string,
    jobId: updated.service_job_id as string,
    actorId,
    eventType: "segment_repair_signed_off",
    metadata: { segment_id, overrun },
  });
  if (overrun.status === "overrun_unacknowledged") {
    await insertH5Event(supabase, {
      workspaceId: updated.workspace_id as string,
      jobId: updated.service_job_id as string,
      actorId,
      eventType: "segment_quoted_time_overrun_alert",
      metadata: { segment_id, overrun },
    });
  }

  return safeJsonOk({ segment: updated, overrun }, origin);
}

async function handleAcknowledgeSegmentOverrun(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const segment_id = body.segment_id as string | undefined;
  if (!segment_id) return safeJsonError("segment_id required", 400, origin);
  if (!isUuidString(segment_id)) {
    return safeJsonError("segment_id must be a valid UUID", 400, origin);
  }

  const { data: segment, error: sErr } = await fetchSegment(
    supabase,
    segment_id,
  );
  if (sErr || !segment) return safeJsonError("Segment not found", 404, origin);

  const nowIso = new Date().toISOString();
  const reason = optionalString(body.overrun_reason ?? body.reason);
  const current = calculateQuotedTimeOverrun({
    quotedLaborHours: segment.quoted_labor_hours,
    estimatedHours: segment.estimated_hours,
    actualHours: segment.hours_actual,
    thresholdPct: segment.overrun_threshold_pct,
    acknowledgedAt: nowIso,
  });

  if (current.status === "overrun_acknowledged" && !reason) {
    return safeJsonError(
      "overrun_reason required to acknowledge quoted-time overrun",
      400,
      origin,
    );
  }

  const fields: Record<string, unknown> = {
    overrun_status: current.status,
    overrun_reason: reason,
  };
  if (current.status === "overrun_acknowledged") {
    fields.overrun_acknowledged_by = actorId;
    fields.overrun_acknowledged_at = nowIso;
  }

  const { data: updated, error } = await supabase
    .from("service_job_segments")
    .update(fields)
    .eq("id", segment_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId: updated.workspace_id as string,
    jobId: updated.service_job_id as string,
    actorId,
    eventType: current.status === "overrun_acknowledged"
      ? "segment_quoted_time_overrun_acknowledged"
      : "segment_quoted_time_checked",
    metadata: { segment_id, overrun: current, reason },
  });

  return safeJsonOk({ segment: updated, overrun: current }, origin);
}

async function handleRecordSegmentLabor(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const segment_id = body.segment_id as string | undefined;
  if (!segment_id) return safeJsonError("segment_id required", 400, origin);
  if (!isUuidString(segment_id)) {
    return safeJsonError("segment_id must be a valid UUID", 400, origin);
  }

  const { data: segment, error: sErr } = await fetchSegment(
    supabase,
    segment_id,
  );
  if (sErr || !segment) return safeJsonError("Segment not found", 404, origin);

  const numericFields = [
    "hours_actual",
    "quoted_labor_hours",
    "estimated_hours",
    "overrun_threshold_pct",
  ];
  const invalidNumeric = validateOptionalNumberFields(body, numericFields);
  if (invalidNumeric.length > 0) {
    return safeJsonErrorWithFields(
      "H12 labor fields must be finite numbers.",
      422,
      origin,
      { invalid: invalidNumeric },
    );
  }

  const fields: Record<string, unknown> = {};
  copyOptionalNumberFields(body, fields, numericFields);
  copyOptionalTextFields(body, fields, [
    "complaint",
    "cause",
    "correction",
    "labor_story_complaint_verification",
    "labor_story_diagnostic_steps",
    "labor_story_root_cause",
  ]);

  if (Object.keys(fields).length === 0) {
    return safeJsonError(
      "At least one labor, meter-adjacent, or three-C field is required.",
      400,
      origin,
    );
  }

  const nowIso = new Date().toISOString();
  fields.last_activity_at = nowIso;

  const { overrun } = segmentOverrunUpdateFields(
    segment as Record<string, unknown>,
    fields,
    nowIso,
  );

  const { data: updated, error } = await supabase
    .from("service_job_segments")
    .update(fields)
    .eq("id", segment_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId: updated.workspace_id as string,
    jobId: updated.service_job_id as string,
    actorId,
    eventType: "segment_labor_recorded",
    metadata: {
      segment_id,
      hours_actual: fields.hours_actual ?? null,
      overrun,
      source: "h12_offline_field_replay",
    },
  });

  return safeJsonOk({ segment: updated, overrun }, origin);
}

async function handleRecordSegmentPhoto(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const segment_id = body.segment_id as string | undefined;
  const storage_path = optionalString(body.storage_path);
  const phase = normalizeH5PhotoPhase(body.phase);
  if (!segment_id || !storage_path || !phase) {
    return safeJsonError(
      "segment_id, storage_path, and phase (before|during|after) required",
      400,
      origin,
    );
  }
  if (!isUuidString(segment_id)) {
    return safeJsonError("segment_id must be a valid UUID", 400, origin);
  }

  const { data: segment, error: sErr } = await fetchSegment(
    supabase,
    segment_id,
  );
  if (sErr || !segment) return safeJsonError("Segment not found", 404, origin);

  const workspaceId = segment.workspace_id as string;
  const expectedPrefix =
    `${workspaceId}/service-jobs/${segment.service_job_id}/segments/${segment_id}/`;
  if (!storage_path.startsWith(expectedPrefix)) {
    return safeJsonError(
      "storage_path must use workspace/service-jobs/job/segments/segment prefix for this segment",
      400,
      origin,
    );
  }

  const category = normalizeH5PhotoCategory(body.category);
  const { data: photo, error } = await supabase
    .from("service_job_segment_photos")
    .insert({
      workspace_id: workspaceId,
      service_job_id: segment.service_job_id,
      service_job_segment_id: segment_id,
      phase,
      category,
      storage_bucket: "portal-service-photos",
      storage_path,
      caption: optionalString(body.caption),
      content_type: optionalString(body.content_type),
      uploaded_by: actorId,
      metadata: typeof body.metadata === "object" && body.metadata !== null
        ? body.metadata
        : {},
    })
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId,
    jobId: segment.service_job_id as string,
    actorId,
    eventType: "segment_photo_recorded",
    metadata: { segment_id, photo_id: photo.id, phase, category },
  });

  return safeJsonOk({ photo }, origin, 201);
}

async function handleReviewDocumentation(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const decision = optionalString(body.decision);
  if (!job_id || !decision) {
    return safeJsonError("job_id and decision required", 400, origin);
  }
  if (!isUuidString(job_id)) {
    return safeJsonError("job_id must be a valid UUID", 400, origin);
  }
  if (!["approve", "return"].includes(decision)) {
    return safeJsonError("decision must be approve or return", 400, origin);
  }

  const { data: job, error: jErr } = await fetchJobForH5(supabase, job_id);
  if (jErr || !job) return safeJsonError("Job not found", 404, origin);

  const nowIso = new Date().toISOString();
  const notes = optionalString(body.notes);
  if (decision === "approve") {
    const { gate, error: gateErr } = await runH5DocumentationGate(
      supabase,
      job_id,
      false,
    );
    if (gateErr) {
      return safeJsonError("H5 documentation gate failed", 400, origin);
    }
    if (!gate?.ok) {
      return safeJsonErrorWithFields(
        gate?.reason ?? "H5 documentation is incomplete.",
        422,
        origin,
        gateErrorPayload(gate),
      );
    }

    const { data: updated, error } = await supabase
      .from("service_jobs")
      .update({
        documentation_review_status: "approved",
        documentation_reviewed_by: actorId,
        documentation_reviewed_at: nowIso,
        documentation_review_notes: notes,
        documentation_return_reason: null,
      })
      .eq("id", job_id)
      .select()
      .single();
    if (error) return safeJsonError(error.message, 400, origin);

    await insertH5Event(supabase, {
      workspaceId: updated.workspace_id as string,
      jobId: job_id,
      actorId,
      eventType: "documentation_review_approved",
      metadata: { notes },
    });
    return safeJsonOk({ job: updated, documentation_gate: gate }, origin);
  }

  const returnReason = optionalString(body.return_reason ?? body.reason) ??
    notes;
  const oldStage = job.current_stage as string;
  const returnToTech = body.return_to_technician !== false &&
    !["invoiced", "paid_closed"].includes(oldStage) && !job.closed_at;
  const updates: Record<string, unknown> = {
    documentation_review_status: "returned",
    documentation_returned_by: actorId,
    documentation_returned_at: nowIso,
    documentation_return_reason: returnReason,
    documentation_review_notes: notes,
  };
  if (returnToTech) {
    updates.current_stage = "in_progress";
    updates.current_stage_entered_at = nowIso;
  }

  const { data: updated, error } = await supabase
    .from("service_jobs")
    .update(updates)
    .eq("id", job_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await insertH5Event(supabase, {
    workspaceId: updated.workspace_id as string,
    jobId: job_id,
    actorId,
    eventType: "documentation_review_returned",
    oldStage,
    newStage: returnToTech ? "in_progress" : oldStage,
    metadata: {
      notes,
      return_reason: returnReason,
      returned_to_technician: returnToTech,
    },
  });

  return safeJsonOk({ job: updated }, origin);
}

async function handleLinkComeback(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const original_job_id = body.original_job_id as string | undefined;
  const fault = normalizeH8ComebackFaultAttribution(
    body.fault_attribution ?? body.comeback_fault_attribution,
  );
  if (!job_id || !original_job_id || !fault) {
    return safeJsonError(
      "job_id, original_job_id, and fault_attribution are required",
      400,
      origin,
    );
  }
  if (!isUuidString(job_id) || !isUuidString(original_job_id)) {
    return safeJsonError(
      "job_id and original_job_id must be valid UUIDs",
      400,
      origin,
    );
  }
  if (job_id === original_job_id) {
    return safeJsonError("A comeback job cannot link to itself", 422, origin);
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select(
      "id, workspace_id, request_type, technician_id, comeback_fault_attribution",
    )
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Comeback job not found", 404, origin);
  if (job.request_type !== "comeback_rework") {
    return safeJsonError(
      "H8 comeback linking requires request_type=comeback_rework",
      422,
      origin,
    );
  }

  const { data: original, error: oErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, technician_id")
    .eq("id", original_job_id)
    .single();
  if (oErr || !original) {
    return safeJsonError("Original service job not found", 404, origin);
  }
  if (original.workspace_id !== job.workspace_id) {
    return safeJsonError(
      "Comeback and original job must be in the same workspace",
      422,
      origin,
    );
  }

  const responsibleSegmentId = optionalString(
    body.responsible_segment_id ?? body.comeback_responsible_segment_id,
  );
  let responsibleTechId = optionalString(
    body.responsible_technician_id ?? body.comeback_responsible_technician_id,
  ) ??
    (fault === "qep_fault" ? original.technician_id as string | null : null);

  if (responsibleSegmentId) {
    if (!isUuidString(responsibleSegmentId)) {
      return safeJsonError(
        "responsible_segment_id must be a valid UUID",
        400,
        origin,
      );
    }
    const { data: segment, error: sErr } = await supabase
      .from("service_job_segments")
      .select("id, workspace_id, service_job_id, technician_id")
      .eq("id", responsibleSegmentId)
      .single();
    if (sErr || !segment) {
      return safeJsonError("Responsible segment not found", 404, origin);
    }
    if (
      segment.workspace_id !== job.workspace_id ||
      segment.service_job_id !== original_job_id
    ) {
      return safeJsonError(
        "Responsible segment must belong to the original work order",
        422,
        origin,
      );
    }
    responsibleTechId = responsibleTechId ??
      segment.technician_id as string | null;
  }

  if (fault === "qep_fault" && !responsibleTechId) {
    return safeJsonError(
      "QEP-fault comebacks require a responsible technician",
      422,
      origin,
    );
  }
  if (
    job.comeback_fault_attribution === "qep_fault" && fault !== "qep_fault"
  ) {
    return safeJsonError(
      "QEP-fault comeback no-rebill attribution cannot be reclassified by link_comeback; create an explicit reversal workflow to restore billing rows safely",
      409,
      origin,
    );
  }

  const nowIso = new Date().toISOString();
  const noRebill = h8NoRebillFieldsForFault(fault);
  const updates: Record<string, unknown> = {
    original_service_job_id: original_job_id,
    comeback_fault_attribution: fault,
    comeback_responsible_technician_id: responsibleTechId,
    comeback_responsible_segment_id: responsibleSegmentId,
    comeback_attributed_by: actorId,
    comeback_attributed_at: nowIso,
    comeback_notes: optionalString(body.notes ?? body.comeback_notes),
    ...noRebill,
  };

  const { data: updated, error: uErr } = await supabase
    .from("service_jobs")
    .update(updates)
    .eq("id", job_id)
    .select()
    .single();
  if (uErr) return safeJsonError(uErr.message, 400, origin);

  if (fault === "qep_fault") {
    const internalFields = h8PayerBillingFields("qep_internal");
    const { data: quoteIds } = await supabase
      .from("service_quotes")
      .select("id")
      .eq("job_id", job_id);
    const ids = (quoteIds ?? []).map((q) => q.id as string);
    if (ids.length > 0) {
      await supabase
        .from("service_quote_lines")
        .update({
          payer_type: "qep_internal",
          warranty_claim_id: null,
          payer_notes: "H8 QEP-fault comeback: no customer rebill.",
        })
        .in("quote_id", ids);
    }
    await supabase
      .from("service_job_segments")
      .update({
        revenue_type: "internal",
        billing_basis: "no_charge",
        billed_status: "billing_hold",
      })
      .eq("service_job_id", job_id)
      .is("deleted_at", null);
    await supabase
      .from("service_labor_ledger")
      .update({
        ...internalFields,
        payer_type: "qep_internal",
        warranty_claim_id: null,
        payer_notes: "H8 QEP-fault comeback: QEP absorbs labor.",
      })
      .eq("service_job_id", job_id)
      .is("deleted_at", null);
    await supabase
      .from("service_billing_rows")
      .update({
        ...internalFields,
        payer_type: "qep_internal",
        warranty_claim_id: null,
        payer_notes: "H8 QEP-fault comeback: QEP absorbs parts/other.",
      })
      .eq("service_job_id", job_id)
      .is("deleted_at", null);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id,
    event_type: "h8_comeback_linked",
    actor_id: actorId,
    metadata: {
      original_service_job_id: original_job_id,
      fault_attribution: fault,
      responsible_technician_id: responsibleTechId,
      responsible_segment_id: responsibleSegmentId,
      no_rebill: fault === "qep_fault",
    },
  });

  return safeJsonOk({ job: updated }, origin);
}

async function resolveH8LineContext(
  supabase: SupabaseClient,
  lineType: string,
  lineId: string,
): Promise<
  {
    table:
      | "service_quote_lines"
      | "service_labor_ledger"
      | "service_billing_rows";
    workspaceId: string;
    jobId: string;
  } | { error: string; status: number }
> {
  if (lineType === "quote_line") {
    const { data: line, error } = await supabase
      .from("service_quote_lines")
      .select("id, workspace_id, quote_id")
      .eq("id", lineId)
      .single();
    if (error || !line) return { error: "Quote line not found", status: 404 };
    const { data: quote, error: qErr } = await supabase
      .from("service_quotes")
      .select("id, workspace_id, job_id")
      .eq("id", line.quote_id)
      .single();
    if (qErr || !quote) return { error: "Quote header not found", status: 404 };
    return {
      table: "service_quote_lines",
      workspaceId: quote.workspace_id as string,
      jobId: quote.job_id as string,
    };
  }

  if (lineType === "labor_ledger") {
    const { data: row, error } = await supabase
      .from("service_labor_ledger")
      .select("id, workspace_id, service_job_id")
      .eq("id", lineId)
      .single();
    if (error || !row) {
      return { error: "Labor ledger row not found", status: 404 };
    }
    return {
      table: "service_labor_ledger",
      workspaceId: row.workspace_id as string,
      jobId: row.service_job_id as string,
    };
  }

  if (lineType === "billing_row") {
    const { data: row, error } = await supabase
      .from("service_billing_rows")
      .select("id, workspace_id, service_job_id")
      .eq("id", lineId)
      .single();
    if (error || !row) return { error: "Billing row not found", status: 404 };
    return {
      table: "service_billing_rows",
      workspaceId: row.workspace_id as string,
      jobId: row.service_job_id as string,
    };
  }

  return {
    error: "line_type must be quote_line, labor_ledger, or billing_row",
    status: 400,
  };
}

async function handleSetLinePayer(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const lineType = optionalString(body.line_type);
  const lineId = optionalString(body.line_id);
  const payerType = normalizeH8PayerType(body.payer_type);
  if (!lineType || !lineId || !payerType) {
    return safeJsonError(
      "line_type, line_id, and payer_type are required",
      400,
      origin,
    );
  }
  if (!isUuidString(lineId)) {
    return safeJsonError("line_id must be a valid UUID", 400, origin);
  }

  const ctx = await resolveH8LineContext(supabase, lineType, lineId);
  if ("error" in ctx) return safeJsonError(ctx.error, ctx.status, origin);

  const warrantyClaimId = optionalString(body.warranty_claim_id);
  if (warrantyClaimId) {
    if (!isUuidString(warrantyClaimId)) {
      return safeJsonError(
        "warranty_claim_id must be a valid UUID",
        400,
        origin,
      );
    }
    const { data: claim, error: cErr } = await supabase
      .from("service_warranty_claims")
      .select("id, workspace_id, service_job_id")
      .eq("id", warrantyClaimId)
      .single();
    if (cErr || !claim) {
      return safeJsonError("Warranty claim not found", 404, origin);
    }
    if (
      claim.workspace_id !== ctx.workspaceId ||
      claim.service_job_id !== ctx.jobId
    ) {
      return safeJsonError(
        "Warranty claim must belong to the same service job and workspace",
        422,
        origin,
      );
    }
  }

  const fields: Record<string, unknown> = {
    payer_type: payerType,
    warranty_claim_id: payerType === "warranty_claim" ? warrantyClaimId : null,
    payer_notes: optionalString(body.payer_notes ?? body.notes),
  };
  if (ctx.table !== "service_quote_lines") {
    Object.assign(fields, h8PayerBillingFields(payerType));
  }

  const { data: updated, error } = await supabase
    .from(ctx.table)
    .update(fields)
    .eq("id", lineId)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  await supabase.from("service_job_events").insert({
    workspace_id: ctx.workspaceId,
    job_id: ctx.jobId,
    event_type: "h8_line_payer_set",
    actor_id: actorId,
    metadata: {
      line_type: lineType,
      line_id: lineId,
      payer_type: payerType,
      warranty_claim_id: warrantyClaimId,
    },
  });

  return safeJsonOk({ line: updated }, origin);
}

function centsFromMoney(value: unknown): number {
  const n = optionalNumber(value) ?? 0;
  return Math.max(0, Math.round(n * 100));
}

async function insertWarrantyClaimEvent(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    claimId: string;
    jobId: string;
    actorId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await supabase.from("service_warranty_claim_events").insert({
    workspace_id: params.workspaceId,
    warranty_claim_id: params.claimId,
    service_job_id: params.jobId,
    event_type: params.eventType,
    from_status: params.fromStatus ?? null,
    to_status: params.toStatus ?? null,
    actor_id: params.actorId,
    notes: params.notes ?? null,
    metadata: params.metadata ?? {},
  });
}

async function handleAssembleWarrantyClaim(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  if (!job_id) return safeJsonError("job_id required", 400, origin);
  if (!isUuidString(job_id)) {
    return safeJsonError("job_id must be a valid UUID", 400, origin);
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select(
      "id, workspace_id, customer_id, machine_id, original_service_job_id, complaint, cause, correction",
    )
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Service job not found", 404, origin);

  let claim = null as Record<string, unknown> | null;
  let createdClaim = false;
  const requestedClaimId = optionalString(
    body.warranty_claim_id ?? body.claim_id,
  );
  if (requestedClaimId) {
    if (!isUuidString(requestedClaimId)) {
      return safeJsonError(
        "warranty_claim_id must be a valid UUID",
        400,
        origin,
      );
    }
    const { data, error } = await supabase
      .from("service_warranty_claims")
      .select("*")
      .eq("id", requestedClaimId)
      .single();
    if (error || !data) {
      return safeJsonError("Warranty claim not found", 404, origin);
    }
    if (
      data.workspace_id !== job.workspace_id || data.service_job_id !== job.id
    ) {
      return safeJsonError(
        "Warranty claim does not belong to this service job",
        422,
        origin,
      );
    }
    claim = data as Record<string, unknown>;
  } else {
    const { data } = await supabase
      .from("service_warranty_claims")
      .select("*")
      .eq("service_job_id", job_id)
      .neq("status", "cancelled")
      .is("deleted_at", null)
      .maybeSingle();
    claim = data as Record<string, unknown> | null;
  }

  const claimFields: Record<string, unknown> = {
    workspace_id: job.workspace_id,
    service_job_id: job.id,
    machine_id: job.machine_id,
    customer_id: job.customer_id,
    original_service_job_id: job.original_service_job_id,
    claim_number: optionalString(body.claim_number) ?? claim?.claim_number ??
      null,
    oem_name: optionalString(body.oem_name) ?? claim?.oem_name ?? null,
    oem_reference: optionalString(body.oem_reference) ?? claim?.oem_reference ??
      null,
    complaint: optionalString(body.complaint) ?? job.complaint ?? null,
    cause: optionalString(body.cause) ?? job.cause ?? null,
    correction: optionalString(body.correction) ?? job.correction ?? null,
    updated_by: actorId,
    metadata: typeof body.metadata === "object" && body.metadata !== null
      ? body.metadata
      : claim?.metadata ?? {},
  };

  if (claim?.id) {
    const { data, error } = await supabase
      .from("service_warranty_claims")
      .update(claimFields)
      .eq("id", claim.id as string)
      .select()
      .single();
    if (error) return safeJsonError(error.message, 400, origin);
    claim = data as Record<string, unknown>;
  } else {
    const { data, error } = await supabase
      .from("service_warranty_claims")
      .insert({ ...claimFields, status: "draft", created_by: actorId })
      .select()
      .single();
    if (error) return safeJsonError(error.message, 400, origin);
    claim = data as Record<string, unknown>;
    createdClaim = true;
  }

  const ws = job.workspace_id as string;
  const claimId = claim.id as string;
  const claimRows: Record<string, unknown>[] = [];

  await supabase
    .from("service_warranty_claim_lines")
    .update({ included: false })
    .eq("warranty_claim_id", claimId);

  const { data: quoteIds } = await supabase.from("service_quotes").select("id")
    .eq("job_id", job_id);
  const quoteIdList = (quoteIds ?? []).map((q) => q.id as string);
  if (quoteIdList.length > 0) {
    const { data: quoteLines } = await supabase
      .from("service_quote_lines")
      .select(
        "id, workspace_id, line_type, description, quantity, extended_price",
      )
      .in("quote_id", quoteIdList)
      .eq("payer_type", "warranty_claim");
    for (const line of quoteLines ?? []) {
      claimRows.push({
        workspace_id: ws,
        warranty_claim_id: claimId,
        service_job_id: job_id,
        service_quote_line_id: line.id,
        source_table: "service_quote_lines",
        source_id: line.id,
        line_type: line.line_type ?? "quote_line",
        description: line.description,
        quantity: line.quantity ?? 1,
        amount_cents: centsFromMoney(line.extended_price),
        cost_cents: 0,
        payer_type: "warranty_claim",
        included: true,
        metadata: { source: "quote_line" },
      });
    }
  }

  const { data: laborRows } = await supabase
    .from("service_labor_ledger")
    .select(
      "id, service_job_segment_id, actual_hours, billable_hours, labor_sale_cents, labor_cost_cents, notes",
    )
    .eq("service_job_id", job_id)
    .is("deleted_at", null)
    .or("payer_type.eq.warranty_claim,revenue_type.eq.warranty");
  for (const row of laborRows ?? []) {
    claimRows.push({
      workspace_id: ws,
      warranty_claim_id: claimId,
      service_job_id: job_id,
      service_job_segment_id: row.service_job_segment_id,
      service_labor_ledger_id: row.id,
      source_table: "service_labor_ledger",
      source_id: row.id,
      line_type: "labor",
      description: row.notes ?? "Warranty labor",
      quantity: row.billable_hours ?? row.actual_hours ?? 1,
      amount_cents: row.labor_sale_cents ?? 0,
      cost_cents: row.labor_cost_cents ?? 0,
      payer_type: "warranty_claim",
      included: true,
      metadata: {
        actual_hours: row.actual_hours,
        billable_hours: row.billable_hours,
      },
    });
  }

  const { data: billingRows } = await supabase
    .from("service_billing_rows")
    .select(
      "id, service_job_segment_id, row_type, description, quantity, extended_price_cents, extended_cost_cents, metadata",
    )
    .eq("service_job_id", job_id)
    .is("deleted_at", null)
    .or("payer_type.eq.warranty_claim,revenue_type.eq.warranty");
  for (const row of billingRows ?? []) {
    claimRows.push({
      workspace_id: ws,
      warranty_claim_id: claimId,
      service_job_id: job_id,
      service_job_segment_id: row.service_job_segment_id,
      service_billing_row_id: row.id,
      source_table: "service_billing_rows",
      source_id: row.id,
      line_type: row.row_type ?? "billing_row",
      description: row.description,
      quantity: row.quantity ?? 1,
      amount_cents: row.extended_price_cents ?? 0,
      cost_cents: row.extended_cost_cents ?? 0,
      payer_type: "warranty_claim",
      included: true,
      metadata: row.metadata ?? {},
    });
  }

  const { data: turnInSegments } = await supabase
    .from("service_job_segments")
    .select(
      "id, segment_number, description, warranty_parts_turn_in_required, warranty_parts_turn_in_completed, warranty_parts_label, warranty_parts_turn_in_completed_at, warranty_parts_turn_in_notes",
    )
    .eq("service_job_id", job_id)
    .is("deleted_at", null)
    .eq("warranty_parts_turn_in_required", true);
  for (const segment of turnInSegments ?? []) {
    claimRows.push({
      workspace_id: ws,
      warranty_claim_id: claimId,
      service_job_id: job_id,
      service_job_segment_id: segment.id,
      source_table: "service_job_segments",
      source_id: segment.id,
      line_type: "warranty_part_turn_in",
      description: segment.description ??
        `Warranty parts turn-in segment ${segment.segment_number}`,
      quantity: 1,
      amount_cents: 0,
      cost_cents: 0,
      payer_type: "warranty_claim",
      included: true,
      metadata: {
        warranty_parts_turn_in_completed:
          segment.warranty_parts_turn_in_completed,
        warranty_parts_label: segment.warranty_parts_label,
        warranty_parts_turn_in_completed_at:
          segment.warranty_parts_turn_in_completed_at,
        warranty_parts_turn_in_notes: segment.warranty_parts_turn_in_notes,
      },
    });
  }

  if (claimRows.length > 0) {
    const { error } = await supabase
      .from("service_warranty_claim_lines")
      .upsert(claimRows, {
        onConflict: "warranty_claim_id,source_table,source_id",
      });
    if (error) return safeJsonError(error.message, 400, origin);

    const quoteLineIds = claimRows.filter((r) =>
      r.source_table === "service_quote_lines"
    ).map((r) => r.source_id as string);
    if (quoteLineIds.length > 0) {
      await supabase.from("service_quote_lines").update({
        warranty_claim_id: claimId,
        payer_type: "warranty_claim",
      }).in("id", quoteLineIds);
    }
    const laborIds = claimRows.filter((r) =>
      r.source_table === "service_labor_ledger"
    ).map((r) => r.source_id as string);
    if (laborIds.length > 0) {
      await supabase.from("service_labor_ledger").update({
        warranty_claim_id: claimId,
        payer_type: "warranty_claim",
        revenue_type: "warranty",
        billing_basis: "warranty",
      }).in("id", laborIds);
    }
    const billingIds = claimRows.filter((r) =>
      r.source_table === "service_billing_rows"
    ).map((r) => r.source_id as string);
    if (billingIds.length > 0) {
      await supabase.from("service_billing_rows").update({
        warranty_claim_id: claimId,
        payer_type: "warranty_claim",
        revenue_type: "warranty",
        billing_basis: "warranty",
      }).in("id", billingIds);
    }
  }

  const requestedAmountCents = claimRows.reduce(
    (sum, row) => sum + Number(row.amount_cents ?? 0),
    0,
  );
  const { data: refreshed, error: refreshErr } = await supabase
    .from("service_warranty_claims")
    .update({
      requested_amount_cents: requestedAmountCents,
      updated_by: actorId,
    })
    .eq("id", claimId)
    .select()
    .single();
  if (refreshErr) return safeJsonError(refreshErr.message, 400, origin);

  await insertWarrantyClaimEvent(supabase, {
    workspaceId: ws,
    claimId,
    jobId: job_id,
    actorId,
    eventType: "assembled",
    metadata: {
      included_line_count: claimRows.length,
      requested_amount_cents: requestedAmountCents,
    },
  });
  await supabase.from("service_job_events").insert({
    workspace_id: ws,
    job_id,
    event_type: "h8_warranty_claim_assembled",
    actor_id: actorId,
    metadata: {
      warranty_claim_id: claimId,
      included_line_count: claimRows.length,
      requested_amount_cents: requestedAmountCents,
    },
  });

  const { data: lines } = await supabase
    .from("service_warranty_claim_lines")
    .select("*")
    .eq("warranty_claim_id", claimId)
    .eq("included", true);

  return safeJsonOk(
    { claim: refreshed, lines: lines ?? [] },
    origin,
    createdClaim ? 201 : 200,
  );
}

async function handleUpdateWarrantyClaimStatus(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const claimId = optionalString(body.warranty_claim_id ?? body.claim_id);
  const toStatus = normalizeH8WarrantyClaimStatus(body.status);
  if (!claimId || !toStatus) {
    return safeJsonError(
      "warranty_claim_id and valid status are required",
      400,
      origin,
    );
  }
  if (!isUuidString(claimId)) {
    return safeJsonError("warranty_claim_id must be a valid UUID", 400, origin);
  }

  const { data: claim, error: cErr } = await supabase
    .from("service_warranty_claims")
    .select("*")
    .eq("id", claimId)
    .single();
  if (cErr || !claim) {
    return safeJsonError("Warranty claim not found", 404, origin);
  }

  const fromStatus = normalizeH8WarrantyClaimStatus(claim.status) ?? "draft";
  if (!canTransitionH8WarrantyClaim(fromStatus, toStatus)) {
    return safeJsonError(
      `Invalid warranty claim transition: ${fromStatus} -> ${toStatus}`,
      422,
      origin,
    );
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: toStatus,
    updated_by: actorId,
    oem_reference: optionalString(body.oem_reference) ?? claim.oem_reference,
  };
  const approvedCents = body.approved_amount_cents ??
    (body.approved_amount != null
      ? centsFromMoney(body.approved_amount)
      : undefined);
  const paidCents = body.paid_amount_cents ??
    (body.paid_amount != null ? centsFromMoney(body.paid_amount) : undefined);
  if (approvedCents !== undefined) {
    updates.approved_amount_cents = Number(approvedCents);
  }
  if (paidCents !== undefined) updates.paid_amount_cents = Number(paidCents);
  if (body.denied_reason != null || body.denial_reason != null) {
    updates.denied_reason = optionalString(
      body.denied_reason ?? body.denial_reason,
    );
  }

  if (toStatus === "submitted" && !claim.submitted_at) {
    updates.submitted_at = nowIso;
    updates.submitted_by = actorId;
  }
  if (toStatus === "oem_evaluation" && !claim.oem_evaluation_started_at) {
    updates.oem_evaluation_started_at = nowIso;
  }
  if (toStatus === "approved" && !claim.approved_at) {
    updates.approved_at = nowIso;
  }
  if (toStatus === "denied" && !claim.denied_at) {
    updates.denied_at = nowIso;
    updates.closed_at = nowIso;
  }
  if (toStatus === "paid" && !claim.paid_at) {
    updates.paid_at = nowIso;
    updates.closed_at = nowIso;
  }
  if (toStatus === "cancelled" && !claim.closed_at) updates.closed_at = nowIso;

  const { data: updated, error } = await supabase
    .from("service_warranty_claims")
    .update(updates)
    .eq("id", claimId)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  const notes = optionalString(body.notes);
  await insertWarrantyClaimEvent(supabase, {
    workspaceId: updated.workspace_id as string,
    claimId,
    jobId: updated.service_job_id as string,
    actorId,
    eventType: "status_changed",
    fromStatus,
    toStatus,
    notes,
    metadata: {
      oem_reference: updates.oem_reference,
      approved_amount_cents: updates.approved_amount_cents,
      paid_amount_cents: updates.paid_amount_cents,
      denied_reason: updates.denied_reason,
    },
  });
  await supabase.from("service_job_events").insert({
    workspace_id: updated.workspace_id,
    job_id: updated.service_job_id,
    event_type: "h8_warranty_claim_status_changed",
    actor_id: actorId,
    metadata: {
      warranty_claim_id: claimId,
      from_status: fromStatus,
      to_status: toStatus,
      notes,
    },
  });

  return safeJsonOk({ claim: updated }, origin);
}

async function handleRegisterMachineWarranty(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const machineId = optionalString(body.machine_id);
  if (!machineId) return safeJsonError("machine_id required", 400, origin);
  if (!isUuidString(machineId)) {
    return safeJsonError("machine_id must be a valid UUID", 400, origin);
  }

  const startDate = optionalString(body.warranty_start_date ?? body.start_date);
  const endDate = optionalString(body.warranty_end_date ?? body.end_date);
  const warrantyRegistered = body.warranty_registered === false ? false : true;
  const coverageNotes = typeof body.warranty_coverage_notes === "object" &&
      body.warranty_coverage_notes !== null
    ? body.warranty_coverage_notes
    : typeof body.coverage_notes === "object" &&
        body.coverage_notes !== null
    ? body.coverage_notes
    : {};
  const registrationNumber = optionalString(
    body.warranty_registration_number ?? body.registration_number,
  );
  const provider = optionalString(body.warranty_provider ?? body.provider);
  const coverageTerms = optionalString(
    body.warranty_coverage_terms ?? body.coverage_terms,
  );
  const warrantyType = optionalString(body.warranty_type) ?? "basic";
  const nowIso = new Date().toISOString();

  const maxHoursInput = body.warranty_max_hours ?? body.max_hours;
  const maxHours = maxHoursInput == null ? null : Number(maxHoursInput);
  if (maxHours !== null && !Number.isFinite(maxHours)) {
    return safeJsonError("warranty_max_hours must be numeric", 400, origin);
  }
  const maxMonthsInput = body.warranty_max_months ?? body.max_months;
  const maxMonths = maxMonthsInput == null ? null : Number(maxMonthsInput);
  if (maxMonths !== null && !Number.isInteger(maxMonths)) {
    return safeJsonError("warranty_max_months must be an integer", 400, origin);
  }

  const { data: baseMachine, error: machineError } = await supabase
    .from("qrm_equipment")
    .select("id, workspace_id")
    .eq("id", machineId)
    .single();
  if (machineError || !baseMachine) {
    return safeJsonError("Machine not found", 404, origin);
  }

  if (!warrantyRegistered) {
    await supabase
      .from("equipment_warranty_terms")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("equipment_id", machineId)
      .eq("workspace_id", baseMachine.workspace_id)
      .is("deleted_at", null);
  } else {
    if (!startDate) {
      return safeJsonError("warranty_start_date required", 400, origin);
    }
    const termFields: Record<string, unknown> = {
      workspace_id: baseMachine.workspace_id,
      equipment_id: machineId,
      warranty_type: warrantyType,
      max_hours: maxHours,
      max_months: maxMonths,
      start_date: startDate,
      end_date: endDate,
      provider,
      contract_number: registrationNumber,
      coverage_terms: coverageTerms,
      coverage_notes: coverageNotes,
      registered_by: actorId,
      registered_at: nowIso,
    };
    const warrantyTermId = optionalString(body.warranty_term_id);
    if (warrantyTermId) {
      if (!isUuidString(warrantyTermId)) {
        return safeJsonError(
          "warranty_term_id must be a valid UUID",
          400,
          origin,
        );
      }
      const { error: termError } = await supabase
        .from("equipment_warranty_terms")
        .update({ ...termFields, updated_at: nowIso })
        .eq("id", warrantyTermId)
        .eq("equipment_id", machineId)
        .eq("workspace_id", baseMachine.workspace_id)
        .is("deleted_at", null);
      if (termError) return safeJsonError(termError.message, 400, origin);
    } else {
      const { error: termError } = await supabase
        .from("equipment_warranty_terms")
        .insert(termFields);
      if (termError) return safeJsonError(termError.message, 400, origin);
    }
  }

  const { data: machine, error } = await supabase
    .from("crm_equipment")
    .select(
      "id, workspace_id, make, model, serial_number, warranty_registered, warranty_registration_number, warranty_provider, warranty_start_date, warranty_end_date, warranty_coverage_terms, warranty_coverage_notes",
    )
    .eq("id", machineId)
    .single();
  if (error) return safeJsonError(error.message, 400, origin);

  const jobId = optionalString(body.job_id);
  if (jobId && isUuidString(jobId)) {
    await supabase.from("service_job_events").insert({
      workspace_id: machine.workspace_id,
      job_id: jobId,
      event_type: warrantyRegistered
        ? "h8_machine_warranty_registered"
        : "h8_machine_warranty_unregistered",
      actor_id: actorId,
      metadata: {
        machine_id: machineId,
        warranty_registration_number: registrationNumber,
        warranty_provider: provider,
        warranty_start_date: startDate,
        warranty_end_date: endDate,
        warranty_type: warrantyType,
      },
    });
  }

  return safeJsonOk({ machine }, origin);
}

async function handleLinkFulfillmentRun(
  supabase: SupabaseClient,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const job_id = body.job_id as string | undefined;
  const rawRun = body.fulfillment_run_id;
  const hasKey = Object.prototype.hasOwnProperty.call(
    body,
    "fulfillment_run_id",
  );
  if (!job_id) {
    return safeJsonError("job_id required", 400, origin);
  }
  if (!isUuidString(job_id)) {
    return safeJsonError("job_id must be a valid UUID", 400, origin);
  }

  let fulfillment_run_id: string | null;
  if (!hasKey) {
    return safeJsonError(
      "fulfillment_run_id required (UUID or null to unlink)",
      400,
      origin,
    );
  }
  if (rawRun === null || rawRun === "") {
    fulfillment_run_id = null;
  } else if (typeof rawRun === "string") {
    fulfillment_run_id = rawRun.trim();
    if (!fulfillment_run_id) fulfillment_run_id = null;
  } else {
    return safeJsonError(
      "fulfillment_run_id must be a string UUID or null",
      400,
      origin,
    );
  }

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, fulfillment_run_id")
    .eq("id", job_id)
    .single();
  if (jErr || !job) return safeJsonError("Job not found", 404, origin);

  const ws = job.workspace_id as string;
  const previousRun = job.fulfillment_run_id as string | null;

  if (fulfillment_run_id !== null && !isUuidString(fulfillment_run_id)) {
    return safeJsonError(
      "fulfillment_run_id must be a valid UUID",
      400,
      origin,
    );
  }

  if (fulfillment_run_id !== null && fulfillment_run_id === previousRun) {
    const { data: full, error: sameErr } = await fetchJobEnriched(
      supabase,
      job_id,
    );
    if (sameErr || !full) {
      return safeJsonError(
        sameErr?.message ?? "Failed to load job",
        400,
        origin,
      );
    }
    return safeJsonOk({ job: full }, origin);
  }

  if (fulfillment_run_id === null) {
    const { error: uErr } = await supabase
      .from("service_jobs")
      .update({ fulfillment_run_id: null })
      .eq("id", job_id);
    if (uErr) return safeJsonError(uErr.message, 400, origin);

    if (previousRun) {
      await supabase.from("parts_fulfillment_events").insert({
        workspace_id: ws,
        fulfillment_run_id: previousRun,
        event_type: "service_job_unlinked",
        payload: {
          service_job_id: job_id,
          actor_id: actorId,
          audit_channel: "shop",
        },
      });
    }
    await supabase.from("service_job_events").insert({
      workspace_id: ws,
      job_id,
      event_type: "fulfillment_run_unlinked",
      actor_id: actorId,
      metadata: { previous_fulfillment_run_id: previousRun },
    });
    const { data: full, error: gErr } = await fetchJobEnriched(
      supabase,
      job_id,
    );
    if (gErr || !full) {
      return safeJsonError(gErr?.message ?? "Failed to load job", 400, origin);
    }
    return safeJsonOk({ job: full }, origin);
  }

  const { data: run, error: rErr } = await supabase
    .from("parts_fulfillment_runs")
    .select("id, workspace_id, status")
    .eq("id", fulfillment_run_id)
    .maybeSingle();
  if (rErr || !run) {
    return safeJsonError("Fulfillment run not found", 404, origin);
  }
  if (run.workspace_id !== ws) {
    return safeJsonError(
      "Fulfillment run is not in the same workspace as this job",
      400,
      origin,
    );
  }

  const acknowledge_shared = body.acknowledge_shared_fulfillment_run === true ||
    body.acknowledge_shared_fulfillment_run === "true";

  const { data: otherJobs, error: ojErr } = await supabase
    .from("service_jobs")
    .select("id")
    .eq("fulfillment_run_id", fulfillment_run_id)
    .neq("id", job_id)
    .limit(25);
  if (ojErr) return safeJsonError(ojErr.message, 400, origin);
  const otherIds = (otherJobs ?? []).map((r) => r.id as string);
  if (otherIds.length > 0 && !acknowledge_shared) {
    return safeJsonErrorWithFields(
      "Another service job is already linked to this fulfillment run. Confirm to link this job to the same shared run.",
      409,
      origin,
      { code: "shared_fulfillment_run", other_job_ids: otherIds },
    );
  }

  const { error: uErr } = await supabase
    .from("service_jobs")
    .update({ fulfillment_run_id })
    .eq("id", job_id);
  if (uErr) return safeJsonError(uErr.message, 400, origin);

  await supabase.from("parts_fulfillment_events").insert({
    workspace_id: ws,
    fulfillment_run_id,
    event_type: "service_job_linked",
    payload: {
      service_job_id: job_id,
      actor_id: actorId,
      previous_fulfillment_run_id: previousRun,
      audit_channel: "shop",
    },
  });

  await supabase.from("service_job_events").insert({
    workspace_id: ws,
    job_id,
    event_type: "fulfillment_run_linked",
    actor_id: actorId,
    metadata: { fulfillment_run_id, previous_fulfillment_run_id: previousRun },
  });

  const { data: full, error: gErr } = await fetchJobEnriched(supabase, job_id);
  if (gErr || !full) {
    return safeJsonError(gErr?.message ?? "Failed to load job", 400, origin);
  }
  return safeJsonOk({ job: full }, origin);
}
