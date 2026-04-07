/**
 * Nudge Scheduler Edge Function (Cron: daily at 2 PM ET)
 *
 * Per owner's Prospecting SOP: automated nudge if advisor is under
 * 50% of daily target (5 positive visits) at 2 PM.
 *
 * Auth: service_role (cron invocation)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
/** Workspace for notifications — from profile_workspaces (migration 115), not profiles.workspace_id. */
function primaryWorkspaceId(advisor: {
  profile_workspaces?: { workspace_id: string }[] | null;
}): string {
  const rows = advisor.profile_workspaces;
  if (Array.isArray(rows) && rows.length > 0 && rows[0]?.workspace_id) {
    return rows[0].workspace_id;
  }
  return "default";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    const today = new Date().toISOString().split("T")[0];
    const results = { advisors_checked: 0, nudges_sent: 0 };

    const { data: advisors, error: advisorsErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, profile_workspaces(workspace_id)")
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
          const { error: insertErr } = await supabaseAdmin.from("crm_in_app_notifications").insert({
            workspace_id: primaryWorkspaceId(advisor),
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
