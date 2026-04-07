/**
 * SOP Engine Edge Function
 *
 * Moonshot 7: Turn static SOPs into executable workflows.
 * Ryan already uses ChatGPT to write SOPs — this makes them live
 * inside QEP OS: trackable, executable, compliance-measurable.
 *
 * Routes:
 * GET    /templates       — list SOP templates
 * POST   /templates       — create template
 * POST   /templates/:id/publish — activate + auto-version
 * POST   /templates/:id/steps   — add step to template
 * GET    /executions       — list active executions
 * POST   /executions       — start execution of a template
 * POST   /executions/:id/complete-step — complete a step
 * POST   /executions/:id/close — close execution
 *
 * Auth: rep/admin/manager/owner (workspace-scoped)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";

interface ProfileRoleRow {
  role: string | null;
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const callerRole = ((profile as ProfileRoleRow | null)?.role ?? "").trim();
    const isManagerPlus = callerRole === "manager" || callerRole === "owner" || callerRole === "admin";

    const url = new URL(req.url);
    const pathParts = url.pathname.replace(/^\/functions\/v1\/sop-engine\/?/, "").split("/").filter(Boolean);
    const resource = pathParts[0] || "";
    const resourceId = pathParts[1] || "";
    const action = pathParts[2] || "";

    // ── Templates ───────────────────────────────────────────────────────
    if (resource === "templates") {
      if (req.method === "GET" && !resourceId) {
        const dept = url.searchParams.get("department");
        let query = supabase
          .from("sop_templates")
          .select("*, sop_steps(count)")
          .is("deleted_at", null)
          .order("title");

        if (dept) query = query.eq("department", dept);

        const { data, error } = await query;
        if (error) return safeJsonError("Failed to load templates", 500, origin);
        return safeJsonOk({ templates: data }, origin);
      }

      if (req.method === "POST" && !resourceId) {
        const body = await req.json();
        if (!body.title || !body.department) {
          return safeJsonError("title and department required", 400, origin);
        }

        const { data, error } = await supabase
          .from("sop_templates")
          .insert({
            title: body.title,
            description: body.description || null,
            department: body.department,
            document_id: body.document_id || null,
            tags: body.tags || [],
            created_by: user.id,
          })
          .select()
          .single();

        if (error) return safeJsonError("Failed to create template", 500, origin);
        return safeJsonOk({ template: data }, origin, 201);
      }

      // POST /templates/:id/publish
      if (req.method === "POST" && action === "publish") {
        const { data, error } = await supabase
          .from("sop_templates")
          .update({ status: "active", approved_by: user.id })
          .eq("id", resourceId)
          .select()
          .single();

        if (error) return safeJsonError("Failed to publish template", 500, origin);
        return safeJsonOk({ template: data }, origin);
      }

      // POST /templates/:id/steps
      if (req.method === "POST" && action === "steps") {
        const body = await req.json();
        if (!body.title) return safeJsonError("title required", 400, origin);

        const { data, error } = await supabase
          .from("sop_steps")
          .insert({
            sop_template_id: resourceId,
            sort_order: body.sort_order ?? 0,
            title: body.title,
            instructions: body.instructions || null,
            required_role: body.required_role || null,
            estimated_duration_minutes: body.estimated_duration_minutes || null,
            is_decision_point: body.is_decision_point || false,
            decision_options: body.decision_options || null,
          })
          .select()
          .single();

        if (error) return safeJsonError("Failed to add step", 500, origin);
        return safeJsonOk({ step: data }, origin, 201);
      }
    }

    // ── Executions ──────────────────────────────────────────────────────
    if (resource === "executions") {
      if (req.method === "GET" && !resourceId) {
        const { data, error } = await supabase
          .from("sop_executions")
          .select("*, sop_templates(title, department), sop_step_completions(count)")
          .eq("status", "in_progress")
          .order("started_at", { ascending: false });

        if (error) return safeJsonError("Failed to load executions", 500, origin);
        return safeJsonOk({ executions: data }, origin);
      }

      if (req.method === "POST" && !resourceId) {
        const body = await req.json();
        if (!body.sop_template_id) return safeJsonError("sop_template_id required", 400, origin);

        const { data, error } = await supabase
          .from("sop_executions")
          .insert({
            sop_template_id: body.sop_template_id,
            started_by: user.id,
            assigned_to: body.assigned_to || user.id,
            context_entity_type: body.context_entity_type || null,
            context_entity_id: body.context_entity_id || null,
          })
          .select()
          .single();

        if (error) return safeJsonError("Failed to start execution", 500, origin);
        return safeJsonOk({ execution: data }, origin, 201);
      }

      // POST /executions/:id/complete-step
      if (req.method === "POST" && action === "complete-step") {
        const body = await req.json();
        if (!body.sop_step_id) return safeJsonError("sop_step_id required", 400, origin);

        const { data: completion, error } = await supabase
          .from("sop_step_completions")
          .insert({
            sop_execution_id: resourceId,
            sop_step_id: body.sop_step_id,
            completed_by: user.id,
            decision_taken: body.decision_taken || null,
            notes: body.notes || null,
            evidence_urls: body.evidence_urls || [],
            duration_minutes: body.duration_minutes || null,
          })
          .select()
          .single();

        if (error) return safeJsonError("Failed to complete step", 500, origin);

        // Check if all steps are complete → auto-close execution
        const { data: exec } = await supabase
          .from("sop_executions")
          .select("sop_template_id")
          .eq("id", resourceId)
          .single();

        if (exec) {
          const { count: totalSteps } = await supabase
            .from("sop_steps")
            .select("*", { count: "exact", head: true })
            .eq("sop_template_id", exec.sop_template_id);

          const { count: completedSteps } = await supabase
            .from("sop_step_completions")
            .select("*", { count: "exact", head: true })
            .eq("sop_execution_id", resourceId);

          if (totalSteps && completedSteps && completedSteps >= totalSteps) {
            await supabase
              .from("sop_executions")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", resourceId);
          }
        }

        return safeJsonOk({ completion }, origin, 201);
      }

      // POST /executions/:id/skip-step — record an explicit skip (for compliance tracking)
      if (req.method === "POST" && action === "skip-step") {
        const body = await req.json();
        if (!body.sop_step_id) return safeJsonError("sop_step_id required", 400, origin);

        const { data: skip, error } = await supabase
          .from("sop_step_skips")
          .insert({
            sop_execution_id: resourceId,
            sop_step_id: body.sop_step_id,
            skipped_by: user.id,
            skip_reason: body.skip_reason || null,
          })
          .select()
          .single();

        if (error) return safeJsonError("Failed to record skip", 500, origin);
        return safeJsonOk({ skip }, origin, 201);
      }

      // POST /executions/:id/close
      if (req.method === "POST" && action === "close") {
        const body = await req.json();
        const { data, error } = await supabase
          .from("sop_executions")
          .update({
            status: body.status || "completed",
            completed_at: new Date().toISOString(),
            notes: body.notes || null,
          })
          .eq("id", resourceId)
          .select()
          .single();

        if (error) return safeJsonError("Failed to close execution", 500, origin);
        return safeJsonOk({ execution: data }, origin);
      }
    }

    // ── Compliance summary ──────────────────────────────────────────────
    if (resource === "compliance") {
      const { data, error } = await supabase
        .from("sop_compliance_summary")
        .select("*");

      if (error) return safeJsonError("Failed to load compliance data", 500, origin);
      return safeJsonOk({ compliance: data }, origin);
    }

    // ── Suppression queue review ───────────────────────────────────────
    if (resource === "suppression-queue") {
      if (!isManagerPlus) {
        return safeJsonError("Suppression review requires manager, admin, or owner role", 403, origin);
      }

      if (req.method === "GET" && !resourceId) {
        const statusFilter = url.searchParams.get("status") ?? "pending";
        let query = supabase
          .from("sop_suppression_queue")
          .select(`
            id,
            workspace_id,
            sop_execution_id,
            sop_step_id,
            proposed_state,
            proposed_evidence,
            confidence_score,
            reason,
            status,
            resolved_by,
            resolved_at,
            created_at,
            updated_at,
            sop_executions!inner(id, sop_template_id, context_entity_type, context_entity_id, status),
            sop_steps!inner(id, sort_order, title, sop_template_id),
            sop_templates!inner(id, title, department)
          `)
          .order("created_at", { ascending: false });

        if (statusFilter) {
          query = query.eq("status", statusFilter);
        }

        const { data, error } = await query;
        if (error) return safeJsonError("Failed to load suppression queue", 500, origin);
        return safeJsonOk({ items: data ?? [] }, origin);
      }

      if (req.method === "POST" && resourceId && action === "resolve") {
        const body = await req.json().catch(() => ({}));
        const resolution = typeof body.status === "string" ? body.status.trim() : "";
        if (resolution !== "approved" && resolution !== "rejected") {
          return safeJsonError("status must be approved or rejected", 400, origin);
        }

        const { data: queueItem, error: queueError } = await supabase
          .from("sop_suppression_queue")
          .select("*")
          .eq("id", resourceId)
          .maybeSingle();
        if (queueError || !queueItem) {
          return safeJsonError("Suppression item not found", 404, origin);
        }
        if (queueItem.status !== "pending") {
          return safeJsonError("Suppression item has already been resolved", 409, origin);
        }

        if (resolution === "approved") {
          const evidence = typeof queueItem.proposed_evidence === "object" && queueItem.proposed_evidence !== null
            ? queueItem.proposed_evidence as Record<string, unknown>
            : {};
          const evidenceUrls = stringArrayFromUnknown(evidence.evidence_urls);
          const notes = typeof queueItem.reason === "string" && queueItem.reason.trim().length > 0
            ? queueItem.reason.trim()
            : typeof evidence.notes === "string" && evidence.notes.trim().length > 0
            ? evidence.notes.trim()
            : null;
          const decisionTaken = typeof evidence.decision_taken === "string" && evidence.decision_taken.trim().length > 0
            ? evidence.decision_taken.trim()
            : null;
          const proposedState = String(queueItem.proposed_state);

          if (proposedState === "skipped") {
            const { data: existingSkip } = await supabase
              .from("sop_step_skips")
              .select("id")
              .eq("sop_execution_id", queueItem.sop_execution_id)
              .eq("sop_step_id", queueItem.sop_step_id)
              .maybeSingle();

            if (!existingSkip) {
              const { error: skipError } = await supabase
                .from("sop_step_skips")
                .insert({
                  sop_execution_id: queueItem.sop_execution_id,
                  sop_step_id: queueItem.sop_step_id,
                  skipped_by: user.id,
                  skip_reason: notes,
                });
              if (skipError) return safeJsonError("Failed to approve skip", 500, origin);
            }
          } else {
            const { data: existingCompletion } = await supabase
              .from("sop_step_completions")
              .select("id")
              .eq("sop_execution_id", queueItem.sop_execution_id)
              .eq("sop_step_id", queueItem.sop_step_id)
              .maybeSingle();

            if (existingCompletion?.id) {
              const { error: updateError } = await supabase
                .from("sop_step_completions")
                .update({
                  completed_by: user.id,
                  completed_at: new Date().toISOString(),
                  completion_state: proposedState,
                  confidence_score: queueItem.confidence_score,
                  notes,
                  decision_taken: decisionTaken,
                  evidence_urls: evidenceUrls,
                })
                .eq("id", existingCompletion.id);
              if (updateError) return safeJsonError("Failed to update approved completion", 500, origin);
            } else {
              const { error: completionError } = await supabase
                .from("sop_step_completions")
                .insert({
                  sop_execution_id: queueItem.sop_execution_id,
                  sop_step_id: queueItem.sop_step_id,
                  completed_by: user.id,
                  completion_state: proposedState,
                  confidence_score: queueItem.confidence_score,
                  notes,
                  decision_taken: decisionTaken,
                  evidence_urls: evidenceUrls,
                });
              if (completionError) return safeJsonError("Failed to approve suppression item", 500, origin);
            }
          }
        }

        const { data: updatedQueue, error: updateQueueError } = await supabase
          .from("sop_suppression_queue")
          .update({
            status: resolution,
            resolved_by: user.id,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", resourceId)
          .select()
          .single();
        if (updateQueueError) return safeJsonError("Failed to resolve suppression item", 500, origin);

        return safeJsonOk({ item: updatedQueue }, origin);
      }
    }

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "sop-engine", req });
    console.error("sop-engine error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
