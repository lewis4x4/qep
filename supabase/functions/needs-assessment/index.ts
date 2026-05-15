/**
 * Needs Assessment CRUD Edge Function
 *
 * GET:  ?deal_id=... or ?contact_id=... → list assessments
 * POST: Create new assessment
 * PUT:  Update existing assessment (requires id in body)
 *
 * Auth: rep/admin/manager/owner
 * Workspace: scoped via RLS
 */
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const user = { id: auth.userId };

    // ── GET: list assessments ──────────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const dealId = url.searchParams.get("deal_id");
      const contactId = url.searchParams.get("contact_id");

      let query = supabase.from("needs_assessments").select("*");

      if (dealId) {
        query = query.eq("deal_id", dealId);
      } else if (contactId) {
        query = query.eq("contact_id", contactId);
      } else {
        return safeJsonError("Provide deal_id or contact_id", 400, origin);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        console.error("needs-assessment GET error:", error);
        return safeJsonError("Failed to fetch assessments", 500, origin);
      }

      return safeJsonOk({ assessments: data }, origin);
    }

    // ── POST: create assessment ────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();

      if (!body.deal_id && !body.contact_id) {
        return safeJsonError("deal_id or contact_id is required", 400, origin);
      }

      const { data, error } = await supabase
        .from("needs_assessments")
        .insert({
          ...body,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error("needs-assessment POST error:", error);
        return safeJsonError("Failed to create assessment", 500, origin);
      }

      // If deal_id provided, link assessment to deal
      if (body.deal_id) {
        await supabase
          .from("crm_deals")
          .update({ needs_assessment_id: data.id })
          .eq("id", body.deal_id);
      }

      return safeJsonOk({ assessment: data }, origin, 201);
    }

    // ── PUT: update assessment ─────────────────────────────────────────────
    if (req.method === "PUT") {
      const body = await req.json();

      if (!body.id) {
        return safeJsonError("id is required for update", 400, origin);
      }

      const { id, ...updates } = body;

      const { data, error } = await supabase
        .from("needs_assessments")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("needs-assessment PUT error:", error);
        return safeJsonError("Failed to update assessment", 500, origin);
      }

      return safeJsonOk({ assessment: data }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "needs-assessment", req });
    console.error("needs-assessment error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
