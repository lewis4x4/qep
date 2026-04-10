/**
 * Pipeline Enforcer Edge Function (Cron: every 5 minutes)
 *
 * SLA violation checks:
 *   - Stage 1→2: Lead response — alert at 10 min, escalate at 15 min
 *   - Stage 3→6: Needs assessment to quote — alert at 45 min, escalate at 60 min
 *   - Stage 7→8: Quote sent to presented — alert at 20 min, escalate at 30 min
 *   - Any deal: 7-day staleness flag
 *
 * Gate enforcement:
 *   - Margin check at Stage 13 (<10% flags for Iron Manager review)
 *   - Deposit gate at Stage 16 (notification, actual block is in DB trigger)
 *
 * Auth: service_role (cron invocation)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";

interface DealStageSummary {
  name: string;
  sort_order: number | null;
  sla_minutes: number | null;
}

interface SlaViolationRow {
  id: string;
  name: string;
  assigned_rep_id: string | null;
  sla_started_at: string | null;
  sla_deadline_at: string | null;
  crm_deal_stages: DealStageSummary | DealStageSummary[] | null;
}

interface MarginFlagRow {
  id: string;
  name: string;
  margin_pct: number | null;
}

interface StaleDealRow {
  id: string;
  name: string;
  assigned_rep_id: string | null;
  last_activity_at: string | null;
  crm_deal_stages: DealStageSummary | DealStageSummary[] | null;
}

function getStageSummary(stage: DealStageSummary | DealStageSummary[] | null): DealStageSummary | null {
  if (Array.isArray(stage)) return stage[0] ?? null;
  return stage;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    // Validate service role auth — cron-only function
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    const results = {
      sla_violations_found: 0,
      alerts_created: 0,
      escalations_created: 0,
      margin_flags: 0,
      stale_deals: 0,
    };

    // Pre-fetch Iron Managers once (avoids N+1 per-deal lookup)
    const { data: managers } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("iron_role", "iron_manager");
    const managerIds = (managers ?? []).map((m) => m.id);

    // ── 1. SLA Violations ─────────────────────────────────────────────────
    // Find deals with expired SLA deadlines that haven't been alerted yet

    const { data: slaViolations } = await supabaseAdmin
      .from("crm_deals")
      .select(`
        id, name, assigned_rep_id, stage_id, sla_started_at, sla_deadline_at,
        crm_deal_stages!inner(name, sort_order, sla_minutes)
      `)
      .not("sla_deadline_at", "is", null)
      .lt("sla_deadline_at", new Date().toISOString())
      .is("deleted_at", null);

    const typedSlaViolations = (slaViolations ?? []) as SlaViolationRow[];
    if (typedSlaViolations.length > 0) {
      results.sla_violations_found = typedSlaViolations.length;

      for (const deal of typedSlaViolations) {
        const stage = getStageSummary(deal.crm_deal_stages);
        if (!stage || !deal.sla_deadline_at || !deal.sla_started_at) continue;
        const now = new Date();
        const deadline = new Date(deal.sla_deadline_at);
        const minutesPast = Math.floor((now.getTime() - deadline.getTime()) / 60000);

        // Check if we already notified for this SLA period
        const { data: existingAlert } = await supabaseAdmin
          .from("crm_in_app_notifications")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("kind", "sla_violation")
          .gte("created_at", deal.sla_started_at)
          .maybeSingle();

        if (existingAlert) continue;

        // Alert the assigned rep
        if (deal.assigned_rep_id) {
          await supabaseAdmin.from("crm_in_app_notifications").insert({
            workspace_id: "default",
            user_id: deal.assigned_rep_id,
            kind: "sla_violation",
            title: `SLA Violation: ${deal.name}`,
            body: `${stage.name} stage SLA exceeded by ${minutesPast} minutes. Required: ${stage.sla_minutes} min.`,
            deal_id: deal.id,
            metadata: {
              stage_name: stage.name,
              sort_order: stage.sort_order,
              sla_minutes: stage.sla_minutes,
              minutes_past: minutesPast,
              type: "alert",
            },
          });
          results.alerts_created++;
        }

        // Escalate to Iron Managers if significantly past SLA
        if (minutesPast >= (stage.sla_minutes || 15)) {
          if (managerIds.length > 0) {
            for (const mgrId of managerIds) {
              await supabaseAdmin.from("crm_in_app_notifications").insert({
                workspace_id: "default",
                user_id: mgrId,
                kind: "sla_escalation",
                title: `SLA Escalation: ${deal.name}`,
                body: `${stage.name} SLA exceeded by ${minutesPast} minutes. Assigned rep has been alerted.`,
                deal_id: deal.id,
                metadata: {
                  stage_name: stage.name,
                  sort_order: stage.sort_order,
                  assigned_rep_id: deal.assigned_rep_id,
                  minutes_past: minutesPast,
                  type: "escalation",
                },
              });
            }
            results.escalations_created++;
          }
        }
      }
    }

    // ── 2. Margin Check Flags ─────────────────────────────────────────────
    // Find deals at Stage 13 with flagged margins that haven't been notified

    const { data: marginFlags } = await supabaseAdmin
      .from("crm_deals")
      .select(`
        id, name, assigned_rep_id, margin_pct, margin_check_status,
        crm_deal_stages!inner(sort_order)
      `)
      .eq("margin_check_status", "flagged")
      .is("deleted_at", null);

    const typedMarginFlags = (marginFlags ?? []) as MarginFlagRow[];
    if (typedMarginFlags.length > 0) {
      for (const deal of typedMarginFlags) {
        // Check if already notified
        const { data: existingNotif } = await supabaseAdmin
          .from("crm_in_app_notifications")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("kind", "margin_flag")
          .maybeSingle();

        if (existingNotif) continue;

        if (managerIds.length > 0) {
          for (const managerId of managerIds) {
            await supabaseAdmin.from("crm_in_app_notifications").insert({
              workspace_id: "default",
              user_id: managerId,
              kind: "margin_flag",
              title: `Low Margin Alert: ${deal.name}`,
              body: `Deal margin is ${deal.margin_pct?.toFixed(1)}% (below 10% threshold). Manager approval required.`,
              deal_id: deal.id,
              metadata: {
                margin_pct: deal.margin_pct,
                type: "margin_review",
              },
            });
          }
          results.margin_flags++;
        }
      }
    }

    // ── 3. Stale Deal Detection ───────────────────────────────────────────
    // Deals with no activity in 7+ days (not in terminal stages 20-21)

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: staleDeals } = await supabaseAdmin
      .from("crm_deals")
      .select(`
        id, name, assigned_rep_id, last_activity_at,
        crm_deal_stages!inner(sort_order, name)
      `)
      .lt("last_activity_at", sevenDaysAgo.toISOString())
      .is("deleted_at", null);

    const typedStaleDeals = (staleDeals ?? []) as StaleDealRow[];
    if (typedStaleDeals.length > 0) {
      for (const deal of typedStaleDeals) {
        const stage = getStageSummary(deal.crm_deal_stages);
        if (!stage || !deal.last_activity_at) continue;
        // Skip terminal stages
        if ((stage.sort_order ?? 0) >= 20) continue;

        const { data: existingStale } = await supabaseAdmin
          .from("crm_in_app_notifications")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("kind", "stale_deal")
          .gte("created_at", sevenDaysAgo.toISOString())
          .maybeSingle();

        if (existingStale) continue;

        if (deal.assigned_rep_id) {
          const daysSince = Math.floor(
            (Date.now() - new Date(deal.last_activity_at).getTime()) / 86400000,
          );
          await supabaseAdmin.from("crm_in_app_notifications").insert({
            workspace_id: "default",
            user_id: deal.assigned_rep_id,
            kind: "stale_deal",
            title: `Stale Deal: ${deal.name}`,
            body: `No activity in ${daysSince} days (Stage: ${stage.name}). Update QRM or move to lost.`,
            deal_id: deal.id,
            metadata: { days_stale: daysSince, stage_name: stage.name },
          });
          results.stale_deals++;
        }
      }
    }

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    captureEdgeException(err, { fn: "pipeline-enforcer", req });
    console.error("pipeline-enforcer error:", err);
    return safeJsonError("Internal server error", 500, null);
  }
});
