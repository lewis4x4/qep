import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  applyPrecedentRecommendation,
  buildAutoTriageDraft,
  findBestPrecedentMatch,
  type PendingDecisionPayload,
  PRECEDENT_SIMILARITY_THRESHOLD,
  type PrecedentCandidate,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured",
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const body = await req.json().catch(() => ({})) as PendingDecisionPayload;
    const baseDraft = buildAutoTriageDraft(body);
    const admin = createAdminClient();

    const { data: precedents, error: precedenceError } = await admin
      .from("qep_decision_precedents")
      .select(
        "id, source_decision_id, pattern_summary, applied_answer, applied_rationale, owner_role",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (precedenceError) throw precedenceError;

    const bestMatch = findBestPrecedentMatch({
      decisionQuestion: baseDraft.question_plain,
      ownerRole: baseDraft.owner_role,
      precedents: (precedents ?? []) as PrecedentCandidate[],
      threshold: PRECEDENT_SIMILARITY_THRESHOLD,
    });

    const draft = bestMatch
      ? applyPrecedentRecommendation(
        baseDraft,
        bestMatch,
        PRECEDENT_SIMILARITY_THRESHOLD,
      )
      : baseDraft;

    let upserted: {
      id: string;
      code: string;
      lane: string;
      owner_role: string;
      status: string;
    } | null = null;
    if (body.apply_update === true || body.upsert === true) {
      const { data, error } = await admin
        .from("qep_decisions")
        .upsert(
          {
            code: draft.code,
            question_plain: draft.question_plain,
            lane: draft.lane,
            owner_role: draft.owner_role,
            options: draft.options,
            recommended_option: draft.recommended_option,
            recommended_rationale: draft.recommended_rationale,
            ai_prep_packet: draft.ai_prep_packet,
            citations: draft.citations,
            reversal_cost: draft.reversal_cost,
            silence_threshold_days: draft.silence_threshold_days,
            status: "open",
          },
          { onConflict: "code" },
        )
        .select("id, code, lane, owner_role, status")
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      upserted = data ?? null;
    }

    return safeJsonOk(
      {
        code: draft.code,
        question_plain: draft.question_plain,
        lane: draft.lane,
        owner_role: draft.owner_role,
        options: draft.options,
        recommended_option: draft.recommended_option,
        recommended_rationale: draft.recommended_rationale,
        reversal_cost: draft.reversal_cost,
        silence_threshold_days: draft.silence_threshold_days,
        ai_prep_packet: draft.ai_prep_packet,
        citations: draft.citations,
        status: draft.status,
        applied_update: body.apply_update === true || body.upsert === true,
        upserted_decision: upserted,
      },
      origin,
    );
  } catch (error) {
    captureEdgeException(error, { fn: "auto-triage-pipeline", req });
    console.error("auto-triage-pipeline error:", error);
    const message = error instanceof Error
      ? error.message
      : "Internal server error";
    return safeJsonError(message, 500, origin);
  }
});
