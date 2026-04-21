/**
 * qrm-prediction-trace — Phase 0 P0.8 trace viewer endpoint.
 *
 * Returns the full prediction trace for a given prediction ID: the
 * prediction row (including trace_steps), and any linked outcomes.
 * Manager-gated: requires admin, manager, or owner role.
 *
 * Input:  GET ?predictionId=<uuid>
 * Output: { prediction, outcomes }
 */

import {
  createAdminClient,
  validateUserToken,
  type UserRole,
} from "../_shared/dge-auth.ts";
import { corsHeaders, fail, ok, optionsResponse } from "../_shared/dge-http.ts";

const FN_NAME = "qrm-prediction-trace";
const ELEVATED_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "owner"]);

interface TraceStep {
  factor: string;
  value: number;
  weight: number;
  contribution: number;
}

interface PredictionRow {
  id: string;
  workspace_id: string;
  predicted_at: string;
  subject_type: string;
  subject_id: string;
  prediction_kind: string;
  score: number;
  rationale: unknown[];
  trace_id: string;
  trace_steps: TraceStep[];
  model_source: string;
  outcome: string | null;
  outcome_at: string | null;
}

interface OutcomeRow {
  id: string;
  outcome: string;
  observed_at: string;
  evidence: Record<string, unknown>;
  source: string;
}

interface TraceResponse {
  prediction: {
    id: string;
    trace_id: string;
    prediction_kind: string;
    score: number;
    rationale: string[];
    trace_steps: TraceStep[];
    model_source: string;
    predicted_at: string;
    outcome: string | null;
    outcome_at: string | null;
    subject_type: string;
    subject_id: string;
  };
  outcomes: Array<{
    id: string;
    outcome: string;
    observed_at: string;
    evidence: Record<string, unknown>;
    source: string;
  }>;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "GET") {
    return fail({ origin, status: 405, code: "method_not_allowed", message: "GET only" });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return fail({ origin, status: 401, code: "unauthorized", message: "Missing Authorization header" });
    }

    const adminClient = createAdminClient();

    // ES256-safe token validation via GoTrue. supabase-js's local verifier
    // rejects this project's ES256-signed tokens; validateUserToken side-
    // steps it by hitting /auth/v1/user directly.
    const validated = await validateUserToken(authHeader);
    if (!validated.ok) {
      return fail({ origin, status: 401, code: "unauthorized", message: "Invalid token" });
    }
    const userId = validated.userId;

    // Role check — manager-gated
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle<{ id: string; role: UserRole | null }>();

    if (profileError || !profile) {
      return fail({ origin, status: 401, code: "unauthorized", message: "Profile not found" });
    }

    if (!profile.role || !ELEVATED_ROLES.has(profile.role)) {
      return fail({ origin, status: 403, code: "forbidden", message: "Requires admin, manager, or owner role" });
    }

    // ── Parse input ─────────────────────────────────────────────────────────
    const url = new URL(req.url);
    const predictionId = url.searchParams.get("predictionId");
    if (!predictionId) {
      return fail({ origin, status: 400, code: "bad_request", message: "Missing predictionId query parameter" });
    }

    // ── Fetch prediction ────────────────────────────────────────────────────
    const { data: prediction, error: predError } = await adminClient
      .from("qrm_predictions")
      .select("id, workspace_id, predicted_at, subject_type, subject_id, prediction_kind, score, rationale, trace_id, trace_steps, model_source, outcome, outcome_at")
      .eq("id", predictionId)
      .maybeSingle<PredictionRow>();

    if (predError) {
      console.error(`[${FN_NAME}] prediction fetch error:`, predError.message);
      return fail({ origin, status: 500, code: "internal_error", message: "Failed to fetch prediction" });
    }

    if (!prediction) {
      return fail({ origin, status: 404, code: "not_found", message: "Prediction not found" });
    }

    // ── Fetch outcomes ──────────────────────────────────────────────────────
    const { data: outcomes, error: outcomesError } = await adminClient
      .from("qrm_prediction_outcomes")
      .select("id, outcome, observed_at, evidence, source")
      .eq("prediction_id", predictionId)
      .order("observed_at", { ascending: true });

    if (outcomesError) {
      console.error(`[${FN_NAME}] outcomes fetch error:`, outcomesError.message);
      // Non-fatal — return prediction without outcomes
    }

    // ── Build response ──────────────────────────────────────────────────────
    const response: TraceResponse = {
      prediction: {
        id: prediction.id,
        trace_id: prediction.trace_id,
        prediction_kind: prediction.prediction_kind,
        score: prediction.score,
        rationale: Array.isArray(prediction.rationale)
          ? prediction.rationale.map(String)
          : [],
        trace_steps: Array.isArray(prediction.trace_steps)
          ? prediction.trace_steps
          : [],
        model_source: prediction.model_source,
        predicted_at: prediction.predicted_at,
        outcome: prediction.outcome,
        outcome_at: prediction.outcome_at,
        subject_type: prediction.subject_type,
        subject_id: prediction.subject_id,
      },
      outcomes: (outcomes ?? []) as OutcomeRow[],
    };

    return ok(response, { origin });
  } catch (err) {
    console.error(`[${FN_NAME}] unhandled error:`, err);
    return fail({
      origin,
      status: 500,
      code: "internal_error",
      message: "Unexpected error",
    });
  }
});
