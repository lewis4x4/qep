import { supabase } from "@/lib/supabase";
import type {
  H8LinePayerRow,
  H8PayerType,
  H8WarrantyClaim,
  H8WarrantyClaimLine,
  H8WarrantyClaimStatus,
  ServiceJobWithRelations,
  ServiceListFilters,
  ServiceListResponse,
  ServiceTransitionResult,
} from "./types";
import {
  normalizeBillingPostResult,
  normalizeCalendarSlotsResult,
  normalizeLinkFulfillmentRunPayload,
  normalizePartsPopulateResult,
  normalizeReassignFromBranchPoolResult,
  normalizeResyncPartsResult,
  normalizeSearchPortalOrdersResponse,
  normalizeServiceJobResponse,
  normalizeServiceListResponse,
  normalizeServiceTransitionResponse,
  normalizeTechnicianSuggestionsResult,
  type BillingPostResult,
  type CalendarSlotsResult,
  type PortalOrderSearchRow,
  type ReassignFromBranchPoolResult,
  type ResyncPartsResult,
  type TechnicianSuggestionsResult,
} from "./service-api-normalizers";

async function invokeServiceRouter(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("service-job-router", {
    body,
  });
  if (error) throw new Error(error.message ?? "Service router error");
  return data;
}

export async function createServiceJob(
  payload: Record<string, unknown>,
): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({
    action: "create",
    ...payload,
  });
  return normalizeServiceJobResponse(result);
}

export async function updateServiceJob(
  id: string,
  fields: Record<string, unknown>,
): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({
    action: "update",
    id,
    ...fields,
  });
  return normalizeServiceJobResponse(result);
}

export async function transitionServiceJob(
  id: string,
  toStage: string,
  blockerInfo?: { blocker_type: string; blocker_description?: string },
): Promise<ServiceTransitionResult> {
  const result = await invokeServiceRouter({
    action: "transition",
    id,
    to_stage: toStage,
    ...blockerInfo,
  });
  return normalizeServiceTransitionResponse(result);
}

export async function getServiceJob(
  id: string,
): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({
    action: "get",
    id,
  });
  return normalizeServiceJobResponse(result);
}

export async function listServiceJobs(
  filters: ServiceListFilters = {},
): Promise<ServiceListResponse> {
  const result = await invokeServiceRouter({
    action: "list",
    ...filters,
  });
  return normalizeServiceListResponse(result);
}

export async function populatePartsFromJobCode(jobId: string): Promise<{ populated: number }> {
  const { data, error } = await supabase.functions.invoke("service-job-router", {
    body: { action: "populate_parts", job_id: jobId },
  });
  if (error) throw new Error(error.message ?? "populate_parts failed");
  return normalizePartsPopulateResult(data);
}

export async function planPartsFulfillment(jobId: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("service-parts-planner", {
    body: { job_id: jobId },
  });
  if (error) throw new Error(error.message ?? "parts planner failed");
  return data;
}

export async function invokePartsManager(
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("service-parts-manager", {
    body,
  });
  if (error) throw new Error(error.message ?? "parts manager failed");
  return data;
}

/** P1-C: suggested → accepted so parts planner can include the line. */
export async function acceptPartsIntakeLine(requirementId: string): Promise<unknown> {
  return invokePartsManager({
    action: "accept_intake_line",
    requirement_id: requirementId,
  });
}

/** Post draft consumed-parts staging lines to a pending customer_invoices for the job (P1-A). */
export async function postInternalBillingToInvoice(
  serviceJobId: string,
): Promise<BillingPostResult> {
  const { data, error } = await supabase.functions.invoke("service-billing-post", {
    body: { service_job_id: serviceJobId },
  });
  if (error) throw new Error(error.message ?? "billing post failed");
  return normalizeBillingPostResult(data);
}

export async function suggestTechnicians(jobId: string): Promise<TechnicianSuggestionsResult> {
  const { data, error } = await supabase.functions.invoke("service-scheduler", {
    body: { job_id: jobId },
  });
  if (error) throw new Error(error.message ?? "scheduler failed");
  return normalizeTechnicianSuggestionsResult(data);
}

export async function scanUpsell(machineId: string, jobId?: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("service-upsell-scanner", {
    body: { machine_id: machineId, job_id: jobId },
  });
  if (error) throw new Error(error.message ?? "upsell scanner failed");
  return data;
}

/** Pass the full opaque tracking token from the customer confirmation message. */
export async function fetchPublicJobStatus(
  jobId: string,
  trackingToken: string,
): Promise<unknown> {
  const token = trackingToken.trim();
  if (token.length < 32) {
    throw new Error("Enter the full tracking token from your confirmation message.");
  }

  const { data, error } = await supabase.functions.invoke("service-public-job-status", {
    body: { job_id: jobId, token },
  });
  if (error) throw new Error(error.message ?? "status fetch failed");
  return data;
}

export async function resyncPartsFromJobCode(
  jobId: string,
  mode: "replace_cancelled_only" | "full" = "replace_cancelled_only",
): Promise<ResyncPartsResult> {
  const result = await invokeServiceRouter({
    action: "resync_parts_from_job_code",
    job_id: jobId,
    mode,
  });
  return normalizeResyncPartsResult(result);
}

export async function assignTechnicianToJob(
  jobId: string,
  technicianUserId: string,
): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({
    action: "assign_technician",
    job_id: jobId,
    technician_user_id: technicianUserId,
  });
  return normalizeServiceJobResponse(result);
}

export async function linkPortalRequestToJob(
  jobId: string,
  portalRequestId: string,
): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({
    action: "link_portal_request",
    job_id: jobId,
    portal_request_id: portalRequestId,
  });
  return normalizeServiceJobResponse(result);
}

export async function unlinkPortalRequestFromJob(
  jobId: string,
): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({
    action: "unlink_portal_request",
    job_id: jobId,
  });
  return normalizeServiceJobResponse(result);
}

export type { PortalOrderSearchRow } from "./service-api-normalizers";

/** Server-backed search (RPC); requires job context for workspace. */
export async function searchPortalOrdersForJob(
  jobId: string,
  q: string,
): Promise<PortalOrderSearchRow[]> {
  const result = await invokeServiceRouter({
    action: "search_portal_orders",
    job_id: jobId,
    q: q.trim(),
  });
  return normalizeSearchPortalOrdersResponse(result);
}

/** Thrown when linking would attach a second job to a run unless explicitly acknowledged. */
export class SharedFulfillmentRunError extends Error {
  readonly code = "shared_fulfillment_run" as const;
  constructor(
    message: string,
    public readonly otherJobIds: string[],
  ) {
    super(message);
    this.name = "SharedFulfillmentRunError";
  }
}

/** Link shop job to an existing parts_fulfillment_run (e.g. portal order run). Pass null to unlink. */
export async function linkFulfillmentRunToJob(
  jobId: string,
  fulfillmentRunId: string | null,
  options?: { acknowledgeSharedFulfillmentRun?: boolean },
): Promise<ServiceJobWithRelations> {
  const { data, error } = await supabase.functions.invoke("service-job-router", {
    body: {
      action: "link_fulfillment_run",
      job_id: jobId,
      fulfillment_run_id: fulfillmentRunId,
      ...(options?.acknowledgeSharedFulfillmentRun
        ? { acknowledge_shared_fulfillment_run: true }
        : {}),
    },
  });

  const payload = normalizeLinkFulfillmentRunPayload(data);

  if (payload.code === "shared_fulfillment_run") {
    throw new SharedFulfillmentRunError(
      payload.error ??
        "Another service job is already linked to this fulfillment run.",
      payload.other_job_ids,
    );
  }

  if (error) {
    throw new Error(error.message ?? "Service router error");
  }

  if (payload.job) {
    return payload.job;
  }

  throw new Error(payload.error ?? "Link fulfillment run failed");
}

/** Admin/manager: reassign open jobs from a user to the next UUID in branch pool (service_branch_config). */
export async function reassignFromBranchPool(payload: {
  branch_id: string;
  from_user_id: string;
  role: "advisor" | "technician";
}): Promise<ReassignFromBranchPoolResult> {
  const result = await invokeServiceRouter({
    action: "reassign_pool",
    ...payload,
  });
  return normalizeReassignFromBranchPoolResult(result);
}

/** Suggested appointment starts from branch business_hours (service-calendar-slots). */
export async function suggestCalendarSlots(body: {
  branch_id: string;
  from?: string;
  count?: number;
}): Promise<CalendarSlotsResult> {
  const { data, error } = await supabase.functions.invoke("service-calendar-slots", {
    body,
  });
  if (error) throw new Error(error.message ?? "Calendar slots failed");
  return normalizeCalendarSlotsResult(data);
}

export async function submitSegmentDiagnosis(payload: {
  segment_id: string;
  complaint?: string;
  cause?: string;
  correction?: string;
  labor_story_complaint_verification?: string;
  labor_story_diagnostic_steps?: string;
  labor_story_root_cause?: string;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "submit_segment_diagnosis", ...payload });
}

export async function reviewSegmentDiagnosis(payload: {
  segment_id: string;
  decision: "approve" | "return";
  notes?: string;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "review_segment_diagnosis", ...payload });
}

export async function signOffSegmentRepair(payload: {
  segment_id: string;
  labor_story: string;
  labor_story_complaint_verification: string;
  labor_story_diagnostic_steps: string;
  labor_story_root_cause: string;
  labor_story_parts_used: string;
  labor_story_work_performed: string;
  hours_actual?: number;
  quoted_labor_hours?: number;
  lockout_tagout_required?: boolean;
  lockout_tagout_completed?: boolean;
  lockout_tagout_notes?: string;
  warranty_parts_turn_in_required?: boolean;
  warranty_parts_turn_in_completed?: boolean;
  warranty_parts_label?: string;
  warranty_parts_turn_in_notes?: string;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "sign_off_segment_repair", ...payload });
}

export async function acknowledgeSegmentOverrun(payload: {
  segment_id: string;
  overrun_reason: string;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "acknowledge_segment_overrun", ...payload });
}

export async function recordSegmentLabor(payload: {
  segment_id: string;
  hours_actual?: number;
  estimated_hours?: number;
  quoted_labor_hours?: number;
  complaint?: string;
  cause?: string;
  correction?: string;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "record_segment_labor", ...payload });
}

export async function uploadAndRecordSegmentPhoto(payload: {
  workspace_id: string;
  service_job_id: string;
  segment_id: string;
  phase: "before" | "during" | "after";
  category: string;
  caption?: string;
  file: File;
}): Promise<unknown> {
  const safeName = payload.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const storagePath = `${payload.workspace_id}/service-jobs/${payload.service_job_id}/segments/${payload.segment_id}/${payload.phase}-${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("portal-service-photos")
    .upload(storagePath, payload.file, { contentType: payload.file.type || undefined });
  if (uploadError) throw new Error(uploadError.message ?? "Photo upload failed");
  return invokeServiceRouter({
    action: "record_segment_photo",
    segment_id: payload.segment_id,
    phase: payload.phase,
    category: payload.category,
    caption: payload.caption,
    content_type: payload.file.type || null,
    storage_path: storagePath,
  });
}

export async function reviewServiceDocumentation(payload: {
  job_id: string;
  decision: "approve" | "return";
  notes?: string;
  return_reason?: string;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "review_documentation", ...payload });
}

export async function linkServiceComeback(payload: {
  job_id: string;
  original_job_id: string;
  fault_attribution: string;
  responsible_technician_id?: string | null;
  responsible_segment_id?: string | null;
  notes?: string;
}): Promise<ServiceJobWithRelations> {
  const result = await invokeServiceRouter({ action: "link_comeback", ...payload });
  return normalizeServiceJobResponse(result);
}

export async function setServiceLinePayer(payload: {
  line_type: "quote_line" | "labor_ledger" | "billing_row";
  line_id: string;
  payer_type: H8PayerType;
  warranty_claim_id?: string | null;
  payer_notes?: string | null;
}): Promise<unknown> {
  return invokeServiceRouter({ action: "set_line_payer", ...payload });
}

export async function assembleWarrantyClaim(payload: {
  job_id: string;
  warranty_claim_id?: string;
  claim_number?: string;
  oem_name?: string;
  oem_reference?: string;
}): Promise<{ claim: H8WarrantyClaim | null; lines: H8WarrantyClaimLine[] }> {
  const result = await invokeServiceRouter({ action: "assemble_warranty_claim", ...payload });
  if (!isRecord(result)) return { claim: null, lines: [] };
  return {
    claim: isRecord(result.claim) ? result.claim as unknown as H8WarrantyClaim : null,
    lines: Array.isArray(result.lines) ? result.lines as unknown as H8WarrantyClaimLine[] : [],
  };
}

export async function updateWarrantyClaimStatus(payload: {
  warranty_claim_id: string;
  status: H8WarrantyClaimStatus;
  oem_reference?: string;
  approved_amount?: number;
  paid_amount?: number;
  denied_reason?: string;
  notes?: string;
}): Promise<H8WarrantyClaim | null> {
  const result = await invokeServiceRouter({ action: "update_warranty_claim_status", ...payload });
  return isRecord(result) && isRecord(result.claim) ? result.claim as unknown as H8WarrantyClaim : null;
}

export async function listWarrantyClaimsForJob(jobId: string): Promise<H8WarrantyClaim[]> {
  const { data, error } = await supabase
    .from("service_warranty_claims")
    .select("id, service_job_id, status, claim_number, oem_name, oem_reference, requested_amount_cents, approved_amount_cents, paid_amount_cents, denied_reason, submitted_at, oem_evaluation_started_at, approved_at, denied_at, paid_at, closed_at, updated_at")
    .eq("service_job_id", jobId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message ?? "Warranty claims failed");
  return Array.isArray(data) ? data as H8WarrantyClaim[] : [];
}

export async function listServiceLinePayers(jobId: string): Promise<H8LinePayerRow[]> {
  const rows: H8LinePayerRow[] = [];
  const { data: quotes, error: quoteError } = await supabase
    .from("service_quotes")
    .select("id")
    .eq("job_id", jobId);
  if (quoteError) throw new Error(quoteError.message ?? "Quote lookup failed");
  const quoteIds = (quotes ?? []).map((quote) => quote.id as string).filter(Boolean);
  if (quoteIds.length > 0) {
    const { data: quoteLines, error } = await supabase
      .from("service_quote_lines")
      .select("id, line_type, description, extended_price, payer_type, warranty_claim_id, payer_notes")
      .in("quote_id", quoteIds)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message ?? "Quote lines failed");
    for (const line of quoteLines ?? []) {
      rows.push({
        id: line.id as string,
        line_type: "quote_line",
        label: `${line.line_type ?? "quote"}: ${line.description ?? "Quote line"}`,
        amount_cents: Math.round(Number(line.extended_price ?? 0) * 100),
        payer_type: line.payer_type as H8PayerType | null,
        warranty_claim_id: line.warranty_claim_id as string | null,
        payer_notes: line.payer_notes as string | null,
      });
    }
  }

  const { data: laborRows, error: laborError } = await supabase
    .from("service_labor_ledger")
    .select("id, notes, labor_sale_cents, payer_type, warranty_claim_id, payer_notes")
    .eq("service_job_id", jobId)
    .is("deleted_at", null);
  if (laborError) throw new Error(laborError.message ?? "Labor ledger failed");
  for (const row of laborRows ?? []) {
    rows.push({
      id: row.id as string,
      line_type: "labor_ledger",
      label: `Labor: ${row.notes ?? "ledger row"}`,
      amount_cents: Number(row.labor_sale_cents ?? 0),
      payer_type: row.payer_type as H8PayerType | null,
      warranty_claim_id: row.warranty_claim_id as string | null,
      payer_notes: row.payer_notes as string | null,
    });
  }

  const { data: billingRows, error: billingError } = await supabase
    .from("service_billing_rows")
    .select("id, row_type, description, extended_price_cents, payer_type, warranty_claim_id, payer_notes")
    .eq("service_job_id", jobId)
    .is("deleted_at", null);
  if (billingError) throw new Error(billingError.message ?? "Billing rows failed");
  for (const row of billingRows ?? []) {
    rows.push({
      id: row.id as string,
      line_type: "billing_row",
      label: `${row.row_type ?? "billing"}: ${row.description ?? "Billing row"}`,
      amount_cents: Number(row.extended_price_cents ?? 0),
      payer_type: row.payer_type as H8PayerType | null,
      warranty_claim_id: row.warranty_claim_id as string | null,
      payer_notes: row.payer_notes as string | null,
    });
  }

  return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
