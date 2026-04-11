/**
 * Morning Briefing Edge Function
 *
 * Generates personalized daily briefings for each active user:
 * - Pipeline snapshot (deals closing soon, overdue follow-ups)
 * - Yesterday's activity summary
 * - Actionable items for today
 *
 * Can be called per-user (with auth) or for all users (via service role / cron).
 */
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { safeCorsHeaders as corsHeaders, optionsResponse } from "../_shared/safe-cors.ts";

const BRIEFING_MODEL = "gpt-5.4-mini";

interface UserBriefingData {
  userId: string;
  fullName: string;
  role: string;
  dealsClosingSoon: Array<{
    name: string;
    amount: number | null;
    expected_close: string;
    stage: string | null;
    company: string | null;
  }>;
  overdueFollowUps: Array<{
    name: string;
    amount: number | null;
    follow_up_date: string;
    company: string | null;
  }>;
  recentActivities: Array<{
    type: string;
    body: string | null;
    date: string;
  }>;
  pipelineTotal: number;
  openDealCount: number;
  newVoiceNotes: number;
}

async function gatherUserData(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<UserBriefingData | null> {
  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const weekAhead = sevenDaysOut.toISOString().split("T")[0];

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = yesterday.toISOString();

  const [closingDeals, overdueDeals, activities, allDeals, voiceNotes] = await Promise.all([
    db.from("crm_deals")
      .select("id, name, amount, expected_close_on, stage_id, company_id")
      .eq("assigned_rep_id", userId)
      .is("deleted_at", null)
      .gte("expected_close_on", today)
      .lte("expected_close_on", weekAhead)
      .order("expected_close_on", { ascending: true })
      .limit(10),

    db.from("crm_deals")
      .select("id, name, amount, next_follow_up_at, company_id")
      .eq("assigned_rep_id", userId)
      .is("deleted_at", null)
      .lt("next_follow_up_at", new Date().toISOString())
      .order("next_follow_up_at", { ascending: true })
      .limit(10),

    db.from("crm_activities")
      .select("id, activity_type, body, occurred_at")
      .eq("created_by", userId)
      .is("deleted_at", null)
      .gte("occurred_at", yesterdayIso)
      .order("occurred_at", { ascending: false })
      .limit(15),

    db.from("crm_deals")
      .select("id, amount")
      .eq("assigned_rep_id", userId)
      .is("deleted_at", null),

    db.from("voice_captures")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", yesterdayIso),
  ]);

  // Resolve FKs
  const stageIds = [...new Set([
    ...(closingDeals.data ?? []).map((d: Record<string, unknown>) => d.stage_id),
  ].filter(Boolean))];
  const companyIds = [...new Set([
    ...(closingDeals.data ?? []).map((d: Record<string, unknown>) => d.company_id),
    ...(overdueDeals.data ?? []).map((d: Record<string, unknown>) => d.company_id),
  ].filter(Boolean))];

  let stageMap: Record<string, string> = {};
  let companyMap: Record<string, string> = {};

  if (stageIds.length > 0) {
    const { data: stages } = await db.from("crm_deal_stages").select("id, name").in("id", stageIds);
    if (stages) stageMap = Object.fromEntries((stages as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  }
  if (companyIds.length > 0) {
    const { data: companies } = await db.from("crm_companies").select("id, name").in("id", companyIds);
    if (companies) companyMap = Object.fromEntries((companies as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  }

  const pipelineTotal = (allDeals.data ?? []).reduce(
    (sum: number, d: Record<string, unknown>) => sum + (Number(d.amount) || 0), 0,
  );

  return {
    userId,
    fullName: (profile as Record<string, unknown>).full_name as string ?? "Team Member",
    role: (profile as Record<string, unknown>).role as string ?? "rep",
    dealsClosingSoon: (closingDeals.data ?? []).map((d: Record<string, unknown>) => ({
      name: d.name as string,
      amount: d.amount as number | null,
      expected_close: d.expected_close_on as string,
      stage: stageMap[d.stage_id as string] ?? null,
      company: companyMap[d.company_id as string] ?? null,
    })),
    overdueFollowUps: (overdueDeals.data ?? []).map((d: Record<string, unknown>) => ({
      name: d.name as string,
      amount: d.amount as number | null,
      follow_up_date: d.next_follow_up_at as string,
      company: companyMap[d.company_id as string] ?? null,
    })),
    recentActivities: (activities.data ?? []).map((a: Record<string, unknown>) => ({
      type: a.activity_type as string,
      body: typeof a.body === "string" ? a.body.slice(0, 200) : null,
      date: a.occurred_at as string,
    })),
    pipelineTotal,
    openDealCount: (allDeals.data ?? []).length,
    newVoiceNotes: (voiceNotes.data ?? []).length,
  };
}

async function generateBriefing(data: UserBriefingData): Promise<string> {
  const today = new Date();
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const prompt = `Generate a concise, actionable morning briefing for ${data.fullName} (${data.role}) for ${dayOfWeek}, ${dateStr}.

Here is their current data:

PIPELINE: ${data.openDealCount} open deals, $${data.pipelineTotal.toLocaleString()} total pipeline value

DEALS CLOSING THIS WEEK (${data.dealsClosingSoon.length}):
${data.dealsClosingSoon.length > 0
    ? data.dealsClosingSoon.map((d) =>
      `- ${d.name}${d.company ? ` (${d.company})` : ""}: $${(d.amount ?? 0).toLocaleString()} closing ${d.expected_close}${d.stage ? `, stage: ${d.stage}` : ""}`
    ).join("\n")
    : "None"}

OVERDUE FOLLOW-UPS (${data.overdueFollowUps.length}):
${data.overdueFollowUps.length > 0
    ? data.overdueFollowUps.map((d) =>
      `- ${d.name}${d.company ? ` (${d.company})` : ""}: $${(d.amount ?? 0).toLocaleString()}, follow-up was due ${d.follow_up_date}`
    ).join("\n")
    : "None"}

YESTERDAY'S ACTIVITIES (${data.recentActivities.length}):
${data.recentActivities.length > 0
    ? data.recentActivities.map((a) =>
      `- ${a.type}: ${a.body ?? "(no details)"}`
    ).join("\n")
    : "No activity recorded"}

NEW VOICE NOTES: ${data.newVoiceNotes}

Format the briefing as markdown with these sections:
1. **Good morning** greeting with the date
2. **Pipeline Snapshot** — key numbers
3. **Priority Actions** — most important things to do today (numbered list, max 5)
4. **Deals to Watch** — closing soon or needing attention
5. **Quick Wins** — easy actions that move deals forward

Keep it under 400 words. Be specific and actionable. If overdue follow-ups exist, flag them urgently.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: BRIEFING_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a sales operations assistant generating morning briefings for equipment sales reps and managers. Be direct, specific, and action-oriented. Use the data provided — do not fabricate numbers.",
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1024,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI error: ${payload?.error?.message ?? response.status}`);
  }

  return payload.choices?.[0]?.message?.content?.trim() ?? "Unable to generate briefing.";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);
  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  const adminClient = createAdminClient();
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecretHeader = req.headers.get("x-internal-service-secret") ?? "";
  // Two env var names exist in this project: INTERNAL_SERVICE_SECRET (used by
  // flow-runner / analytics-* crons) and DGE_INTERNAL_SERVICE_SECRET (used by
  // dge-auth.ts). Accept either so the cron works regardless of which is set.
  const internalServiceSecret =
    Deno.env.get("INTERNAL_SERVICE_SECRET") ??
    Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
    "";

  // Three privileged auth paths:
  //   1. Bearer <SUPABASE_SERVICE_ROLE_KEY>            — legacy service-role
  //   2. x-internal-service-secret: <INTERNAL_SECRET>  — modern pg_cron pattern
  //   3. Bearer <user JWT>                             — per-user, returns own brief
  const isServiceRole =
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`) ||
    (internalServiceSecret.length > 0 && internalSecretHeader === internalServiceSecret);

  // Parse body once so both batch and per-user paths can read flags like
  // { regenerate: true } or { user_ids: [...] }.
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const regenerate = body.regenerate === true;

  let targetUserIds: string[] = [];

  if (isServiceRole) {
    // Cron / batch mode: generate for all active users (or a supplied subset)
    if (Array.isArray(body.user_ids)) {
      targetUserIds = body.user_ids as string[];
    } else {
      const { data: users } = await adminClient
        .from("profiles")
        .select("id")
        .in("role", ["rep", "manager", "admin", "owner"]);
      targetUserIds = (users ?? []).map((u: Record<string, unknown>) => u.id as string);
    }
  } else {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.userId || !caller.role) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
    targetUserIds = [caller.userId];
  }

  const today = new Date().toISOString().split("T")[0];
  const results: Array<{ userId: string; status: string }> = [];

  for (const userId of targetUserIds) {
    try {
      // Check if already generated today (skip the guard when caller asked for a refresh)
      if (!regenerate) {
        const { data: existing } = await adminClient
          .from("morning_briefings")
          .select("id")
          .eq("user_id", userId)
          .eq("briefing_date", today)
          .maybeSingle();

        if (existing) {
          results.push({ userId, status: "already_exists" });
          continue;
        }
      } else {
        // Wipe today's row so the upsert below writes fresh content.
        await adminClient
          .from("morning_briefings")
          .delete()
          .eq("user_id", userId)
          .eq("briefing_date", today);
      }

      const data = await gatherUserData(adminClient, userId);
      if (!data) {
        results.push({ userId, status: "user_not_found" });
        continue;
      }

      const content = await generateBriefing(data);

      await adminClient.from("morning_briefings").insert({
        user_id: userId,
        briefing_date: today,
        content,
        data: {
          pipeline_total: data.pipelineTotal,
          open_deal_count: data.openDealCount,
          closing_this_week: data.dealsClosingSoon.length,
          overdue_follow_ups: data.overdueFollowUps.length,
          recent_activity_count: data.recentActivities.length,
          new_voice_notes: data.newVoiceNotes,
        },
      });

      results.push({ userId, status: "generated" });
    } catch (err) {
      console.error(`[morning-briefing] error for user ${userId}:`, err);
      results.push({ userId, status: `error: ${err instanceof Error ? err.message : "unknown"}` });
    }
  }

  const generated = results.filter((r) => r.status === "generated").length;
  console.info("[morning-briefing] completed", {
    generated,
    requested: targetUserIds.length,
  });

  // If single user, return the briefing content directly
  if (targetUserIds.length === 1 && !isServiceRole) {
    const { data: briefing } = await adminClient
      .from("morning_briefings")
      .select("id, content, data, briefing_date, created_at")
      .eq("user_id", targetUserIds[0])
      .eq("briefing_date", today)
      .maybeSingle();

    return new Response(JSON.stringify({ briefing }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ results, total: targetUserIds.length, generated }), {
    status: 200,
    headers: { ...ch, "Content-Type": "application/json" },
  });
});
