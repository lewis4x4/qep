/**
 * Deal Timing Scan Edge Function (Cron or Manual)
 *
 * Moonshot 1: The Deal Timing Engine.
 * Scans fleet intelligence, budget cycles, price increases, seasonal
 * patterns, and trade-in interest to generate proactive timing alerts.
 *
 * Ryan: "where we miss out is not being in front of the customer
 *        when they're ready to purchase."
 *
 * POST: Run timing scan for workspace
 * GET:  Dashboard data (aggregated alerts)
 *
 * Auth: service_role (cron) or manager/owner (manual)
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

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || !["manager", "owner"].includes(profile.role)) {
        return safeJsonError("Deal timing requires manager or owner role", 403, origin);
      }
    }

    // GET: Dashboard data
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin.rpc("get_timing_dashboard", {
        p_workspace_id: "default",
      });

      if (error) {
        console.error("get_timing_dashboard error:", error);
        return safeJsonError("Failed to load timing dashboard", 500, origin);
      }

      return safeJsonOk(data, origin);
    }

    // POST: Run timing scan
    if (req.method === "POST") {
      const { data: alertCount, error } = await supabaseAdmin.rpc("compute_deal_timing_alerts", {
        p_workspace_id: "default",
      });

      if (error) {
        console.error("compute_deal_timing_alerts error:", error);
        return safeJsonError("Timing scan failed", 500, origin);
      }

      // Send notifications for immediate-urgency alerts
      const { data: immediateAlerts } = await supabaseAdmin
        .from("deal_timing_alerts")
        .select("id, title, description, assigned_rep_id")
        .eq("urgency", "immediate")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);

      let notificationsSent = 0;
      if (immediateAlerts) {
        // Get all managers for alerts without assigned reps
        const { data: managers } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("iron_role", "iron_manager");
        const managerIds = (managers ?? []).map((m) => m.id);

        for (const alert of immediateAlerts) {
          const recipients = alert.assigned_rep_id
            ? [alert.assigned_rep_id]
            : managerIds;

          for (const uid of recipients) {
            const { error: notifErr } = await supabaseAdmin.from("crm_in_app_notifications").insert({
              workspace_id: "default",
              user_id: uid,
              kind: "deal_timing_alert",
              title: alert.title,
              body: alert.description || "Timing alert — action required.",
              metadata: { alert_id: alert.id, urgency: "immediate" },
            });
            if (!notifErr) notificationsSent++;
          }
        }
      }

      return safeJsonOk({
        ok: true,
        alerts_generated: alertCount,
        notifications_sent: notificationsSent,
      }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "deal-timing-scan", req });
    console.error("deal-timing-scan error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
