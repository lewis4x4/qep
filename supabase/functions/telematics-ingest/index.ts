/**
 * Telematics Ingest Edge Function
 *
 * Ingests equipment telematics data (hours, GPS, alerts) from device providers.
 * Adapter pattern: provider-specific parsing, unified storage.
 *
 * POST /reading: Submit a telematics reading
 * POST /sync: Trigger sync for all active feeds
 * GET /feeds: List active telematics feeds
 *
 * Auth: service_role (device webhooks) or admin/owner (manual)
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
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

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    // Only create admin client when actually needed
    let supabaseAdmin: SupabaseClient | null = null;
    if (isServiceRole) {
      supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey!,
      );
    }

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      // Create admin client only after user is verified
      supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey!,
      );

      const { data: profile } = await supabaseAdmin
        .from("profiles").select("role").eq("id", user.id).single();
      if (!profile || !["admin", "owner"].includes(profile.role)) {
        return safeJsonError("Telematics requires admin/owner role", 403, origin);
      }
    }

    if (!supabaseAdmin) {
      return safeJsonError("Server misconfiguration", 500, origin);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    // GET /feeds
    if (req.method === "GET" && action === "feeds") {
      const { data, error } = await supabaseAdmin
        .from("telematics_feeds")
        .select("*")
        .eq("is_active", true)
        .order("provider");
      if (error) return safeJsonError("Failed to load feeds", 500, origin);
      return safeJsonOk({ feeds: data }, origin);
    }

    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const body = await req.json();

    // POST /reading: Ingest a single reading
    if (action === "reading") {
      if (!body.device_id) {
        return safeJsonError("device_id required", 400, origin);
      }

      // Find the feed for this device
      const { data: feed } = await supabaseAdmin
        .from("telematics_feeds")
        .select("id, equipment_id, subscription_id")
        .eq("device_id", body.device_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!feed) {
        return safeJsonError("Unknown device — no active feed found", 404, origin);
      }

      // Update feed with latest reading
      await supabaseAdmin
        .from("telematics_feeds")
        .update({
          last_reading_at: new Date().toISOString(),
          last_hours: body.hours ?? null,
          last_lat: body.lat ?? null,
          last_lng: body.lng ?? null,
        })
        .eq("id", feed.id);

      // If linked to EaaS subscription, update usage record
      if (feed.subscription_id && body.hours != null) {
        const today = new Date().toISOString().split("T")[0];
        const monthStart = today.substring(0, 7) + "-01";

        await supabaseAdmin
          .from("eaas_usage_records")
          .upsert({
            subscription_id: feed.subscription_id,
            period_start: monthStart,
            period_end: today,
            hours_used: body.hours,
            source: "telematics",
            telematics_device_id: body.device_id,
          }, { onConflict: "subscription_id,period_start" });
      }

      return safeJsonOk({ ok: true, feed_id: feed.id }, origin);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "telematics-ingest", req });
    console.error("telematics-ingest error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
