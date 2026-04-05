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

/** Pass opaque tracking token (from confirmation email) or legacy 4-char PIN. */
export async function fetchPublicJobStatus(
  jobId: string,
  tokenOrLegacyPin: string,
): Promise<unknown> {
  const secret = tokenOrLegacyPin.trim();
  const body =
    secret.length > 4
      ? { job_id: jobId, token: secret }
      : { job_id: jobId, pin: secret };
  const { data, error } = await supabase.functions.invoke("service-public-job-status", {
    body,
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
