/**
 * QRM Prediction Scorer — nightly grader (Phase 0 P0.3 skeleton).
 *
 * Closes out predictions in `qrm_predictions` against observed deal outcomes
 * once they materialize. Runs as a service-role cron + per-user JWT path,
 * matching the morning-briefing pattern.
 *
 * ── Phase 0 vs Phase 4 scope ────────────────────────────────────────────────
 *
 * Phase 0 ships ONLY the skeleton:
 *   - Auth (service role + per-user)
 *   - Deal-outcome lookup against crm_deal_stages flags
 *   - One outcome row per resolved prediction in qrm_prediction_outcomes
 *   - The corresponding qrm_predictions.outcome canonical update
 *   - A simple per-prediction grade ('won' / 'lost' / 'expired')
 *
 * Phase 4 grows this into:
 *   - Forecast Confidence accuracy bands grouped by inputs_hash
 *   - Trust Thermostat post-hoc receipts
 *   - Retention enforcement (prune ungraded > 180 days)
 *   - LLM rerank training data export
 *
 * For Phase 0, the skeleton is intentionally minimal. We want the SHAPE of
 * the grader to exist on disk so Day 5 (P0.3 integration) and Day 12 (Phase
 * 0 exit audit) can verify the loop closes end-to-end.
 *
 * ── Outcome determination ───────────────────────────────────────────────────
 *
 * Per Day 2 verification §3, the grading path is:
 *
 *   - 'won'     → crm_deals.stage_id → crm_deal_stages.is_closed_won = true
 *   - 'lost'    → crm_deals.stage_id → crm_deal_stages.is_closed_lost = true
 *   - 'expired' → predicted_at + EXPIRY_WINDOW < now AND outcome IS NULL AND
 *                 deal still open (neither won nor lost)
 *   - 'snoozed' → never set by the scorer; only set by user dismiss action
 *
 * EXPIRY_WINDOW is 30 days for Phase 0 (recommendations stale beyond a month
 * are considered "expired" for grading purposes — we still keep them in the
 * ledger forever once graded, but the ungraded prune at 180d removes any
 * that never got resolved at all).
 */

import { createAdminClient } from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

const FN_NAME = "qrm-prediction-scorer";

// Phase 0: 30 days. Phase 4 may make this configurable per workspace.
const EXPIRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Cap per run so a backlog doesn't blow up the function. Phase 4 will tune.
const PER_RUN_CAP = 500;

interface OpenPredictionRow {
  id: string;
  workspace_id: string;
  subject_type: string;
  subject_id: string;
  prediction_kind: string;
  predicted_at: string;
}

interface DealStateRow {
  id: string;
  stage_id: string;
  closed_at: string | null;
}

interface StageFlagsRow {
  id: string;
  is_closed_won: boolean;
  is_closed_lost: boolean;
}

type Outcome = "won" | "lost" | "expired";

interface GradeResult {
  predictionId: string;
  workspaceId: string;
  outcome: Outcome;
  evidence: Record<string, unknown>;
}

// ─── Grading logic (pure, no IO) ────────────────────────────────────────────

interface GradeInputs {
  prediction: OpenPredictionRow;
  deal: DealStateRow | undefined;
  stageFlags: StageFlagsRow | undefined;
  nowMs: number;
}

export function gradePrediction(input: GradeInputs): GradeResult | null {
  const { prediction, deal, stageFlags, nowMs } = input;
  const predictedAtMs = Date.parse(prediction.predicted_at);
  const ageMs = Number.isFinite(predictedAtMs) ? nowMs - predictedAtMs : 0;

  // Subject not found (deal deleted, etc.) — count as expired so it leaves
  // the open queue. Phase 4 may change this to a 'lost' or 'snoozed' state
  // depending on user preference.
  if (!deal) {
    if (ageMs > EXPIRY_WINDOW_MS) {
      return {
        predictionId: prediction.id,
        workspaceId: prediction.workspace_id,
        outcome: "expired",
        evidence: { reason: "subject_not_found", age_ms: ageMs },
      };
    }
    return null;
  }

  // Stage flags missing — should not happen, but skip rather than crash.
  if (!stageFlags) return null;

  if (stageFlags.is_closed_won) {
    return {
      predictionId: prediction.id,
      workspaceId: prediction.workspace_id,
      outcome: "won",
      evidence: {
        deal_id: deal.id,
        stage_id: deal.stage_id,
        is_closed_won: true,
        closed_at: deal.closed_at,
      },
    };
  }

  if (stageFlags.is_closed_lost) {
    return {
      predictionId: prediction.id,
      workspaceId: prediction.workspace_id,
      outcome: "lost",
      evidence: {
        deal_id: deal.id,
        stage_id: deal.stage_id,
        is_closed_lost: true,
        closed_at: deal.closed_at,
      },
    };
  }

  // Still open. If older than the expiry window, mark expired so it leaves
  // the ungraded backlog and doesn't block the prune job.
  if (ageMs > EXPIRY_WINDOW_MS) {
    return {
      predictionId: prediction.id,
      workspaceId: prediction.workspace_id,
      outcome: "expired",
      evidence: {
        deal_id: deal.id,
        stage_id: deal.stage_id,
        age_ms: ageMs,
        reason: "open_past_expiry_window",
      },
    };
  }

  // Still open and within the expiry window — leave it alone.
  return null;
}

// ─── Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  // Phase 0: service-role only. The scorer is a cron job, not a user surface.
  // Phase 4 will add a per-user JWT path so reps can manually re-grade their
  // own predictions.
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecretHeader = req.headers.get("x-internal-service-secret") ?? "";
  const internalServiceSecret =
    Deno.env.get("INTERNAL_SERVICE_SECRET") ??
    Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
    "";

  const isServiceRole =
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`) ||
    (internalServiceSecret.length > 0 && internalSecretHeader === internalServiceSecret);

  if (!isServiceRole) {
    return safeJsonError("Unauthorized — service role required", 401, origin);
  }

  const startedAt = Date.now();

  try {
    const adminClient = createAdminClient();

    // 1. Pull the open prediction backlog (ungraded, capped per run).
    const { data: openRows, error: openError } = await adminClient
      .from("qrm_predictions")
      .select("id, workspace_id, subject_type, subject_id, prediction_kind, predicted_at")
      .is("outcome", null)
      .order("predicted_at", { ascending: true })
      .limit(PER_RUN_CAP);
    if (openError) throw openError;
    const openPredictions = (openRows ?? []) as OpenPredictionRow[];

    if (openPredictions.length === 0) {
      return safeJsonOk(
        {
          ok: true,
          graded: 0,
          checked: 0,
          duration_ms: Date.now() - startedAt,
          message: "No open predictions to grade.",
        },
        origin,
      );
    }

    // 2. For deal-typed predictions, batch-fetch the deals + their stage flags.
    const dealSubjectIds = openPredictions
      .filter((p) => p.subject_type === "deal")
      .map((p) => p.subject_id);

    let dealById = new Map<string, DealStateRow>();
    let stageById = new Map<string, StageFlagsRow>();

    if (dealSubjectIds.length > 0) {
      const { data: deals, error: dealsError } = await adminClient
        .from("crm_deals")
        .select("id, stage_id, closed_at")
        .in("id", dealSubjectIds);
      if (dealsError) throw dealsError;

      const dealsArray = (deals ?? []) as DealStateRow[];
      dealById = new Map(dealsArray.map((d) => [d.id, d]));

      const stageIds = Array.from(new Set(dealsArray.map((d) => d.stage_id)));
      if (stageIds.length > 0) {
        const { data: stages, error: stagesError } = await adminClient
          .from("crm_deal_stages")
          .select("id, is_closed_won, is_closed_lost")
          .in("id", stageIds);
        if (stagesError) throw stagesError;
        stageById = new Map(((stages ?? []) as StageFlagsRow[]).map((s) => [s.id, s]));
      }
    }

    // 3. Grade each open prediction.
    const nowMs = Date.now();
    const grades: GradeResult[] = [];
    for (const prediction of openPredictions) {
      if (prediction.subject_type !== "deal") {
        // Non-deal subjects (contact, company, quote, demo, task) are not
        // graded by this Phase 0 skeleton. Phase 4 grows this.
        continue;
      }
      const deal = dealById.get(prediction.subject_id);
      const stageFlags = deal ? stageById.get(deal.stage_id) : undefined;
      const grade = gradePrediction({ prediction, deal, stageFlags, nowMs });
      if (grade) grades.push(grade);
    }

    // 4. Persist outcomes — append to qrm_prediction_outcomes AND set the
    //    canonical pointer on qrm_predictions.outcome.
    if (grades.length > 0) {
      const outcomeRows = grades.map((g) => ({
        workspace_id: g.workspaceId,
        prediction_id: g.predictionId,
        outcome: g.outcome,
        evidence: g.evidence,
        source: FN_NAME,
      }));
      const { error: outcomesError } = await adminClient
        .from("qrm_prediction_outcomes")
        .insert(outcomeRows);
      if (outcomesError) throw outcomesError;

      // Update the canonical outcome pointer on each prediction.
      // Done in a loop because the SDK doesn't expose batch UPDATE on different
      // primary keys. Phase 4 may push this into a SQL function.
      for (const grade of grades) {
        const { error: updateError } = await adminClient
          .from("qrm_predictions")
          .update({ outcome: grade.outcome, outcome_at: new Date(nowMs).toISOString() })
          .eq("id", grade.predictionId);
        if (updateError) {
          console.error(`[${FN_NAME}] outcome update failed for ${grade.predictionId}:`, updateError.message);
        }
      }
    }

    const duration = Date.now() - startedAt;
    console.log(
      `[${FN_NAME}] checked=${openPredictions.length} graded=${grades.length} in ${duration}ms`,
    );

    return safeJsonOk(
      {
        ok: true,
        checked: openPredictions.length,
        graded: grades.length,
        duration_ms: duration,
      },
      origin,
    );
  } catch (err) {
    captureEdgeException(err, { fn: FN_NAME, req });
    console.error(`[${FN_NAME}] error`, err);
    return safeJsonError(
      err instanceof Error ? err.message : "Internal error",
      500,
      origin,
    );
  }
});
