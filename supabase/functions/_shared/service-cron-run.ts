/**
 * Optional execution log for cron-invoked edge workers (service_cron_runs).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function logServiceCronRun(
  supabase: SupabaseClient,
  opts: {
    workspaceId?: string;
    jobName: string;
    ok: boolean;
    error?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (Deno.env.get("SERVICE_CRON_RUNS_DISABLED") === "true") return;
  const started = new Date().toISOString();
  const finished = new Date().toISOString();
  const { error } = await supabase.from("service_cron_runs").insert({
    workspace_id: opts.workspaceId ?? "default",
    job_name: opts.jobName,
    started_at: started,
    finished_at: finished,
    ok: opts.ok,
    error: opts.error ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) console.warn("logServiceCronRun:", error.message);
}
