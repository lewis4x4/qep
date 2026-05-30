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
import { notifyAfterStageChange } from "../_shared/service-lifecycle-notify.ts";
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(s: string): boolean {
  return UUID_RE.test(s.trim());
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
  "scheduled_start_at",
  "scheduled_end_at",
  "invoice_total",
  "portal_request_id",
]);

const READ_ONLY_JOB_ACTIONS = new Set(["get", "list"]);
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
  if (["technician", "parts_counter", "finance_admin"].includes(role)) {
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
      machine:crm_equipment(id, make, model, serial_number, year),
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
    .select("id, name, make, model, serial_number, year, category, metadata")
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

  if (Object.keys(fields).length === 0) {
    return safeJsonError("No valid fields to update", 400, origin);
  }

  const { data: before } = await supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .single();

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
  } = body as Record<string, unknown>;

  let query = supabase
    .from("service_jobs")
    .select(
      `
      *,
      customer:crm_companies(id, name),
      machine:crm_equipment(id, make, model, serial_number),
      advisor:profiles!service_jobs_advisor_id_fkey(id, full_name),
      technician:profiles!service_jobs_technician_id_fkey(id, full_name)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (!include_closed) {
    query = query.is("closed_at", null).is("deleted_at", null);
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
