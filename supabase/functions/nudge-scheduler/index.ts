/**
 * Nudge Scheduler Edge Function (Cron: daily at 2 PM ET)
 *
 * Per owner's Prospecting SOP: automated nudge if advisor is under
 * 50% of daily target (5 positive visits) at 2 PM.
 *
 * Auth: service_role (cron invocation)
 *
 * ── Phase 0 P0.4 Day 7 — DUAL-WRITE TO FLOW BUS ────────────────────────────
 *
 * In addition to inserting into crm_in_app_notifications (the existing
 * direct-insert path), this function ALSO publishes a `prospecting.nudge_dispatched`
 * event to the flow bus (supabase/functions/_shared/flow-bus/publish.ts) for
 * each nudge sent. The bus publish is best-effort: a failure logs to sentry
 * but never breaks the primary nudge flow.
 *
 * Cutover: the direct-insert path (crm_in_app_notifications) is retired at
 * the end of Phase 2 Slice 2.2 (Dealer Reality Grid) per main roadmap §15
 * Q3 (Flow Engine cutover date). Until then, BOTH paths run.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { publishFlowEvent } from "../_shared/flow-bus/publish.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    // Phase 0 Wave 4a — accept BOTH legacy Bearer service_role_key AND
    // modern x-internal-service-secret. See _shared/cron-auth.ts and
    // migration 212 for the modern cron pattern.
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    const today = new Date().toISOString().split("T")[0];
    const results = { advisors_checked: 0, nudges_sent: 0 };

    const { data: advisors, error: advisorsErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, active_workspace_id")
      .eq("iron_role", "iron_advisor");

    if (advisorsErr) {
      console.error("nudge-scheduler advisors query:", advisorsErr.message);
      return safeJsonError("Failed to load advisors", 500, null);
    }

    if (!advisors || advisors.length === 0) {
      return safeJsonOk({ ok: true, message: "No Iron Advisors found", results }, null);
    }

    // Check each advisor's KPI for today
    for (const advisor of advisors) {
      results.advisors_checked++;

      const { data: kpi } = await supabaseAdmin
        .from("prospecting_kpis")
        .select("positive_visits, target")
        .eq("rep_id", advisor.id)
        .eq("kpi_date", today)
        .maybeSingle();

      const positiveVisits = kpi?.positive_visits ?? 0;
      const target = kpi?.target ?? 10;
      const halfTarget = Math.floor(target / 2);

      if (positiveVisits < halfTarget) {
        // Check if we already sent a nudge today
        const { data: existingNudge } = await supabaseAdmin
          .from("crm_in_app_notifications")
          .select("id")
          .eq("user_id", advisor.id)
          .eq("kind", "prospecting_nudge")
          .gte("created_at", `${today}T00:00:00`)
          .maybeSingle();

        if (!existingNudge) {
          const remaining = target - positiveVisits;
          const workspaceId = advisor.active_workspace_id ?? "default";
          const { error: insertErr } = await supabaseAdmin.from("crm_in_app_notifications").insert({
            workspace_id: workspaceId,
            user_id: advisor.id,
            kind: "prospecting_nudge",
            title: "Prospecting Target Update",
            body: `${positiveVisits} of ${target} positive visits completed today. ${remaining} more needed to hit target. You've got this!`,
            metadata: {
              positive_visits: positiveVisits,
              target,
              remaining,
              nudge_type: "2pm_check",
            },
          });
          if (insertErr) {
            console.error("nudge-scheduler insert failed:", insertErr.message, "user", advisor.id);
          } else {
            results.nudges_sent++;

            // ── Day 7 dual-write to flow bus ──
            // Best-effort: failure logs but never breaks the primary nudge.
            try {
              await publishFlowEvent(supabaseAdmin, {
                workspaceId,
                eventType: "prospecting.nudge_dispatched",
                sourceModule: "nudge-scheduler",
                suggestedOwner: advisor.id,
                severity: positiveVisits === 0 ? "high" : "medium",
                commercialRelevance: "medium",
                requiredAction: `Hit ${remaining} more positive visits today`,
                payload: {
                  user_id: advisor.id,
                  positive_visits: positiveVisits,
                  target,
                  remaining,
                  nudge_type: "2pm_check",
                  kpi_date: today,
                },
                idempotencyKey: `nudge:${advisor.id}:${today}`,
              });
            } catch (busErr) {
              console.error(
                "[nudge-scheduler] flow bus publish failed:",
                busErr instanceof Error ? busErr.message : busErr,
              );
              captureEdgeException(busErr, {
                fn: "nudge-scheduler",
                req,
                extra: { phase: "bus_publish", advisor_id: advisor.id },
              });
            }
          }
        }
      }
    }

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "nudge-scheduler", req });
    console.error("nudge-scheduler error:", err);
    return safeJsonError("Internal server error", 500, null);
  }
});
