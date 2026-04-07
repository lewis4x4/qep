/**
 * Prospecting Tracker Edge Function
 *
 * Log field visits with quality validation, calculate daily KPIs,
 * trigger manager alerts.
 *
 * GET:  ?rep_id=...&date=... → KPI status for rep on date
 * POST: Log a prospecting visit
 *
 * Auth: rep/admin/manager/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
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

    // ── GET: KPI status ──────────────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const repId = url.searchParams.get("rep_id") || user.id;
      const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];

      // Get KPI for the day
      const { data: kpi } = await supabase
        .from("prospecting_kpis")
        .select("*")
        .eq("rep_id", repId)
        .eq("kpi_date", date)
        .maybeSingle();

      // Get today's visits
      const { data: visits } = await supabase
        .from("prospecting_visits")
        .select("*")
        .eq("rep_id", repId)
        .eq("visit_date", date)
        .order("created_at", { ascending: false });

      return safeJsonOk({
        kpi: kpi || {
          total_visits: 0,
          positive_visits: 0,
          target: 10,
          target_met: false,
          consecutive_days_met: 0,
        },
        visits: visits || [],
        progress_pct: Math.min(100, ((kpi?.positive_visits ?? 0) / 10) * 100),
      }, origin);
    }

    // ── POST: log visit ──────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();

      // At least one quality criterion must be true for a meaningful visit
      const hasQualityCriteria =
        body.spoke_with_decision_maker ||
        body.identified_need_or_opportunity ||
        body.equipment_discussion ||
        body.followed_up_on_active_deal;

      const { data: visit, error: visitError } = await supabase
        .from("prospecting_visits")
        .insert({
          rep_id: user.id,
          visit_date: body.visit_date || new Date().toISOString().split("T")[0],
          contact_id: body.contact_id,
          company_id: body.company_id,
          location_name: body.location_name,
          location_lat: body.location_lat,
          location_lng: body.location_lng,
          spoke_with_decision_maker: body.spoke_with_decision_maker || false,
          identified_need_or_opportunity: body.identified_need_or_opportunity || false,
          equipment_discussion: body.equipment_discussion || false,
          followed_up_on_active_deal: body.followed_up_on_active_deal || false,
          contact_name: body.contact_name,
          contact_role: body.contact_role,
          conversation_summary: body.conversation_summary,
          opportunities_identified: body.opportunities_identified,
          competitive_equipment_on_site: body.competitive_equipment_on_site,
          next_action: body.next_action,
          follow_up_date: body.follow_up_date,
          deal_id: body.deal_id,
          voice_capture_id: body.voice_capture_id,
        })
        .select()
        .single();

      if (visitError) {
        console.error("prospecting-tracker POST error:", visitError);
        return safeJsonError("Failed to log visit", 500, origin);
      }

      // Get updated KPI
      const { data: kpi } = await supabase
        .from("prospecting_kpis")
        .select("*")
        .eq("rep_id", user.id)
        .eq("kpi_date", body.visit_date || new Date().toISOString().split("T")[0])
        .maybeSingle();

      return safeJsonOk({
        visit,
        kpi,
        is_positive: hasQualityCriteria,
        progress_pct: Math.min(100, ((kpi?.positive_visits ?? 0) / 10) * 100),
      }, origin, 201);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "prospecting-tracker", req });
    console.error("prospecting-tracker error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
