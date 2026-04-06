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

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    console.error("sop-engine error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
