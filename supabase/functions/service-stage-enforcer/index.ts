/**
 * Service Stage Enforcer (Cron: every 5 minutes)
 *
 * Implements stage-trigger automation from spec section 15.1:
 * - Checks for stage conditions that should trigger downstream actions
 * - Creates notifications for stage-specific events
 * - Detects all-parts-staged condition to advance jobs
 *
 * Auth: service_role (cron invocation)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    const results = {
      parts_staged_advances: 0,
      overrun_alerts: 0,
      notifications_sent: 0,
    };

    // ── 1. All-parts-staged detection ───────────────────────────────────────
    // Find jobs at parts_pending where ALL parts are staged
    const { data: partsPendingJobs } = await supabase
      .from("service_jobs")
      .select("id, workspace_id, advisor_id, technician_id")
      .eq("current_stage", "parts_pending")
      .is("closed_at", null)
      .is("deleted_at", null);

    for (const job of (partsPendingJobs ?? [])) {
      const { data: parts } = await supabase
        .from("service_parts_requirements")
        .select("status")
        .eq("job_id", job.id)
        .neq("status", "cancelled");

      if (!parts || parts.length === 0) continue;
      const allStaged = parts.every((p) => p.status === "staged" || p.status === "consumed");

      if (allStaged) {
        // Advance to parts_staged
        await supabase
          .from("service_jobs")
          .update({ current_stage: "parts_staged" })
          .eq("id", job.id);

        await supabase.from("service_job_events").insert({
          workspace_id: job.workspace_id,
          job_id: job.id,
          event_type: "stage_transition",
          old_stage: "parts_pending",
          new_stage: "parts_staged",
          metadata: { trigger: "auto_all_parts_staged" },
        });

        // Notify technician
        if (job.technician_id) {
          await supabase.from("crm_in_app_notifications").insert({
            workspace_id: job.workspace_id,
            user_id: job.technician_id,
            kind: "service_parts_ready",
            title: "Parts Ready for Service Job",
            body: "All parts have been staged. Job is ready to schedule.",
            metadata: { job_id: job.id },
          });
          results.notifications_sent++;
        }

        results.parts_staged_advances++;
      }
    }

    // ── 2. In-progress overrun detection ────────────────────────────────────
    // Jobs in_progress where elapsed > estimated hours
    const { data: inProgressJobs } = await supabase
      .from("service_jobs")
      .select(`
        id, workspace_id, service_manager_id, scheduled_start_at,
        selected_job_code_id
      `)
      .eq("current_stage", "in_progress")
      .is("closed_at", null)
      .is("deleted_at", null);

    for (const job of (inProgressJobs ?? [])) {
      if (!job.scheduled_start_at || !job.selected_job_code_id) continue;

      const { data: jc } = await supabase
        .from("job_codes")
        .select("shop_average_hours, manufacturer_estimated_hours")
        .eq("id", job.selected_job_code_id)
        .single();

      const estimatedHours = jc?.shop_average_hours ?? jc?.manufacturer_estimated_hours;
      if (!estimatedHours) continue;

      const elapsedHours = (Date.now() - new Date(job.scheduled_start_at).getTime()) / 3_600_000;
      if (elapsedHours <= estimatedHours) continue;

      // Check for existing overrun alert
      const { data: existing } = await supabase
        .from("crm_in_app_notifications")
        .select("id")
        .eq("kind", "service_overrun")
        .eq("metadata->>job_id", job.id)
        .gte("created_at", new Date(Date.now() - 4 * 3_600_000).toISOString())
        .maybeSingle();

      if (existing) continue;

      if (job.service_manager_id) {
        await supabase.from("crm_in_app_notifications").insert({
          workspace_id: job.workspace_id,
          user_id: job.service_manager_id,
          kind: "service_overrun",
          title: "Service Job Over Estimate",
          body: `Job has exceeded estimated hours (${Math.round(elapsedHours)}h vs ${estimatedHours}h estimate)`,
          metadata: {
            job_id: job.id,
            elapsed_hours: Math.round(elapsedHours * 10) / 10,
            estimated_hours: estimatedHours,
          },
        });
        results.overrun_alerts++;
      }
    }

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    console.error("service-stage-enforcer error:", err);
    return safeJsonError("Internal server error", 500, null);
  }
});
