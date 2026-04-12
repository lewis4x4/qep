import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type DgeRefreshJobType =
  | "customer_profile_refresh"
  | "market_valuation_refresh"
  | "economic_sync_refresh";

export interface DgeRefreshJobRow {
  id: string;
  workspace_id: string;
  job_type: DgeRefreshJobType;
  dedupe_key: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  created_at: string;
  last_error: string | null;
}

interface EnqueueResultRow {
  job_id: string;
  job_status: DgeRefreshJobRow["status"];
  enqueued: boolean;
}

export function buildDgeRefreshDedupeKey(
  jobType: DgeRefreshJobType,
  identifier: string,
): string {
  return `${jobType}:${identifier.trim().toLowerCase()}`;
}

export async function enqueueDgeRefreshJob(
  adminClient: SupabaseClient,
  params: {
    workspaceId: string;
    jobType: DgeRefreshJobType;
    dedupeKey: string;
    requestPayload: Record<string, unknown>;
    requestedBy: string | null;
    priority?: number;
  },
): Promise<{ jobId: string; status: DgeRefreshJobRow["status"]; enqueued: boolean }> {
  const { data, error } = await adminClient.rpc("enqueue_dge_refresh_job", {
    p_workspace_id: params.workspaceId,
    p_job_type: params.jobType,
    p_dedupe_key: params.dedupeKey,
    p_request_payload: params.requestPayload,
    p_requested_by: params.requestedBy,
    p_priority: params.priority ?? 100,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] as EnqueueResultRow | undefined : undefined;
  if (!row?.job_id) {
    throw new Error("QUEUE_ENQUEUE_FAILED");
  }

  return {
    jobId: row.job_id,
    status: row.job_status,
    enqueued: row.enqueued,
  };
}

export async function findOpenDgeRefreshJob(
  adminClient: SupabaseClient,
  params: {
    workspaceId: string;
    dedupeKey: string;
  },
): Promise<DgeRefreshJobRow | null> {
  const { data, error } = await adminClient
    .from("dge_refresh_jobs")
    .select("id, workspace_id, job_type, dedupe_key, status, created_at, last_error")
    .eq("workspace_id", params.workspaceId)
    .eq("dedupe_key", params.dedupeKey)
    .in("status", ["queued", "running"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as DgeRefreshJobRow | null) ?? null;
}

export async function findWorkspaceRefreshJob(
  adminClient: SupabaseClient,
  params: {
    workspaceId: string;
    jobType: DgeRefreshJobType;
  },
): Promise<DgeRefreshJobRow | null> {
  const { data, error } = await adminClient
    .from("dge_refresh_jobs")
    .select("id, workspace_id, job_type, dedupe_key, status, created_at, last_error")
    .eq("workspace_id", params.workspaceId)
    .eq("job_type", params.jobType)
    .in("status", ["queued", "running"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as DgeRefreshJobRow | null) ?? null;
}

export async function triggerDgeRefreshWorker(): Promise<void> {
  const internalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
  if (!internalSecret) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) return;

  await fetch(`${supabaseUrl}/functions/v1/dge-refresh-worker`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-service-secret": internalSecret,
    },
    body: JSON.stringify({}),
  }).catch(() => undefined);
}
