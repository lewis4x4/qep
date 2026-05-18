/**
 * Generate Daily Briefing — Sales Companion
 *
 * Generates structured JSON briefings for field reps, stored in daily_briefings.
 * Runs at 5am ET via scheduled cron or on-demand per user.
 *
 * Output: structured JSON with greeting, priority_actions, expiring_quotes,
 * opportunities, prep_cards, and stats.
 */
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { safeCorsHeaders as corsHeaders, optionsResponse } from "../_shared/safe-cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BRIEFING_MODEL = "claude-sonnet-4-6-20250514";

interface RepContext {
  userId: string;
  fullName: string;
  dealsClosingSoon: Array<{
    deal_id: string;
    name: string;
    amount: number | null;
    expected_close: string;
    stage: string | null;
    company_name: string | null;
    days_since_activity: number | null;
  }>;
  overdueFollowUps: Array<{
    deal_id: string;
    name: string;
    amount: number | null;
    follow_up_date: string;
    company_name: string | null;
  }>;
  expiringQuotes: Array<{
    quote_id: string;
    title: string | null;
    customer_name: string | null;
    status: string;
  }>;
  recentActivities: Array<{
    type: string;
    body: string | null;
    date: string;
    company_name: string | null;
  }>;
  stats: {
    deals_in_pipeline: number;
    total_pipeline_value: number;
    quotes_sent_this_week: number;
  };
  equipment: Array<{
    company_name: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    engine_hours: number | null;
  }>;
}

interface RepStuckApproval {
  quote_package_id: string;
  quote_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  submitted_at: string;
  hours_pending: number;
  assigned_role: string | null;
}

interface ManagerPendingApproval {
  approval_case_id: string;
  quote_package_id: string;
  quote_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  margin_pct: number | null;
  submitted_at: string;
  submitted_by_name: string | null;
  hours_pending: number;
}

interface PendingApprovals {
  rep_stuck: RepStuckApproval[];
  manager_pending: ManagerPendingApproval[];
  manager_pending_count: number;
}

interface BriefingContent {
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
  opportunities: Array<{
    type: string;
    summary: string;
  }>;
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
  pending_approvals?: PendingApprovals;
}

interface UserProfileLite {
  id: string;
  fullName: string;
  role: string | null;
  workspaceId: string | null;
}

async function fetchUserProfile(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<UserProfileLite | null> {
  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, role, active_workspace_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;
  const p = profile as Record<string, unknown>;
  return {
    id: userId,
    fullName: (p.full_name as string) ?? "Team Member",
    role: typeof p.role === "string" ? p.role : null,
    workspaceId:
      typeof p.active_workspace_id === "string" ? p.active_workspace_id : null,
  };
}

async function gatherRepContext(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  profile: UserProfileLite,
): Promise<RepContext | null> {
  if (profile.role !== "rep") return null;

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const weekAhead = sevenDaysOut.toISOString().split("T")[0];
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString();

  const [closingDeals, overdueDeals, activities, allDeals, quotes, equipment] =
    await Promise.all([
      // Deals closing within 7 days
      db.from("crm_deals")
        .select("id, name, amount, expected_close_on, stage_id, company_id, last_activity_at")
        .eq("assigned_rep_id", userId)
        .is("deleted_at", null)
        .is("closed_at", null)
        .gte("expected_close_on", today)
        .lte("expected_close_on", weekAhead)
        .order("expected_close_on", { ascending: true })
        .limit(10),

      // Overdue follow-ups
      db.from("crm_deals")
        .select("id, name, amount, next_follow_up_at, company_id")
        .eq("assigned_rep_id", userId)
        .is("deleted_at", null)
        .is("closed_at", null)
        .lt("next_follow_up_at", new Date().toISOString())
        .order("next_follow_up_at", { ascending: true })
        .limit(10),

      // Recent activities (last 7 days)
      db.from("crm_activities")
        .select("id, activity_type, body, occurred_at, company_id")
        .eq("created_by", userId)
        .is("deleted_at", null)
        .gte("occurred_at", weekAgoIso)
        .order("occurred_at", { ascending: false })
        .limit(15),

      // All open deals for stats
      db.from("crm_deals")
        .select("id, amount")
        .eq("assigned_rep_id", userId)
        .is("deleted_at", null)
        .is("closed_at", null),

      // Quotes created this week
      db.from("quotes")
        .select("id, title, crm_deal_id, status")
        .eq("created_by", userId)
        .is("deleted_at", null)
        .gte("created_at", weekAgoIso),

      // Equipment for trade-in opportunities — scoped to rep's companies
      (async () => {
        const { data: repCompanies } = await db
          .from("crm_deals")
          .select("company_id")
          .eq("assigned_rep_id", userId)
          .is("deleted_at", null);
        const repCompanyIds = [...new Set((repCompanies ?? []).map((d: Record<string, unknown>) => d.company_id as string).filter(Boolean))];
        if (repCompanyIds.length === 0) return { data: [], error: null };
        return db.from("crm_equipment")
          .select("id, company_id, make, model, year, engine_hours")
          .in("company_id", repCompanyIds)
          .is("deleted_at", null)
          .not("engine_hours", "is", null)
          .order("engine_hours", { ascending: false })
          .limit(20);
      })(),
    ]);

  // Resolve FKs
  const stageIds = [
    ...new Set(
      (closingDeals.data ?? [])
        .map((d: Record<string, unknown>) => d.stage_id)
        .filter(Boolean),
    ),
  ];
  const companyIds = [
    ...new Set(
      [
        ...(closingDeals.data ?? []).map((d: Record<string, unknown>) => d.company_id),
        ...(overdueDeals.data ?? []).map((d: Record<string, unknown>) => d.company_id),
        ...(activities.data ?? []).map((a: Record<string, unknown>) => a.company_id),
        ...(equipment.data ?? []).map((e: Record<string, unknown>) => e.company_id),
      ].filter(Boolean),
    ),
  ];

  let stageMap: Record<string, string> = {};
  let companyMap: Record<string, string> = {};

  if (stageIds.length > 0) {
    const { data: stages } = await db
      .from("crm_deal_stages")
      .select("id, name")
      .in("id", stageIds);
    if (stages)
      stageMap = Object.fromEntries(
        (stages as { id: string; name: string }[]).map((s) => [s.id, s.name]),
      );
  }
  if (companyIds.length > 0) {
    const { data: companies } = await db
      .from("crm_companies")
      .select("id, name")
      .in("id", companyIds);
    if (companies)
      companyMap = Object.fromEntries(
        (companies as { id: string; name: string }[]).map((c) => [c.id, c.name]),
      );
  }

  const pipelineTotal = (allDeals.data ?? []).reduce(
    (sum: number, d: Record<string, unknown>) => sum + (Number(d.amount) || 0),
    0,
  );

  return {
    userId,
    fullName: profile.fullName,
    dealsClosingSoon: (closingDeals.data ?? []).map(
      (d: Record<string, unknown>) => ({
        deal_id: d.id as string,
        name: d.name as string,
        amount: d.amount as number | null,
        expected_close: d.expected_close_on as string,
        stage: stageMap[d.stage_id as string] ?? null,
        company_name: companyMap[d.company_id as string] ?? null,
        days_since_activity: d.last_activity_at
          ? Math.floor(
              (Date.now() - new Date(d.last_activity_at as string).getTime()) /
                86400000,
            )
          : null,
      }),
    ),
    overdueFollowUps: (overdueDeals.data ?? []).map(
      (d: Record<string, unknown>) => ({
        deal_id: d.id as string,
        name: d.name as string,
        amount: d.amount as number | null,
        follow_up_date: d.next_follow_up_at as string,
        company_name: companyMap[d.company_id as string] ?? null,
      }),
    ),
    expiringQuotes: (quotes.data ?? [])
      .filter((q: Record<string, unknown>) => q.status === "linked")
      .map((q: Record<string, unknown>) => ({
        quote_id: q.id as string,
        title: q.title as string | null,
        customer_name: null,
        status: q.status as string,
      })),
    recentActivities: (activities.data ?? []).map(
      (a: Record<string, unknown>) => ({
        type: a.activity_type as string,
        body:
          typeof a.body === "string" ? a.body.slice(0, 200) : null,
        date: a.occurred_at as string,
        company_name: companyMap[a.company_id as string] ?? null,
      }),
    ),
    stats: {
      deals_in_pipeline: (allDeals.data ?? []).length,
      total_pipeline_value: pipelineTotal,
      quotes_sent_this_week: (quotes.data ?? []).length,
    },
    equipment: (equipment.data ?? []).map((e: Record<string, unknown>) => ({
      company_name: companyMap[e.company_id as string] ?? null,
      make: e.make as string | null,
      model: e.model as string | null,
      year: e.year as number | null,
      engine_hours: e.engine_hours as number | null,
    })),
  };
}

const REP_STUCK_THRESHOLD_HOURS = 4;
const REP_STUCK_LIMIT = 5;
const MANAGER_PENDING_LIMIT = 3;
const MANAGER_ROLES = new Set(["manager", "owner", "admin"]);

function hoursBetween(fromIso: string, now: number): number {
  const ts = new Date(fromIso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((now - ts) / 3_600_000));
}

/**
 * Fetch the pending_approvals slice for a user. Always returns a valid
 * PendingApprovals shape — empty arrays if queries error or no rows match.
 *
 * Briefings are the user's morning surface; partial data is strictly better
 * than a 5xx, so every catch path falls back to empty.
 */
async function gatherPendingApprovals(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string | null,
  workspaceId: string | null,
): Promise<PendingApprovals> {
  const now = Date.now();
  const isManager = role != null && MANAGER_ROLES.has(role);

  // Rep-stuck: cases the user submitted that are still pending/escalated
  // and have aged past the "fresh" threshold.
  let repStuck: RepStuckApproval[] = [];
  try {
    const { data, error } = await db
      .from("quote_approval_cases")
      .select(
        "id, quote_package_id, quote_number, customer_name, customer_company, net_total, created_at, assigned_role, status",
      )
      .eq("submitted_by", userId)
      .in("status", ["pending", "escalated"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("[generate-daily-briefing] rep_stuck query failed:", error);
    } else {
      repStuck = (data ?? [])
        .map((row: Record<string, unknown>) => {
          const submittedAt = typeof row.created_at === "string" ? row.created_at : null;
          if (!submittedAt) return null;
          const hours = hoursBetween(submittedAt, now);
          if (hours < REP_STUCK_THRESHOLD_HOURS) return null;
          const quotePackageId = typeof row.quote_package_id === "string" ? row.quote_package_id : null;
          if (!quotePackageId) return null;
          return {
            quote_package_id: quotePackageId,
            quote_number: typeof row.quote_number === "string" ? row.quote_number : null,
            customer_name:
              (typeof row.customer_name === "string" && row.customer_name) ||
              (typeof row.customer_company === "string" && row.customer_company) ||
              null,
            total_amount:
              typeof row.net_total === "number" && Number.isFinite(row.net_total)
                ? row.net_total
                : row.net_total != null
                  ? Number(row.net_total) || null
                  : null,
            submitted_at: submittedAt,
            hours_pending: hours,
            assigned_role:
              typeof row.assigned_role === "string" ? row.assigned_role : null,
          } as RepStuckApproval;
        })
        .filter((row): row is RepStuckApproval => row !== null)
        .slice(0, REP_STUCK_LIMIT);
    }
  } catch (err) {
    console.error("[generate-daily-briefing] rep_stuck threw:", err);
    repStuck = [];
  }

  // Manager-pending: only for manager/owner/admin roles.
  let managerPending: ManagerPendingApproval[] = [];
  let managerPendingCount = 0;
  if (isManager) {
    try {
      // Build the filter: assigned_to = me OR (assigned_role = my role AND workspace = my workspace)
      // Supabase JS supports compound OR via the .or() string DSL.
      const orFilter = workspaceId
        ? `assigned_to.eq.${userId},and(assigned_role.eq.${role},workspace_id.eq.${workspaceId})`
        : `assigned_to.eq.${userId},assigned_role.eq.${role}`;

      const { data, error, count } = await db
        .from("quote_approval_cases")
        .select(
          "id, quote_package_id, quote_number, customer_name, customer_company, net_total, margin_pct, created_at, submitted_by_name, status",
          { count: "exact" },
        )
        .or(orFilter)
        .in("status", ["pending", "escalated"])
        .order("created_at", { ascending: true });

      if (error) {
        console.error(
          "[generate-daily-briefing] manager_pending query failed:",
          error,
        );
      } else {
        managerPendingCount = typeof count === "number" ? count : (data ?? []).length;
        managerPending = (data ?? [])
          .slice(0, MANAGER_PENDING_LIMIT)
          .map((row: Record<string, unknown>) => {
            const submittedAt = typeof row.created_at === "string" ? row.created_at : null;
            const quotePackageId = typeof row.quote_package_id === "string" ? row.quote_package_id : null;
            const caseId = typeof row.id === "string" ? row.id : null;
            if (!submittedAt || !quotePackageId || !caseId) return null;
            const marginRaw = row.margin_pct;
            const totalRaw = row.net_total;
            return {
              approval_case_id: caseId,
              quote_package_id: quotePackageId,
              quote_number:
                typeof row.quote_number === "string" ? row.quote_number : null,
              customer_name:
                (typeof row.customer_name === "string" && row.customer_name) ||
                (typeof row.customer_company === "string" && row.customer_company) ||
                null,
              total_amount:
                typeof totalRaw === "number" && Number.isFinite(totalRaw)
                  ? totalRaw
                  : totalRaw != null
                    ? Number(totalRaw) || null
                    : null,
              margin_pct:
                typeof marginRaw === "number" && Number.isFinite(marginRaw)
                  ? marginRaw
                  : marginRaw != null
                    ? Number(marginRaw) || null
                    : null,
              submitted_at: submittedAt,
              submitted_by_name:
                typeof row.submitted_by_name === "string"
                  ? row.submitted_by_name
                  : null,
              hours_pending: hoursBetween(submittedAt, now),
            } as ManagerPendingApproval;
          })
          .filter((row): row is ManagerPendingApproval => row !== null);
      }
    } catch (err) {
      console.error("[generate-daily-briefing] manager_pending threw:", err);
      managerPending = [];
      managerPendingCount = 0;
    }
  }

  return {
    rep_stuck: repStuck,
    manager_pending: managerPending,
    manager_pending_count: managerPendingCount,
  };
}

/**
 * Briefing for non-rep operators (managers/owners/admins) — the rep pipeline
 * sections don't apply, so this is just a greeting + the approvals slice. The
 * Today page hides empty sections, so an entirely empty manager briefing
 * still renders a clean shell.
 */
function buildManagerBriefing(profile: UserProfileLite): BriefingContent {
  const firstName = (profile.fullName || "Team Member").split(" ")[0];
  return {
    greeting: `Good morning, ${firstName}. Here's your queue at a glance.`,
    priority_actions: [],
    expiring_quotes: [],
    opportunities: [],
    prep_cards: [],
    stats: {
      deals_in_pipeline: 0,
      quotes_sent_this_week: 0,
      total_pipeline_value: 0,
    },
  };
}

function buildDegradedBriefing(ctx: RepContext): BriefingContent {
  const now = new Date();
  const greeting = `Good morning, ${ctx.fullName.split(" ")[0]}. Here's your day at a glance.`;

  return {
    greeting,
    priority_actions: [
      ...ctx.overdueFollowUps.slice(0, 3).map((d) => ({
        type: "follow_up_overdue",
        customer_name: d.company_name,
        deal_id: d.deal_id,
        summary: `Follow up on ${d.name} — was due ${new Date(d.follow_up_date).toLocaleDateString()}`,
      })),
      ...ctx.dealsClosingSoon.slice(0, 2).map((d) => ({
        type: "closing_soon",
        customer_name: d.company_name,
        deal_id: d.deal_id,
        summary: `${d.name} closing ${new Date(d.expected_close).toLocaleDateString()} — $${(d.amount ?? 0).toLocaleString()}`,
      })),
    ],
    expiring_quotes: ctx.expiringQuotes.map((q) => ({
      quote_id: q.quote_id,
      customer_name: q.customer_name,
      equipment: q.title,
      status: q.status,
    })),
    opportunities: ctx.equipment
      .filter((e) => (e.engine_hours ?? 0) > 5000)
      .slice(0, 3)
      .map((e) => ({
        type: "trade_in_approaching",
        summary: `${e.company_name ?? "Customer"} — ${e.make ?? ""} ${e.model ?? ""} (${e.year ?? "?"}) at ${(e.engine_hours ?? 0).toLocaleString()} hours`,
      })),
    prep_cards: [],
    stats: ctx.stats,
  };
}

async function generateAiBriefing(ctx: RepContext): Promise<BriefingContent> {
  if (!ANTHROPIC_API_KEY) {
    return buildDegradedBriefing(ctx);
  }

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const prompt = `Generate a structured daily briefing for ${ctx.fullName}, a field sales rep selling heavy equipment, for ${dayOfWeek}, ${dateStr}.

DATA:
Pipeline: ${ctx.stats.deals_in_pipeline} open deals, $${ctx.stats.total_pipeline_value.toLocaleString()} total
Quotes sent this week: ${ctx.stats.quotes_sent_this_week}

DEALS CLOSING THIS WEEK:
${ctx.dealsClosingSoon.map((d) => `- ${d.name} (${d.company_name ?? "?"}): $${(d.amount ?? 0).toLocaleString()}, closing ${d.expected_close}, stage: ${d.stage ?? "?"}, ${d.days_since_activity ?? "?"} days since activity`).join("\n") || "None"}

OVERDUE FOLLOW-UPS:
${ctx.overdueFollowUps.map((d) => `- ${d.name} (${d.company_name ?? "?"}): $${(d.amount ?? 0).toLocaleString()}, due ${d.follow_up_date}`).join("\n") || "None"}

RECENT ACTIVITY (last 7 days):
${ctx.recentActivities.slice(0, 10).map((a) => `- ${a.type}${a.company_name ? ` (${a.company_name})` : ""}: ${a.body ?? "(no details)"}`).join("\n") || "None"}

HIGH-HOUR EQUIPMENT (trade-in opportunities):
${ctx.equipment.filter((e) => (e.engine_hours ?? 0) > 5000).slice(0, 5).map((e) => `- ${e.company_name ?? "?"}: ${e.make ?? ""} ${e.model ?? ""} (${e.year ?? "?"}), ${(e.engine_hours ?? 0).toLocaleString()} hrs`).join("\n") || "None"}

Return a JSON object (no markdown fencing) with this exact structure:
{
  "greeting": "Good morning, [first name]. [one-sentence summary of the day]",
  "priority_actions": [{"type": "follow_up_overdue|closing_soon|quote_expiring", "customer_name": "...", "deal_id": null, "summary": "..."}],
  "expiring_quotes": [],
  "opportunities": [{"type": "trade_in_approaching|manufacturer_incentive", "summary": "..."}],
  "prep_cards": [],
  "stats": {"deals_in_pipeline": ${ctx.stats.deals_in_pipeline}, "quotes_sent_this_week": ${ctx.stats.quotes_sent_this_week}, "total_pipeline_value": ${ctx.stats.total_pipeline_value}}
}

Rules:
- Max 5 priority_actions, ordered by urgency
- Be specific and actionable — name the customer and the deal
- Greeting should be warm but concise
- Do NOT fabricate data — only use what's provided`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: BRIEFING_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(
        `[generate-daily-briefing] Anthropic API error: ${response.status}`,
      );
      return buildDegradedBriefing(ctx);
    }

    const payload = await response.json();
    const text =
      payload.content?.[0]?.type === "text"
        ? payload.content[0].text
        : null;

    if (!text) return buildDegradedBriefing(ctx);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error("[generate-daily-briefing] AI returned invalid JSON");
      return buildDegradedBriefing(ctx);
    }

    // Validate shape — degrade if AI returned unexpected structure
    if (
      typeof parsed.greeting !== "string" ||
      !Array.isArray(parsed.priority_actions)
    ) {
      console.error("[generate-daily-briefing] AI returned unexpected shape");
      return buildDegradedBriefing(ctx);
    }

    const briefing = parsed as unknown as BriefingContent;
    // Ensure stats reflect real data, not AI hallucination
    briefing.stats = ctx.stats;
    return briefing;
  } catch (err) {
    console.error("[generate-daily-briefing] AI generation failed:", err);
    return buildDegradedBriefing(ctx);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const adminClient = createAdminClient();

  // Auth: service role (cron) or per-user JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret =
    Deno.env.get("INTERNAL_SERVICE_SECRET") ??
    Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
    "";
  const internalSecretHeader =
    req.headers.get("x-internal-service-secret") ?? "";

  // Timing-safe comparison for secret values
  function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);
    // Use constant-time comparison
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i] ^ bufB[i];
    }
    return result === 0;
  }

  const isServiceRole =
    (serviceRoleKey.length > 0 &&
      timingSafeEqual(authHeader, `Bearer ${serviceRoleKey}`)) ||
    (internalSecret.length > 0 &&
      internalSecretHeader.length > 0 &&
      timingSafeEqual(internalSecretHeader, internalSecret));

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  let targetUserIds: string[] = [];

  if (isServiceRole) {
    if (Array.isArray(body.user_ids)) {
      targetUserIds = body.user_ids as string[];
    } else {
      const { data: reps } = await adminClient
        .from("profiles")
        .select("id")
        .in("role", ["rep", "manager", "owner", "admin"]);
      targetUserIds = (reps ?? []).map(
        (u: Record<string, unknown>) => u.id as string,
      );
    }
  } else {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.userId) {
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
      // Skip if already generated today (unless regenerate requested)
      if (!body.regenerate) {
        const { data: existing } = await adminClient
          .from("daily_briefings")
          .select("id")
          .eq("user_id", userId)
          .eq("briefing_date", today)
          .maybeSingle();

        if (existing) {
          results.push({ userId, status: "already_exists" });
          continue;
        }
      } else {
        await adminClient
          .from("daily_briefings")
          .delete()
          .eq("user_id", userId)
          .eq("briefing_date", today);
      }

      const profile = await fetchUserProfile(adminClient, userId);
      if (!profile) {
        results.push({ userId, status: "no_profile" });
        continue;
      }

      let briefingContent: BriefingContent;
      const ctx = await gatherRepContext(adminClient, userId, profile);
      if (ctx) {
        briefingContent = await generateAiBriefing(ctx);
      } else if (
        profile.role && MANAGER_ROLES.has(profile.role)
      ) {
        briefingContent = buildManagerBriefing(profile);
      } else {
        results.push({ userId, status: "not_a_rep" });
        continue;
      }

      // Always attach pending_approvals — both rep_stuck (any submitter) and
      // manager_pending (only for manager/owner/admin). Errors inside this
      // helper are swallowed and return empty arrays so the briefing still
      // ships even if the approval-cases query backend is having a bad day.
      briefingContent.pending_approvals = await gatherPendingApprovals(
        adminClient,
        userId,
        profile.role,
        profile.workspaceId,
      );

      await adminClient.from("daily_briefings").insert({
        user_id: userId,
        briefing_date: today,
        briefing_content: briefingContent,
      });

      results.push({ userId, status: "generated" });
    } catch (err) {
      console.error(
        `[generate-daily-briefing] error for user ${userId}:`,
        err,
      );
      results.push({
        userId,
        status: `error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  // Single user: return the briefing directly
  if (targetUserIds.length === 1 && !isServiceRole) {
    const { data: briefing } = await adminClient
      .from("daily_briefings")
      .select("id, briefing_content, briefing_date, created_at")
      .eq("user_id", targetUserIds[0])
      .eq("briefing_date", today)
      .maybeSingle();

    return new Response(JSON.stringify({ briefing }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      results,
      total: targetUserIds.length,
      generated: results.filter((r) => r.status === "generated").length,
    }),
    { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
  );
});
