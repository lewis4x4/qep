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
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import type { TelematicsUsageSnapshot } from "../../../shared/qep-moonshot-contracts.ts";
import { normalizeTelematicsReading } from "../_shared/telematics-adapter-registry.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim() ?? null;
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
      const auth = await requireServiceUser(authHeader, origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "owner"].includes(auth.role)) {
        return safeJsonError(
          "Telematics requires admin/owner role",
          403,
          origin,
        );
      }

      supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey!,
      );
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

    const body = await req.json() as Record<string, unknown>;

    // POST /reading: Ingest a single provider-normalized reading.
    if (action === "reading") {
      let normalized;
      try {
        normalized = normalizeTelematicsReading(body);
      } catch (error) {
        return safeJsonError(
          error instanceof Error ? error.message : "Invalid reading",
          400,
          origin,
        );
      }

      const reading: TelematicsUsageSnapshot = {
        deviceId: normalized.deviceId,
        hours: normalized.hours,
        lat: normalized.lat,
        lng: normalized.lng,
        readingAt: normalized.readingAt,
      };
      const providerFilter = typeof body.provider === "string" ||
          typeof body.provider_key === "string" ||
          typeof body.source === "string"
        ? normalized.provider
        : null;

      // Find the feed for this provider/device. Workspace/provider fields are
      // optional for legacy callers, but when present they prevent cross-tenant
      // or cross-provider ambiguity under service-role ingestion.
      let feedQuery = supabaseAdmin
        .from("telematics_feeds")
        .select("id, equipment_id, subscription_id")
        .eq("device_id", reading.deviceId)
        .eq("is_active", true);

      if (providerFilter) {
        feedQuery = feedQuery.eq("provider", providerFilter);
      }
      if (normalized.workspaceId) {
        feedQuery = feedQuery.eq("workspace_id", normalized.workspaceId);
      }

      const { data: feeds, error: feedError } = await feedQuery.limit(2);
      if (feedError) {
        return safeJsonError("Failed to resolve telematics feed", 500, origin);
      }

      if (!feeds || feeds.length === 0) {
        return safeJsonError(
          "Unknown device — no active feed found",
          404,
          origin,
        );
      }
      if (feeds.length > 1) {
        return safeJsonError(
          "Ambiguous device — provider or workspace required",
          409,
          origin,
        );
      }

      const feed = feeds[0];

      // Update feed with latest reading
      await supabaseAdmin
        .from("telematics_feeds")
        .update({
          last_reading_at: reading.readingAt,
          last_hours: reading.hours,
          last_lat: reading.lat,
          last_lng: reading.lng,
        })
        .eq("id", feed.id);

      // If linked to EaaS subscription, update usage record
      if (feed.subscription_id && reading.hours != null) {
        const today = new Date().toISOString().split("T")[0];
        const monthStart = today.substring(0, 7) + "-01";

        await supabaseAdmin
          .from("eaas_usage_records")
          .upsert({
            subscription_id: feed.subscription_id,
            period_start: monthStart,
            period_end: today,
            hours_used: reading.hours,
            source: "telematics",
            telematics_device_id: reading.deviceId,
          }, { onConflict: "subscription_id,period_start" });
      }

      return safeJsonOk({ ok: true, feed_id: feed.id }, origin);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "telematics-ingest", req });
    console.error("telematics-ingest error:", err);
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("origin"),
    );
  }
});
