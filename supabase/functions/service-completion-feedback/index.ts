/**
 * Service Completion Feedback — Capture structured post-job learning.
 *
 * Auth: user JWT only
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface FeedbackRequest {
  job_id: string;
  actual_problem_fixed?: boolean;
  additional_issues?: unknown[];
  missing_parts?: unknown[];
  time_saver_notes?: string;
  serial_specific_note?: string;
  return_visit_risk?: string;
  upsell_suggestions?: unknown[];
  actual_hours?: number;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const userId = auth.userId;

    const body: FeedbackRequest = await req.json();
    if (!body.job_id) return safeJsonError("job_id required", 400, origin);

    // Fetch job context
    const { data: job } = await supabase
      .from("service_jobs")
      .select("id, workspace_id, machine_id, selected_job_code_id, technician_id, current_stage")
      .eq("id", body.job_id)
      .single();

    if (!job) return safeJsonError("Job not found", 404, origin);

    // Insert completion feedback
    const { data: feedback, error: fbErr } = await supabase
      .from("service_completion_feedback")
      .upsert(
        {
          workspace_id: job.workspace_id,
          job_id: body.job_id,
          actual_problem_fixed: body.actual_problem_fixed ?? null,
          additional_issues: body.additional_issues ?? [],
          missing_parts: body.missing_parts ?? [],
          time_saver_notes: body.time_saver_notes || null,
          serial_specific_note: body.serial_specific_note || null,
          return_visit_risk: body.return_visit_risk || null,
          upsell_suggestions: body.upsell_suggestions ?? [],
          submitted_by: userId,
        },
        { onConflict: "job_id" },
      )
      .select()
      .single();

    if (fbErr) {
      console.error("feedback upsert error:", fbErr);
      return safeJsonError(fbErr.message, 400, origin);
    }

    // Persist serial-specific note as machine knowledge
    if (body.serial_specific_note && job.machine_id) {
      await supabase.from("machine_knowledge_notes").insert({
        workspace_id: job.workspace_id,
        equipment_id: job.machine_id,
        job_id: body.job_id,
        note_type: "serial_specific",
        content: body.serial_specific_note,
        source_user_id: userId,
      });
    }

    // Persist time-saver notes as machine knowledge
    if (body.time_saver_notes && job.machine_id) {
      await supabase.from("machine_knowledge_notes").insert({
        workspace_id: job.workspace_id,
        equipment_id: job.machine_id,
        job_id: body.job_id,
        note_type: "field_hack",
        content: body.time_saver_notes,
        source_user_id: userId,
      });
    }

    // Create job_code_observation if we have a job code
    if (job.selected_job_code_id && body.actual_hours != null) {
      const { data: jc } = await supabase
        .from("job_codes")
        .select("shop_average_hours, manufacturer_estimated_hours")
        .eq("id", job.selected_job_code_id)
        .single();

      const estimatedHours = jc?.shop_average_hours ?? jc?.manufacturer_estimated_hours;

      // Fetch parts data for the observation
      const { data: partsQuoted } = await supabase
        .from("service_parts_requirements")
        .select("part_number, quantity, status")
        .eq("job_id", body.job_id);

      await supabase.from("job_code_observations").insert({
        workspace_id: job.workspace_id,
        job_code_id: job.selected_job_code_id,
        job_id: body.job_id,
        actual_hours: body.actual_hours,
        estimated_hours: estimatedHours ?? null,
        parts_consumed: (partsQuoted ?? [])
          .filter((p) => p.status === "consumed")
          .map((p) => ({ part_number: p.part_number, quantity: p.quantity })),
        parts_quoted: (partsQuoted ?? [])
          .map((p) => ({ part_number: p.part_number, quantity: p.quantity })),
        discovered_add_ons: body.additional_issues ?? [],
        technician_id: job.technician_id || null,
        notes: body.time_saver_notes || null,
      });
    }

    // Log event
    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: body.job_id,
      event_type: "completion_feedback_submitted",
      actor_id: userId,
      metadata: {
        actual_problem_fixed: body.actual_problem_fixed,
        return_visit_risk: body.return_visit_risk,
        has_additional_issues: (body.additional_issues?.length ?? 0) > 0,
      },
    });

    return safeJsonOk({ feedback }, origin, 201);
  } catch (err) {
    console.error("service-completion-feedback error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
