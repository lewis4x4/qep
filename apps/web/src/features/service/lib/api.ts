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
