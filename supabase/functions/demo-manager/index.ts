/**
 * Demo Manager Edge Function
 *
 * Full demo lifecycle: qualification check, approval routing, hour tracking,
 * cost allocation, follow-up scheduling.
 *
 * GET:    ?deal_id=... → list demos for deal
 * POST:   Request a demo (qualification gate applied)
 * PUT:    Update demo status/data (approval, scheduling, completion)
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // ── GET: list demos ──────────────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const dealId = url.searchParams.get("deal_id");

      if (!dealId) {
        return safeJsonError("deal_id is required", 400, origin);
      }

      const { data, error } = await supabase
        .from("demos")
        .select("*, demo_inspections(*)")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("demo-manager GET error:", error);
        return safeJsonError("Failed to fetch demos", 500, origin);
      }

      return safeJsonOk({ demos: data }, origin);
    }

    // ── POST: request demo ───────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();

      if (!body.deal_id) {
        return safeJsonError("deal_id is required", 400, origin);
      }

      // Check qualification prerequisites
      const prerequisites = {
        needs_assessment_complete: false,
        quote_presented: false,
        buying_intent_confirmed: false,
      };

      // Check needs assessment exists and has reasonable completeness
      const { data: assessment } = await supabase
        .from("needs_assessments")
        .select("fields_populated")
        .eq("deal_id", body.deal_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      prerequisites.needs_assessment_complete = (assessment?.fields_populated ?? 0) >= 5;

      // Check if quote was presented (deal at stage 8+)
      const { data: deal } = await supabase
        .from("crm_deals")
        .select("stage_id, crm_deal_stages!inner(sort_order)")
        .eq("id", body.deal_id)
        .single();

      const sortOrder = (deal as any)?.crm_deal_stages?.sort_order ?? 0;
      prerequisites.quote_presented = sortOrder >= 8;
      prerequisites.buying_intent_confirmed = body.buying_intent_confirmed ?? false;

      // Report missing prerequisites
      const missing: string[] = [];
      if (!prerequisites.needs_assessment_complete) missing.push("Needs assessment incomplete (min 5 fields)");
      if (!prerequisites.quote_presented) missing.push("Quote must be presented first (Stage 8+)");
      if (!prerequisites.buying_intent_confirmed) missing.push("Buying intent not confirmed");

      if (missing.length > 0) {
        return safeJsonOk({
          blocked: true,
          missing_prerequisites: missing,
          prerequisites,
        }, origin, 200); // Not an error — informational block
      }

      // Create demo request
      const { data: demo, error: demoError } = await supabase
        .from("demos")
        .insert({
          deal_id: body.deal_id,
          equipment_id: body.equipment_id || null,
          needs_assessment_complete: prerequisites.needs_assessment_complete,
          quote_presented: prerequisites.quote_presented,
          buying_intent_confirmed: prerequisites.buying_intent_confirmed,
          equipment_category: body.equipment_category || "construction",
          max_hours: body.equipment_category === "forestry" ? 4 : 10,
          requested_by: user.id,
        })
        .select()
        .single();

      if (demoError) {
        console.error("demo-manager POST error:", demoError);
        return safeJsonError("Failed to create demo request", 500, origin);
      }

      // Notify Iron Managers for approval
      const { data: managers } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("iron_role", "iron_manager");

      if (managers) {
        for (const mgr of managers) {
          await supabaseAdmin.from("crm_in_app_notifications").insert({
            workspace_id: "default",
            user_id: mgr.id,
            kind: "demo_approval",
            title: `Demo Requested: ${body.deal_name || "Deal"}`,
            body: `${body.equipment_category || "Construction"} demo requested. Qualification: all prerequisites met.`,
            deal_id: body.deal_id,
            metadata: { demo_id: demo.id },
          });
        }
      }

      return safeJsonOk({ demo, prerequisites }, origin, 201);
    }

    // ── PUT: update demo ─────────────────────────────────────────────────
    if (req.method === "PUT") {
      const body = await req.json();

      if (!body.id) {
        return safeJsonError("id is required for update", 400, origin);
      }

      const { id, ...updates } = body;

      const { data, error } = await supabase
        .from("demos")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("demo-manager PUT error:", error);
        // Check for qualification gate error
        if (error.message?.includes("DEMO_GATE")) {
          return safeJsonError(error.message, 400, origin);
        }
        return safeJsonError("Failed to update demo", 500, origin);
      }

      return safeJsonOk({ demo: data }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    console.error("demo-manager error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
