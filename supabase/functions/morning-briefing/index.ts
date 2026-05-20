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
import {
  buildFallbackMorningBriefing,
  type MorningBriefingData,
} from "../_shared/morning-briefing-fallback.ts";
import {
  getDateInTimeZone,
  shouldRunEtScheduledBatch,
} from "../_shared/briefing-time.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  gatherPendingApprovals,
  type PendingApprovals,
} from "../_shared/sales-briefing-approvals.ts";
import { safeCorsHeaders as corsHeaders, optionsResponse } from "../_shared/safe-cors.ts";

const BRIEFING_MODEL = "gpt-5.4-mini";

async function gatherUserData(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<MorningBriefingData | null> {
  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, role, active_workspace_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;

  const today = getDateInTimeZone();
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const weekAhead = sevenDaysOut.toISOString().split("T")[0];

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = yesterday.toISOString();

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString();

  const [closingDeals, overdueDeals, activities, allDeals, voiceNotes, quotes] = await Promise.all([
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

    db.from("quotes")
      .select("id, title, status")
      .eq("created_by", userId)
      .is("deleted_at", null)
      .gte("created_at", weekAgoIso),
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
    workspaceId:
      typeof (profile as Record<string, unknown>).active_workspace_id === "string"
        ? (profile as Record<string, unknown>).active_workspace_id as string
        : null,
    dealsClosingSoon: (closingDeals.data ?? []).map((d: Record<string, unknown>) => ({
      deal_id: d.id as string,
      name: d.name as string,
      amount: d.amount as number | null,
      expected_close: d.expected_close_on as string,
      stage: stageMap[d.stage_id as string] ?? null,
      company: companyMap[d.company_id as string] ?? null,
    })),
    overdueFollowUps: (overdueDeals.data ?? []).map((d: Record<string, unknown>) => ({
      deal_id: d.id as string,
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
    quotesSentThisWeek: (quotes.data ?? []).length,
    // Keep expiring_quotes empty until a reliable expiration/valid-through
    // field is available on the quote source; quotes_sent_this_week above
    // still preserves the Sales Today stats signal without mislabeling urgency.
    expiringQuotes: [],
    newVoiceNotes: (voiceNotes.data ?? []).length,
  };
}

function statusToUserMessage(status: string): string {
  if (status === "already_exists") return "A briefing already exists for today.";
  if (status === "user_not_found") return "No profile was found for the signed-in user.";
  if (status.startsWith("error:")) return status.slice("error:".length).trim();
  return "Morning briefing did not generate.";
}

type SalesTodayBriefingContent = {
  greeting: string;
  priority_actions: Array<{
    type: string;
    customer_name: string | null;
    deal_id: string | null;
    summary: string;
  }>;
  expiring_quotes: Array<{
    quote_id: string;
    customer_name: string | null;
    equipment: string | null;
    status: string;
  }>;
  opportunities: Array<{ type: string; summary: string }>;
  prep_cards: Array<{
    customer_id: string | null;
    customer_name: string | null;
    meeting_time: string | null;
    fleet_summary: string | null;
    last_interaction: string | null;
    talking_points: string[];
  }>;
  stats: {
    deals_in_pipeline: number;
    quotes_sent_this_week: number;
    total_pipeline_value: number;
  };
  pending_approvals: PendingApprovals;
};

function buildSalesTodayBriefingContent(
  data: MorningBriefingData,
  pendingApprovals: PendingApprovals,
  now: Date = new Date(),
): SalesTodayBriefingContent {
  const firstName = data.fullName.split(" ")[0] || data.fullName || "there";
  const greetingDate = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const priorityActions = [
    ...data.overdueFollowUps.map((deal) => ({
      type: "follow_up_overdue",
      customer_name: deal.company,
      deal_id: deal.deal_id ?? null,
      summary: `${deal.name} needs an overdue follow-up from ${deal.follow_up_date}.`,
    })),
    ...data.dealsClosingSoon.map((deal) => ({
      type: "closing_soon",
      customer_name: deal.company,
      deal_id: deal.deal_id ?? null,
      summary: `${deal.name} is closing ${deal.expected_close}${deal.stage ? ` in ${deal.stage}` : ""}.`,
    })),
    ...(data.newVoiceNotes > 0
      ? [{
        type: "review_voice_notes",
        customer_name: null,
        deal_id: null,
        summary: `Review ${data.newVoiceNotes} new voice note${data.newVoiceNotes === 1 ? "" : "s"} and convert next steps into CRM activity.`,
      }]
      : []),
  ].slice(0, 5);

  return {
    greeting: `Good morning, ${firstName} — ${greetingDate}.`,
    priority_actions: priorityActions,
    expiring_quotes: (data.expiringQuotes ?? []).slice(0, 5).map((quote) => ({
      quote_id: quote.quote_id,
      customer_name: quote.customer_name,
      equipment: quote.title,
      status: quote.status,
    })),
    opportunities: [],
    prep_cards: [],
    stats: {
      deals_in_pipeline: data.openDealCount,
      quotes_sent_this_week: data.quotesSentThisWeek ?? 0,
      total_pipeline_value: data.pipelineTotal,
    },
    pending_approvals: pendingApprovals,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return record.code === "23505" || message.includes("duplicate key");
}

async function reserveMorningBriefing(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  briefingDate: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("morning_briefings")
    .insert({
      user_id: userId,
      briefing_date: briefingDate,
      content: "Morning briefing generation is in progress.",
      audience: "internal",
      data: {
        generation_status: "in_progress",
        reserved_at: new Date().toISOString(),
      },
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }

  const id = (data as Record<string, unknown> | null)?.id;
  return typeof id === "string" ? id : null;
}

async function generateBriefing(data: MorningBriefingData): Promise<string> {
  const today = new Date();
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const prompt = `Generate a concise, actionable morning briefing for ${data.fullName} (${data.role}) for ${dayOfWeek}, ${dateStr}.

Here is their current data:

PIPELINE: ${data.openDealCount} open deals, $${data.pipelineTotal.toLocaleString()} total pipeline value

DEALS CLOSING THIS WEEK (${data.dealsClosingSoon.length}):
${data.dealsClosingSoon.length > 0
    ? data.dealsClosingSoon.map((d: MorningBriefingData["dealsClosingSoon"][number]) =>
      `- ${d.name}${d.company ? ` (${d.company})` : ""}: $${(d.amount ?? 0).toLocaleString()} closing ${d.expected_close}${d.stage ? `, stage: ${d.stage}` : ""}`
    ).join("\n")
    : "None"}

OVERDUE FOLLOW-UPS (${data.overdueFollowUps.length}):
${data.overdueFollowUps.length > 0
    ? data.overdueFollowUps.map((d: MorningBriefingData["overdueFollowUps"][number]) =>
      `- ${d.name}${d.company ? ` (${d.company})` : ""}: $${(d.amount ?? 0).toLocaleString()}, follow-up was due ${d.follow_up_date}`
    ).join("\n")
    : "None"}

YESTERDAY'S ACTIVITIES (${data.recentActivities.length}):
${data.recentActivities.length > 0
    ? data.recentActivities.map((a: MorningBriefingData["recentActivities"][number]) =>
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
  const isServiceRole = isServiceRoleCaller(req);

  // Parse body once so both batch and per-user paths can read flags like
  // { regenerate: true } or { user_ids: [...] }.
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const regenerate = body.regenerate === true;

  if (isServiceRole && !shouldRunEtScheduledBatch(body)) {
    return new Response(JSON.stringify({
      skipped: true,
      reason: "outside_enforced_america_new_york_hour",
      enforce_et_hour: body.enforce_et_hour,
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  let targetUserIds: string[] = [];

  if (isServiceRole) {
    // Cron / batch mode: generate for all active users (or a supplied subset)
    if (Array.isArray(body.user_ids)) {
      targetUserIds = body.user_ids as string[];
    } else {
      const { data: users } = await adminClient
        .from("profiles")
        .select("id, audience")
        .in("role", ["rep", "manager", "admin", "owner"]);
      targetUserIds = (users ?? [])
        .filter((u: Record<string, unknown>) => u.audience !== "stakeholder")
        .map((u: Record<string, unknown>) => u.id as string);
    }
  } else {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.userId || !caller.role) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("audience")
      .eq("id", caller.userId)
      .maybeSingle();
    if ((callerProfile as Record<string, unknown> | null)?.audience === "stakeholder") {
      return new Response(JSON.stringify({ error: "Use stakeholder-morning-brief for stakeholder users." }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    targetUserIds = [caller.userId];
  }

  const today = getDateInTimeZone();
  const results: Array<{ userId: string; status: string }> = [];

  for (const userId of targetUserIds) {
    let reservationId: string | null = null;
    try {
      // Reserve the unique (user_id, briefing_date) row before expensive data
      // gathering/OpenAI work. A concurrent first-open loses the reservation
      // race and returns the row being generated instead of calling OpenAI too.
      if (!regenerate) {
        reservationId = await reserveMorningBriefing(adminClient, userId, today);
        if (!reservationId) {
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
        if (reservationId) {
          await adminClient.from("morning_briefings").delete().eq("id", reservationId);
        }
        results.push({ userId, status: "user_not_found" });
        continue;
      }

      const pendingApprovals = await gatherPendingApprovals(
        adminClient,
        userId,
        data.role,
        data.workspaceId ?? null,
        "[morning-briefing]",
      );
      const salesToday = buildSalesTodayBriefingContent(data, pendingApprovals);

      let content: string;
      let usedFallback = false;
      try {
        content = await generateBriefing(data);
      } catch (err) {
        usedFallback = true;
        console.error(`[morning-briefing] AI generation failed for user ${userId}, using fallback:`, err);
        content = buildFallbackMorningBriefing(data);
      }

      const briefingPayload = {
        user_id: userId,
        briefing_date: today,
        content,
        audience: "internal",
        data: {
          pipeline_total: data.pipelineTotal,
          open_deal_count: data.openDealCount,
          closing_this_week: data.dealsClosingSoon.length,
          overdue_follow_ups: data.overdueFollowUps.length,
          recent_activity_count: data.recentActivities.length,
          new_voice_notes: data.newVoiceNotes,
          quotes_sent_this_week: data.quotesSentThisWeek ?? 0,
          generation_mode: usedFallback ? "fallback" : "ai",
          sales_today: salesToday,
        },
      };

      const writeResult = reservationId
        ? await adminClient.from("morning_briefings").update(briefingPayload).eq("id", reservationId)
        : await adminClient.from("morning_briefings").upsert(briefingPayload, {
          onConflict: "user_id,briefing_date",
        });

      if (writeResult.error) {
        throw writeResult.error;
      }

      results.push({ userId, status: usedFallback ? "generated_fallback" : "generated" });
    } catch (err) {
      if (reservationId) {
        await adminClient.from("morning_briefings").delete().eq("id", reservationId);
      }
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
    const result = results[0] ?? null;
    const { data: briefing } = await adminClient
      .from("morning_briefings")
      .select("id, content, data, briefing_date, created_at")
      .eq("user_id", targetUserIds[0])
      .eq("briefing_date", today)
      .maybeSingle();

    if (result?.status === "user_not_found") {
      return new Response(JSON.stringify({
        error: statusToUserMessage(result.status),
        result,
      }), {
        status: 404,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (result?.status.startsWith("error:")) {
      return new Response(JSON.stringify({
        error: statusToUserMessage(result.status),
        result,
      }), {
        status: 500,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    if (!briefing) {
      return new Response(JSON.stringify({
        error: "Morning briefing did not generate. Please try again.",
        result,
      }), {
        status: 500,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ briefing, result }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ results, total: targetUserIds.length, generated }), {
    status: 200,
    headers: { ...ch, "Content-Type": "application/json" },
  });
});
