/**
 * stakeholder-morning-brief — the daily-at-06:00 briefing for every QEP USA
 * stakeholder (Ryan / Rylee / Juan / Angela). Writes to morning_briefings with
 * audience='stakeholder' and optionally fires a Resend email digest.
 *
 * Cron: 0 11 * * *  (11:00 UTC ≈ 06:00 America/New_York during EDT).
 * Auth: x-internal-service-secret (cron) — verify_jwt=false at the gateway.
 *   Also accepts a user JWT for manual "run mine now" from the /brief UI.
 *
 * For each stakeholder profile (audience='stakeholder'), we:
 *   1. Pull last-24h hub_changelog rows (scoped to the stakeholder's workspace).
 *   2. Pull open hub_feedback the stakeholder submitted (status ∈ open/triaged/drafting/awaiting_merge).
 *   3. Pull recent hub_decisions (last 7d).
 *   4. Generate a briefing via Claude Sonnet 4.6 with a SUBROLE-specific
 *      system prompt (executive for owner, UX for primary_contact, technical
 *      for technical, admin for admin). Rylee's plain-voice rule applies to all.
 *   5. Upsert into morning_briefings (unique on user_id + briefing_date).
 *   6. If RESEND_API_KEY + stakeholder email → send the email digest.
 *
 * No-data guard: if a stakeholder has literally nothing to brief on (empty
 * changelog + no open feedback + no fresh decisions), skip generation to
 * avoid "nothing happened today" noise. The UI shows a placeholder instead.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireHubUser } from "../_shared/hub-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

const BRIEF_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 640;
const TEMPERATURE = 0.35;
const ANTHROPIC_TIMEOUT_MS = 30_000;

type Subrole = "owner" | "primary_contact" | "technical" | "admin";

const BASE_TONE = `Rylee's rule: plain voice only. No "thrilled to", no "excited to", no "proud to announce". Numbers before adjectives. Address the reader directly ("you"). 3–5 sentences, MAX 120 words, no bullet lists, no headers.`;

const SUBROLE_FRAMING: Record<Subrole, string> = {
  owner:
    "Frame: executive. Lead with business impact (revenue, risk, timeline). Skip implementation detail. Call out anything that changes the roadmap.",
  primary_contact:
    "Frame: UX / workflow. Lead with what end-users will feel different. Call out friction you flagged that just shipped. Tee up 1 thing to try today.",
  technical:
    "Frame: integration / data. Lead with what hooked up to what (schemas, APIs, webhooks). Call out anything that needs a config change on their end.",
  admin:
    "Frame: operations. Lead with what admins can now do (roles, imports, bulk ops). Call out anything that touches users or permissions.",
};

interface StakeholderProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  active_workspace_id: string | null;
  stakeholder_subrole: string | null;
}

interface BriefContext {
  changelog: Array<{
    summary: string;
    change_type: string;
    created_at: string;
  }>;
  my_open_feedback: Array<{
    id: string;
    body: string;
    status: string;
    priority: string | null;
    ai_suggested_action: string | null;
    created_at: string;
  }>;
  recent_decisions: Array<{
    title: string;
    decision: string;
    created_at: string;
  }>;
}

interface RunResult {
  user_id: string;
  status:
    | "generated"
    | "already_exists"
    | "skipped_empty"
    | "error"
    | "profile_missing";
  error?: string;
  email_sent?: boolean;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("SUPABASE_URL/SERVICE_ROLE_KEY missing", 500, origin);
  }
  if (!anthropicKey) {
    return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const regenerate = body.regenerate === true;
  const userIdsParam = Array.isArray(body.user_ids)
    ? (body.user_ids.filter((x) => typeof x === "string") as string[])
    : null;

  try {
    const isService = isServiceRoleCaller(req);
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    let targetIds: string[] = [];

    if (isService) {
      if (userIdsParam && userIdsParam.length > 0) {
        targetIds = userIdsParam;
      } else {
        const { data: rows, error } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("audience", "stakeholder");
        if (error) throw new Error(`profiles query failed: ${error.message}`);
        targetIds = (rows ?? []).map((r) => r.id as string);
      }
    } else {
      const auth = await requireHubUser(req.headers.get("Authorization"), origin);
      if (!auth.ok) return auth.response;
      // Self-serve: generate only for caller, ignore user_ids.
      targetIds = [auth.userId];
    }

    const today = new Date().toISOString().split("T")[0];
    const sinceTs = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const decisionsSince = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();

    const results: RunResult[] = [];

    for (const userId of targetIds) {
      try {
        const profile = await loadProfile(supabaseAdmin, userId);
        if (!profile) {
          results.push({ user_id: userId, status: "profile_missing" });
          continue;
        }

        // Skip if today's row exists and no regenerate.
        if (!regenerate) {
          const { data: existing } = await supabaseAdmin
            .from("morning_briefings")
            .select("id")
            .eq("user_id", userId)
            .eq("briefing_date", today)
            .maybeSingle();
          if (existing) {
            results.push({ user_id: userId, status: "already_exists" });
            continue;
          }
        }

        const workspace = profile.active_workspace_id ?? "default";
        const ctx = await gatherContext(
          supabaseAdmin,
          userId,
          workspace,
          sinceTs,
          decisionsSince,
        );

        const hasAnything =
          ctx.changelog.length > 0 ||
          ctx.my_open_feedback.length > 0 ||
          ctx.recent_decisions.length > 0;
        if (!hasAnything) {
          results.push({ user_id: userId, status: "skipped_empty" });
          continue;
        }

        const subrole = normalizeSubrole(profile.stakeholder_subrole);
        const briefText = await generateBrief({
          apiKey: anthropicKey,
          profile,
          ctx,
          subrole,
        });

        // Wipe today's row on regenerate to keep the unique constraint happy.
        if (regenerate) {
          await supabaseAdmin
            .from("morning_briefings")
            .delete()
            .eq("user_id", userId)
            .eq("briefing_date", today);
        }

        const { error: insErr } = await supabaseAdmin
          .from("morning_briefings")
          .insert({
            user_id: userId,
            workspace_id: workspace,
            briefing_date: today,
            content: briefText,
            audience: "stakeholder",
            data: {
              subrole,
              changelog_count: ctx.changelog.length,
              open_feedback_count: ctx.my_open_feedback.length,
              recent_decision_count: ctx.recent_decisions.length,
              model: BRIEF_MODEL,
            },
          });

        if (insErr) {
          results.push({ user_id: userId, status: "error", error: insErr.message });
          continue;
        }

        // Best-effort email digest — never fails the run.
        let emailSent = false;
        if (profile.email) {
          try {
            const { ok } = await sendResendEmail({
              to: profile.email,
              subject: `QEP Build Hub — ${today}`,
              text: `${briefText}\n\nRead it in the hub: https://qep.blackrockai.co/brief`,
            });
            emailSent = ok;
          } catch (e) {
            console.warn(
              `[stakeholder-brief] email failed for ${userId}:`,
              e instanceof Error ? e.message : e,
            );
          }
        }

        results.push({ user_id: userId, status: "generated", email_sent: emailSent });
      } catch (err) {
        console.error(
          `[stakeholder-brief] user ${userId} failed:`,
          err instanceof Error ? err.message : err,
        );
        results.push({
          user_id: userId,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Self-serve path returns the generated text directly.
    if (!isService && targetIds.length === 1) {
      const { data: brief } = await supabaseAdmin
        .from("morning_briefings")
        .select("id, content, data, briefing_date, created_at")
        .eq("user_id", targetIds[0])
        .eq("briefing_date", today)
        .maybeSingle();
      return safeJsonOk(
        { brief, result: results[0] ?? null },
        origin,
      );
    }

    const generated = results.filter((r) => r.status === "generated").length;
    return safeJsonOk(
      {
        total: targetIds.length,
        generated,
        results,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: "stakeholder-morning-brief" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<StakeholderProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, active_workspace_id, stakeholder_subrole")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as StakeholderProfile;
}

async function gatherContext(
  supabase: SupabaseClient,
  userId: string,
  workspace: string,
  sinceTs: string,
  decisionsSince: string,
): Promise<BriefContext> {
  const [changelogRes, feedbackRes, decisionsRes] = await Promise.all([
    supabase
      .from("hub_changelog")
      .select("summary, change_type, created_at")
      .eq("workspace_id", workspace)
      .is("deleted_at", null)
      .gte("created_at", sinceTs)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("hub_feedback")
      .select("id, body, status, priority, ai_suggested_action, created_at")
      .eq("workspace_id", workspace)
      .eq("submitted_by", userId)
      .is("deleted_at", null)
      .in("status", ["open", "triaged", "drafting", "awaiting_merge"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("hub_decisions")
      .select("title, decision, created_at")
      .eq("workspace_id", workspace)
      .is("deleted_at", null)
      .gte("created_at", decisionsSince)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    changelog: ((changelogRes.data ?? []) as BriefContext["changelog"]),
    my_open_feedback: ((feedbackRes.data ?? []) as BriefContext["my_open_feedback"]),
    recent_decisions: ((decisionsRes.data ?? []) as BriefContext["recent_decisions"]),
  };
}

function normalizeSubrole(raw: string | null): Subrole {
  if (raw === "owner" || raw === "primary_contact" || raw === "technical" || raw === "admin") {
    return raw;
  }
  return "primary_contact";
}

async function generateBrief(params: {
  apiKey: string;
  profile: StakeholderProfile;
  ctx: BriefContext;
  subrole: Subrole;
}): Promise<string> {
  const { apiKey, profile, ctx, subrole } = params;

  const systemPrompt = `You are writing the morning brief for ${profile.full_name ?? "a QEP stakeholder"} on the QEP OS build hub.

${SUBROLE_FRAMING[subrole]}

${BASE_TONE}

Structure (prose, not bullets):
1. What changed overnight — lead with the most important shipped change.
2. What's pending for you — open feedback you submitted that's mid-flight.
3. One decision worth knowing — only if there's a fresh decision that touches your frame.`;

  const context = {
    today: new Date().toISOString().split("T")[0],
    subrole,
    changelog_last_24h: ctx.changelog,
    my_open_feedback: ctx.my_open_feedback,
    recent_decisions_last_7d: ctx.recent_decisions,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BRIEF_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Data for today's brief (JSON):\n\n${JSON.stringify(context, null, 2)}\n\nWrite the brief.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const textPart = ((data?.content ?? []) as Array<{ type: string; text?: string }>).find(
    (c) => c.type === "text",
  );
  return (textPart?.text ?? "").trim();
}
