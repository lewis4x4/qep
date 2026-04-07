import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function logKbJobRunStart(
  adminClient: SupabaseClient,
  input: {
    workspaceId?: string | null;
    jobName: "embed_crm" | "kb_maintenance";
    metadata?: Record<string, unknown>;
  },
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("kb_job_runs")
    .insert({
      workspace_id: input.workspaceId ?? "default",
      job_name: input.jobName,
      status: "started",
      metadata: input.metadata ?? {},
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[kb-observability] failed to start ${input.jobName} run`, error);
    return null;
  }

  return data?.id ?? null;
}

export async function logKbJobRunFinish(
  adminClient: SupabaseClient,
  input: {
    runId: string | null;
    status: "success" | "error";
    processedCount?: number;
    errorCount?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.runId) return;

  const { error } = await adminClient
    .from("kb_job_runs")
    .update({
      status: input.status,
      processed_count: input.processedCount ?? 0,
      error_count: input.errorCount ?? 0,
      metadata: input.metadata ?? {},
      finished_at: new Date().toISOString(),
    })
    .eq("id", input.runId);

  if (error) {
    console.error(`[kb-observability] failed to finish run ${input.runId}`, error);
  }
}
