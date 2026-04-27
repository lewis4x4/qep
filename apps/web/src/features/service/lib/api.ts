import { supabase } from "@/lib/supabase";
import type {
  ServiceJobWithRelations,
  ServiceListFilters,
  ServiceListResponse,
} from "./types";

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("service-job-router", {
    body,
  });
  if (error) throw new Error(error.message ?? "Service router error");
  return data as T;
}

export async function createServiceJob(
  payload: Record<string, unknown>,
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "create",
    ...payload,
  });
  return result.job;
}

export async function updateServiceJob(
  id: string,
  fields: Record<string, unknown>,
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "update",
    id,
    ...fields,
  });
  return result.job;
}

export async function transitionServiceJob(
  id: string,
  toStage: string,
  blockerInfo?: { blocker_type: string; blocker_description?: string },
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "transition",
    id,
    to_stage: toStage,
    ...blockerInfo,
  });
  return result.job;
}

export async function getServiceJob(
  id: string,
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "get",
    id,
  });
  return result.job;
}

export async function listServiceJobs(
  filters: ServiceListFilters = {},
): Promise<ServiceListResponse> {
  return invoke<ServiceListResponse>({
    action: "list",
    ...filters,
  });
}

export async function populatePartsFromJobCode(jobId: string): Promise<{ populated: number }> {
  const { data, error } = await supabase.functions.invoke("service-job-router", {
    body: { action: "populate_parts", job_id: jobId },
  });
  if (error) throw new Error(error.message ?? "populate_parts failed");
  const d = data as { populated?: number };
  return { populated: d.populated ?? 0 };
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
): Promise<{
  ok?: boolean;
  customer_invoice_id?: string;
  lines_posted?: number;
  invoice_total?: number;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("service-billing-post", {
    body: { service_job_id: serviceJobId },
  });
  if (error) throw new Error(error.message ?? "billing post failed");
  return (data ?? {}) as {
    ok?: boolean;
    customer_invoice_id?: string;
    lines_posted?: number;
    invoice_total?: number;
    error?: string;
  };
}

export async function suggestTechnicians(jobId: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("service-scheduler", {
    body: { job_id: jobId },
  });
  if (error) throw new Error(error.message ?? "scheduler failed");
  return data;
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
): Promise<{ inserted: number; cancelled: number; mode: string }> {
  return invoke({
    action: "resync_parts_from_job_code",
    job_id: jobId,
    mode,
  });
}

export async function assignTechnicianToJob(
  jobId: string,
  technicianUserId: string,
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "assign_technician",
    job_id: jobId,
    technician_user_id: technicianUserId,
  });
  return result.job;
}

export async function linkPortalRequestToJob(
  jobId: string,
  portalRequestId: string,
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "link_portal_request",
    job_id: jobId,
    portal_request_id: portalRequestId,
  });
  return result.job;
}

export async function unlinkPortalRequestFromJob(
  jobId: string,
): Promise<ServiceJobWithRelations> {
  const result = await invoke<{ job: ServiceJobWithRelations }>({
    action: "unlink_portal_request",
    job_id: jobId,
  });
  return result.job;
}

export type PortalOrderSearchRow = {
  id: string;
  status: string;
  fulfillment_run_id: string | null;
  created_at: string;
  portal_customers: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
};

/** Server-backed search (RPC); requires job context for workspace. */
export async function searchPortalOrdersForJob(
  jobId: string,
  q: string,
): Promise<PortalOrderSearchRow[]> {
  const result = await invoke<{ orders: PortalOrderSearchRow[] }>({
    action: "search_portal_orders",
    job_id: jobId,
    q: q.trim(),
  });
  return result.orders ?? [];
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

  const payload = data as
    | {
        job?: ServiceJobWithRelations;
        error?: string;
        code?: string;
        other_job_ids?: string[];
      }
    | null;

  if (payload?.code === "shared_fulfillment_run") {
    throw new SharedFulfillmentRunError(
      payload.error ??
        "Another service job is already linked to this fulfillment run.",
      Array.isArray(payload.other_job_ids) ? payload.other_job_ids : [],
    );
  }

  if (error) {
    throw new Error(error.message ?? "Service router error");
  }

  if (payload?.job) {
    return payload.job;
  }

  throw new Error(payload?.error ?? "Link fulfillment run failed");
}

/** Admin/manager: reassign open jobs from a user to the next UUID in branch pool (service_branch_config). */
export async function reassignFromBranchPool(payload: {
  branch_id: string;
  from_user_id: string;
  role: "advisor" | "technician";
}): Promise<{ reassigned: number; replacement: string }> {
  const result = await invoke<{ reassigned: number; replacement: string }>({
    action: "reassign_pool",
    ...payload,
  });
  return result;
}

/** Suggested appointment starts from branch business_hours (service-calendar-slots). */
export async function suggestCalendarSlots(body: {
  branch_id: string;
  from?: string;
  count?: number;
}): Promise<{ slots: string[]; slot_minutes: number; branch_id: string }> {
  const { data, error } = await supabase.functions.invoke("service-calendar-slots", {
    body,
  });
  if (error) throw new Error(error.message ?? "Calendar slots failed");
  return data as { slots: string[]; slot_minutes: number; branch_id: string };
}
