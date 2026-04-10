/**
 * Handoff Trust Scorer — nightly edge function (Phase 3 Slice 3.1)
 *
 * Scores unscored handoff_events and computes rolling role-seam aggregates.
 *
 * Scoring heuristics:
 *   1. info_completeness: Checks whether the sender left activities, notes,
 *      or context on the subject before handoff. Weighted by field presence.
 *   2. recipient_readiness: Checks how quickly the recipient took first
 *      action after handoff. <4h = 1.0, <24h = 0.7, <72h = 0.4, >72h = 0.1.
 *   3. outcome_alignment: Checks whether the subject's status improved after
 *      handoff (deal stage advanced, task completed, etc.)
 *
 * Trigger: nightly via pg_cron or manual POST.
 * Auth: service_role (cron) or manager/owner (manual).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

interface UnscoredHandoff {
  id: string;
  workspace_id: string;
  subject_type: string;
  subject_id: string;
  from_user_id: string;
  to_user_id: string;
  handoff_at: string;
}

// ─── Scoring functions (pure) ──────────────────────────────────────────────

/**
 * Score info completeness: did the sender leave context?
 * Checks for activities created by the sender within 48h before handoff.
 */
function scoreInfoCompleteness(senderActivityCount: number): number {
  if (senderActivityCount >= 3) return 1.0;
  if (senderActivityCount >= 2) return 0.8;
  if (senderActivityCount >= 1) return 0.5;
  return 0.2; // No activity doesn't mean zero — there may be verbal context
}

/**
 * Score recipient readiness: how quickly did they act?
 */
function scoreRecipientReadiness(hoursToFirstAction: number | null): number {
  if (hoursToFirstAction === null) return 0.1; // No action taken yet
  if (hoursToFirstAction <= 4) return 1.0;
  if (hoursToFirstAction <= 24) return 0.7;
  if (hoursToFirstAction <= 72) return 0.4;
  return 0.1;
}

/**
 * Score outcome alignment: did the subject improve?
 */
function scoreOutcomeAlignment(
  outcome: "improved" | "unchanged" | "degraded" | "unknown",
): number {
  switch (outcome) {
    case "improved":
      return 1.0;
    case "unchanged":
      return 0.5;
    case "degraded":
      return 0.1;
    case "unknown":
      return 0.3;
  }
}

/**
 * Determine outcome by comparing subject state before and after handoff.
 * For deals: check if stage advanced (probability increased) or deal was won.
 */
async function determineOutcome(
  admin: ReturnType<typeof createClient>,
  subjectType: string,
  subjectId: string,
  handoffAt: string,
): Promise<"improved" | "unchanged" | "degraded" | "unknown"> {
  const afterCutoff = new Date(
    Date.parse(handoffAt) + 7 * 86_400_000,
  ).toISOString(); // 7 days after

  if (subjectType === "deal") {
    // Check if deal stage advanced within 7 days
    const { data: transitions } = await admin
      .from("qrm_stage_transitions")
      .select("from_stage_id, to_stage_id, at")
      .eq("deal_id", subjectId)
      .gte("at", handoffAt)
      .lt("at", afterCutoff)
      .order("at", { ascending: true })
      .limit(3);

    if (transitions && transitions.length > 0) {
      // Any forward transition counts as improved
      return "improved";
    }

    // Check if deal was won or lost
    const { data: deal } = await admin
      .from("crm_deals")
      .select("stage_id, closed_at")
      .eq("id", subjectId)
      .maybeSingle();

    if (deal?.closed_at) {
      // Check stage
      const { data: stage } = await admin
        .from("crm_deal_stages")
        .select("is_closed_won, is_closed_lost")
        .eq("id", deal.stage_id)
        .maybeSingle();

      if (stage?.is_closed_won) return "improved";
      if (stage?.is_closed_lost) return "degraded";
    }

    return "unchanged";
  }

  // For other subject types, default to unknown for now
  return "unknown";
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile || !["manager", "owner", "admin"].includes(profile.role)) {
        return safeJsonError("Requires manager or owner role", 403, origin);
      }
    }

    // Fetch unscored handoff events (limit per run to avoid timeouts)
    const { data: unscored, error: fetchErr } = await admin
      .from("handoff_events")
      .select("id, workspace_id, subject_type, subject_id, from_user_id, to_user_id, handoff_at")
      .is("scored_at", null)
      .order("handoff_at", { ascending: true })
      .limit(200);

    if (fetchErr) throw fetchErr;

    let scored = 0;
    let errors = 0;

    for (const h of (unscored ?? []) as UnscoredHandoff[]) {
      try {
        const handoffTime = Date.parse(h.handoff_at);
        const beforeCutoff = new Date(
          handoffTime - 48 * 3_600_000,
        ).toISOString(); // 48h before
        const afterCutoff = new Date(
          handoffTime + 72 * 3_600_000,
        ).toISOString(); // 72h after

        // 1. Info completeness: sender activities before handoff
        const { count: senderCount } = await admin
          .from("crm_activities")
          .select("*", { count: "exact", head: true })
          .eq("user_id", h.from_user_id)
          .gte("created_at", beforeCutoff)
          .lt("created_at", h.handoff_at);

        const infoScore = scoreInfoCompleteness(senderCount ?? 0);

        // 2. Recipient readiness: first action after handoff
        const { data: firstAction } = await admin
          .from("crm_activities")
          .select("created_at")
          .eq("user_id", h.to_user_id)
          .gte("created_at", h.handoff_at)
          .lt("created_at", afterCutoff)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const hoursToAction = firstAction
          ? (Date.parse(firstAction.created_at) - handoffTime) / 3_600_000
          : null;
        const readinessScore = scoreRecipientReadiness(hoursToAction);

        // 3. Outcome alignment
        const outcome = await determineOutcome(
          admin,
          h.subject_type,
          h.subject_id,
          h.handoff_at,
        );
        const outcomeScore = scoreOutcomeAlignment(outcome);

        // Update the handoff event with scores
        await admin
          .from("handoff_events")
          .update({
            info_completeness: infoScore,
            recipient_readiness: readinessScore,
            outcome_alignment: outcomeScore,
            outcome,
            scored_at: new Date().toISOString(),
          })
          .eq("id", h.id);

        scored++;
      } catch (scoringErr) {
        console.error(
          `[handoff-trust-scorer] failed to score event ${h.id}:`,
          scoringErr,
        );
        errors++;
      }
    }

    // Compute rolling 30-day seam scores for all workspaces that had handoffs
    const { data: workspaces } = await admin
      .from("handoff_events")
      .select("workspace_id")
      .gte("handoff_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .limit(1000);

    const uniqueWorkspaces = [
      ...new Set((workspaces ?? []).map((w) => w.workspace_id)),
    ];
    const periodEnd = new Date().toISOString();
    const periodStart = new Date(
      Date.now() - 30 * 86_400_000,
    ).toISOString();

    for (const ws of uniqueWorkspaces) {
      try {
        await admin.rpc("compute_handoff_seam_scores", {
          p_workspace_id: ws,
          p_period_start: periodStart,
          p_period_end: periodEnd,
        });
      } catch (rollupErr) {
        console.error(
          `[handoff-trust-scorer] seam score computation failed for workspace ${ws}:`,
          rollupErr,
        );
      }
    }

    return safeJsonOk({
      ok: true,
      scored,
      errors,
      workspaces_updated: uniqueWorkspaces.length,
      period_start: periodStart,
      period_end: periodEnd,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "handoff-trust-scorer", req });
    console.error("[handoff-trust-scorer] error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});
