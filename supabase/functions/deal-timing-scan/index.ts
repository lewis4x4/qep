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
 *
 * ── Phase 0 P0.4 Day 7 — DUAL-WRITE TO FLOW BUS ────────────────────────────
 *
 * In addition to inserting into deal_timing_alerts (via the
 * compute_deal_timing_alerts RPC) and crm_in_app_notifications (the existing
 * direct-insert paths), this function ALSO publishes a
 * `deal_timing.alert_generated` event to the flow bus
 * (supabase/functions/_shared/flow-bus/publish.ts) for each immediate-urgency
 * alert. The bus publish is best-effort: a failure logs to sentry but never
 * breaks the primary alert flow.
 *
 * Cutover: the direct-insert paths (deal_timing_alerts +
 * crm_in_app_notifications) are retired at the end of Phase 2 Slice 2.2 per
 * main roadmap §15 Q3.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { publishFlowEvent } from "../_shared/flow-bus/publish.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    // Phase 0 Wave 4a — service-role gate accepts BOTH legacy Bearer
    // service_role_key AND modern x-internal-service-secret. The latter
    // is the only path the modern pg_cron migration (212) can use because
    // the legacy GUC-based service-role key lookup no longer works.
    const isServiceRole = isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();

    // Reject anonymous requests that have neither auth header. Either a
    // user JWT (Authorization: Bearer <jwt>) or a service-role credential
    // (handled by isServiceRoleCaller above) is required.
    if (!isServiceRole && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader! } } },
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
        .select("id, title, description, assigned_rep_id, alert_type, urgency, actioned_deal_id, customer_profile_id, recommended_action")
        .eq("urgency", "immediate")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);

      let notificationsSent = 0;
      let busPublished = 0;
      let busFailed = 0;
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

          // ── Day 7 dual-write to flow bus ──
          // One bus event per alert (NOT per recipient — the alert is the
          // logical event, recipients are dispatch metadata). Idempotency
          // key is the alert_id so re-runs of this function for the same
          // alert dedupe cleanly. Best-effort: failure logs but never
          // breaks the notification flow.
          try {
            await publishFlowEvent(supabaseAdmin, {
              workspaceId: "default",
              eventType: "deal_timing.alert_generated",
              sourceModule: "deal-timing-scan",
              sourceRecordId: alert.id,
              dealId: alert.actioned_deal_id ?? undefined,
              customerId: alert.customer_profile_id ?? undefined,
              suggestedOwner: alert.assigned_rep_id ?? undefined,
              severity: "high", // immediate urgency = high severity
              commercialRelevance: "high",
              requiredAction: alert.recommended_action ?? alert.title,
              draftMessage: alert.description ?? undefined,
              payload: {
                alert_id: alert.id,
                alert_type: alert.alert_type,
                urgency: alert.urgency,
                title: alert.title,
              },
              idempotencyKey: `deal_timing.alert_generated:${alert.id}`,
            });
            busPublished++;
          } catch (busErr) {
            busFailed++;
            console.error(
              "[deal-timing-scan] flow bus publish failed:",
              busErr instanceof Error ? busErr.message : busErr,
            );
            captureEdgeException(busErr, {
              fn: "deal-timing-scan",
              req,
              extra: { phase: "bus_publish", alert_id: alert.id },
            });
          }
        }
      }

      console.log(
        `[deal-timing-scan] alerts=${immediateAlerts?.length ?? 0} ` +
          `notifications_sent=${notificationsSent} bus_published=${busPublished} bus_failed=${busFailed}`,
      );

      return safeJsonOk({
        ok: true,
        alerts_generated: alertCount,
        notifications_sent: notificationsSent,
        bus_published: busPublished,
        bus_failed: busFailed,
      }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "deal-timing-scan", req });
    console.error("deal-timing-scan error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
