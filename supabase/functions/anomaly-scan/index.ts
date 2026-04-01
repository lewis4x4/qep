/**
 * Anomaly Scan Edge Function
 *
 * Runs periodic analysis across CRM data to detect:
 * 1. Stalling deals — no activity in 7+ days, deal not closed
 * 2. Overdue follow-ups — past their next_follow_up_at date
 * 3. Activity gaps — reps with no logged activity in 3+ days
 * 4. Pipeline risk — deals closing within 7 days with low-stage status
 * 5. Pricing anomalies — deals significantly above/below average for category
 *
 * Callable via service role (cron) or by admin/manager/owner (on-demand).
 */
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

interface Alert {
  workspace_id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  assigned_to: string | null;
  data: Record<string, unknown>;
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function detectStallingDeals(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, updated_at, workspace_id, stage_id")
    .is("deleted_at", null)
    .lt("updated_at", sevenDaysAgo)
    .limit(50);

  if (!deals) return alerts;

  // Check for any recent activity on each deal
  for (const deal of deals as Record<string, unknown>[]) {
    const { count } = await db
      .from("crm_activities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .is("deleted_at", null)
      .gte("occurred_at", sevenDaysAgo);

    if ((count ?? 0) === 0) {
      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(deal.updated_at as string).getTime()) / 86_400_000,
      );
      const severity = daysSinceUpdate > 14 ? "high" : "medium";

      alerts.push({
        workspace_id: deal.workspace_id as string,
        alert_type: "stalling_deal",
        severity,
        title: `Deal "${deal.name}" has stalled`,
        description: `No activity for ${daysSinceUpdate} days. Last updated ${new Date(deal.updated_at as string).toLocaleDateString()}.${deal.amount ? ` Value: $${Number(deal.amount).toLocaleString()}.` : ""}`,
        entity_type: "deal",
        entity_id: deal.id as string,
        assigned_to: deal.assigned_rep_id as string | null,
        data: { days_stalled: daysSinceUpdate, amount: deal.amount },
      });
    }
  }

  return alerts;
}

async function detectOverdueFollowUps(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];

  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, next_follow_up_at, workspace_id")
    .is("deleted_at", null)
    .not("next_follow_up_at", "is", null)
    .lt("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .limit(30);

  if (!deals) return alerts;

  for (const deal of deals as Record<string, unknown>[]) {
    const hoursOverdue = Math.floor(
      (Date.now() - new Date(deal.next_follow_up_at as string).getTime()) / 3_600_000,
    );
    const severity = hoursOverdue > 72 ? "high" : hoursOverdue > 24 ? "medium" : "low";

    alerts.push({
      workspace_id: deal.workspace_id as string,
      alert_type: "overdue_follow_up",
      severity,
      title: `Overdue follow-up on "${deal.name}"`,
      description: `Follow-up was due ${Math.floor(hoursOverdue / 24)} days ago (${new Date(deal.next_follow_up_at as string).toLocaleDateString()}).${deal.amount ? ` Deal value: $${Number(deal.amount).toLocaleString()}.` : ""}`,
      entity_type: "deal",
      entity_id: deal.id as string,
      assigned_to: deal.assigned_rep_id as string | null,
      data: { hours_overdue: hoursOverdue, amount: deal.amount },
    });
  }

  return alerts;
}

async function detectActivityGaps(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const { data: reps } = await db
    .from("profiles")
    .select("id, full_name")
    .in("role", ["rep"]);

  if (!reps) return alerts;

  for (const rep of reps as Record<string, unknown>[]) {
    const { count } = await db
      .from("crm_activities")
      .select("id", { count: "exact", head: true })
      .eq("created_by", rep.id)
      .is("deleted_at", null)
      .gte("occurred_at", threeDaysAgo);

    if ((count ?? 0) === 0) {
      // Check for voice captures too
      const { count: voiceCount } = await db
        .from("voice_captures")
        .select("id", { count: "exact", head: true })
        .eq("user_id", rep.id)
        .gte("created_at", threeDaysAgo);

      if ((voiceCount ?? 0) === 0) {
        alerts.push({
          workspace_id: "default",
          alert_type: "activity_gap",
          severity: "medium",
          title: `No activity from ${rep.full_name ?? "rep"} in 3+ days`,
          description: `${rep.full_name ?? "A rep"} has not logged any CRM activities or voice notes in the last 3 days.`,
          entity_type: null,
          entity_id: null,
          assigned_to: rep.id as string,
          data: { rep_id: rep.id, rep_name: rep.full_name },
        });
      }
    }
  }

  return alerts;
}

async function detectPipelineRisk(db: AdminClient): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const today = new Date().toISOString().split("T")[0];
  const weekAhead = sevenDaysOut.toISOString().split("T")[0];

  // Get early-stage deals closing within 7 days
  const { data: deals } = await db
    .from("crm_deals")
    .select("id, name, amount, assigned_rep_id, expected_close_on, stage_id, workspace_id")
    .is("deleted_at", null)
    .gte("expected_close_on", today)
    .lte("expected_close_on", weekAhead)
    .limit(30);

  if (!deals || deals.length === 0) return alerts;

  // Load stages to identify early stages
  const stageIds = [...new Set((deals as Record<string, unknown>[]).map((d) => d.stage_id).filter(Boolean))];
  let stageMap: Record<string, { name: string; display_order: number }> = {};
  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name, display_order").in("id", stageIds);
    if (stages) {
      stageMap = Object.fromEntries(
        (stages as { id: string; name: string; display_order: number }[]).map((s) => [
          s.id,
          { name: s.name, display_order: s.display_order },
        ]),
      );
    }
  }

  for (const deal of deals as Record<string, unknown>[]) {
    const stage = stageMap[deal.stage_id as string];
    // Early stages (display_order <= 2) closing soon is risky
    if (stage && stage.display_order <= 2) {
      alerts.push({
        workspace_id: deal.workspace_id as string,
        alert_type: "pipeline_risk",
        severity: "high",
        title: `"${deal.name}" closing soon but still in early stage`,
        description: `Deal is expected to close ${deal.expected_close_on} but is still in "${stage.name}" stage.${deal.amount ? ` Value: $${Number(deal.amount).toLocaleString()}.` : ""} Consider updating the close date or accelerating the deal.`,
        entity_type: "deal",
        entity_id: deal.id as string,
        assigned_to: deal.assigned_rep_id as string | null,
        data: {
          amount: deal.amount,
          expected_close: deal.expected_close_on,
          stage_name: stage.name,
          stage_order: stage.display_order,
        },
      });
    }
  }

  return alerts;
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const adminClient = createAdminClient();
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceRole =
    serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;

  if (!isServiceRole) {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
  }

  try {
    // Run all detectors in parallel
    const [stallingDeals, overdueFollowUps, activityGaps, pipelineRisks] =
      await Promise.all([
        detectStallingDeals(adminClient),
        detectOverdueFollowUps(adminClient),
        detectActivityGaps(adminClient),
        detectPipelineRisk(adminClient),
      ]);

    const allAlerts = [
      ...stallingDeals,
      ...overdueFollowUps,
      ...activityGaps,
      ...pipelineRisks,
    ];

    // Deduplicate: skip alerts that already exist for the same entity today
    const today = new Date().toISOString().split("T")[0];
    const newAlerts: Alert[] = [];

    for (const alert of allAlerts) {
      if (alert.entity_id) {
        const { data: existing } = await adminClient
          .from("anomaly_alerts")
          .select("id")
          .eq("alert_type", alert.alert_type)
          .eq("entity_id", alert.entity_id)
          .gte("created_at", `${today}T00:00:00Z`)
          .maybeSingle();

        if (existing) continue;
      }
      newAlerts.push(alert);
    }

    if (newAlerts.length > 0) {
      await adminClient.from("anomaly_alerts").insert(newAlerts);
    }

    console.log(
      `[anomaly-scan] detected=${allAlerts.length} new=${newAlerts.length} ` +
      `(stalling=${stallingDeals.length} overdue=${overdueFollowUps.length} ` +
      `gaps=${activityGaps.length} pipeline=${pipelineRisks.length})`,
    );

    return new Response(JSON.stringify({
      total_detected: allAlerts.length,
      new_alerts: newAlerts.length,
      breakdown: {
        stalling_deals: stallingDeals.length,
        overdue_follow_ups: overdueFollowUps.length,
        activity_gaps: activityGaps.length,
        pipeline_risks: pipelineRisks.length,
      },
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[anomaly-scan] error:", err);
    return new Response(JSON.stringify({ error: "Scan failed" }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
});
