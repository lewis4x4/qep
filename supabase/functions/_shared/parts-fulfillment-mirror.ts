import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type MirrorResult =
  | { skipped: true }
  | { skipped: false; error?: string };

/**
 * When `service_jobs.fulfillment_run_id` is set, append a shop-sourced event to
 * `parts_fulfillment_events` for run-level audit. No-op if unlinked or workspace mismatch.
 */
export async function mirrorToFulfillmentRun(
  supabase: SupabaseClient,
  params: {
    jobId: string;
    workspaceId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<MirrorResult> {
  const { data, error } = await supabase
    .from("service_jobs")
    .select("fulfillment_run_id, workspace_id")
    .eq("id", params.jobId)
    .maybeSingle();

  if (error || !data) return { skipped: true };

  const job = data as {
    fulfillment_run_id: string | null;
    workspace_id: string;
  };

  if (String(job.workspace_id) !== params.workspaceId) return { skipped: true };

  const runId = job.fulfillment_run_id;
  if (!runId) return { skipped: true };

  const { error: insErr } = await supabase.from("parts_fulfillment_events").insert({
    workspace_id: params.workspaceId,
    fulfillment_run_id: runId,
    event_type: params.eventType,
    payload: {
      service_job_id: params.jobId,
      source: "shop",
      ...params.payload,
    },
  });

  if (insErr) {
    console.warn("parts-fulfillment-mirror insert:", insErr.message);
    return { skipped: false, error: insErr.message };
  }
  return { skipped: false };
}
