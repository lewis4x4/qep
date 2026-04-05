/**
 * Service Parts Planner — Auto-split parts requirements into pick/transfer/order
 * actions with system-generated need-by dates.
 *
 * Auth: user JWT only
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface PlanRequest {
  job_id: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const body: PlanRequest = await req.json();
    if (!body.job_id) return safeJsonError("job_id required", 400, origin);

    // Fetch job and its parts requirements
    const { data: job, error: jobErr } = await supabase
      .from("service_jobs")
      .select("id, workspace_id, branch_id, haul_required, scheduled_start_at, status_flags")
      .eq("id", body.job_id)
      .single();

    if (jobErr || !job) return safeJsonError("Job not found", 404, origin);

    const { data: requirements } = await supabase
      .from("service_parts_requirements")
      .select("*")
      .eq("job_id", body.job_id)
      .neq("status", "cancelled");

    if (!requirements || requirements.length === 0) {
      return safeJsonOk({ message: "No parts requirements to plan", actions_created: 0 }, origin);
    }

    await supabase
      .from("service_parts_actions")
      .delete()
      .eq("job_id", body.job_id)
      .is("completed_at", null);

    const isMachineDown = Array.isArray(job.status_flags) &&
      job.status_flags.includes("machine_down");

    const actionsToInsert: Record<string, unknown>[] = [];
    const requirementUpdates: { id: string; status: string; need_by_date: string | null }[] = [];

    for (const req of requirements) {
      // Zero-blocking: no live inventory check available, default to order
      // In production, this would query inventory snapshots or live sync
      const actionType = "order";
      const confidence = "manual";

      // Calculate need-by date
      // Base: scheduled start - buffer, or 48h from now if no schedule
      const baseDate = job.scheduled_start_at
        ? new Date(job.scheduled_start_at)
        : new Date(Date.now() + 48 * 3600_000);

      // Subtract buffer for staging (4h) and transport if haul (24h)
      const bufferHours = 4 + (job.haul_required ? 24 : 0);
      const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000);

      // Machine-down: compress to 8h from now
      const effectiveNeedBy = isMachineDown
        ? new Date(Date.now() + 8 * 3600_000)
        : needBy;

      actionsToInsert.push({
        workspace_id: job.workspace_id,
        requirement_id: req.id,
        job_id: body.job_id,
        action_type: actionType,
        metadata: { confidence, planned_at: new Date().toISOString() },
      });

      requirementUpdates.push({
        id: req.id,
        status: "ordering",
        need_by_date: effectiveNeedBy.toISOString(),
      });
    }

    // Batch insert actions
    if (actionsToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("service_parts_actions")
        .insert(actionsToInsert);
      if (insertErr) {
        console.error("parts actions insert error:", insertErr);
        return safeJsonError(insertErr.message, 400, origin);
      }
    }

    // Update requirements with need-by dates and status
    for (const upd of requirementUpdates) {
      await supabase
        .from("service_parts_requirements")
        .update({ status: upd.status, need_by_date: upd.need_by_date })
        .eq("id", upd.id);
    }

    return safeJsonOk({
      actions_created: actionsToInsert.length,
      requirements_updated: requirementUpdates.length,
      is_machine_down: isMachineDown,
    }, origin);
  } catch (err) {
    console.error("service-parts-planner error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
