import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  classifyDecisionLane,
  mergeLaneClassificationInput,
  type DecisionLane,
  type LaneClassificationInput,
} from "./logic.ts";

interface LaneClassifierRequest extends LaneClassificationInput {
  apply_update?: boolean;
  decision_id?: string | null;
  decision_code?: string | null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type OpenDecisionRow = {
  id: string;
  code: string;
  lane: DecisionLane;
  question_plain: string | null;
  recommended_rationale: string | null;
  reversal_cost: string | null;
  options: unknown;
  citations: unknown;
  ai_prep_packet: unknown;
};

async function fetchOpenDecision(params: {
  decisionId?: string | null;
  decisionCode?: string | null;
}): Promise<OpenDecisionRow | null> {
  const identifier = (params.decisionId ?? "").trim() || (params.decisionCode ?? "").trim();
  if (!identifier) return null;

  const admin = createAdminClient();
  let query = admin
    .from("qep_decisions")
    .select("id, code, lane, question_plain, recommended_rationale, reversal_cost, options, citations, ai_prep_packet")
    .eq("status", "open")
    .limit(1);

  query = params.decisionId
    ? query.eq("id", params.decisionId)
    : query.eq("code", params.decisionCode ?? "");

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data ?? null) as OpenDecisionRow | null;
}

async function applyLaneUpdate(params: {
  lane: DecisionLane;
  decisionId?: string | null;
  decisionCode?: string | null;
}) {
  const identifier = (params.decisionId ?? "").trim() || (params.decisionCode ?? "").trim();
  if (!identifier) {
    throw new Error("decision_id or decision_code is required when apply_update=true");
  }

  const admin = createAdminClient();
  let query = admin
    .from("qep_decisions")
    .update({ lane: params.lane })
    .eq("status", "open");

  query = params.decisionId
    ? query.eq("id", params.decisionId)
    : query.eq("code", params.decisionCode ?? "");

  const { data, error } = await query
    .select("id, code, lane")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Open decision row not found for provided identifier");
  return data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const body = await req.json().catch(() => ({})) as LaneClassifierRequest;

    const fetchedDecision = await fetchOpenDecision({
      decisionId: body.decision_id,
      decisionCode: body.decision_code,
    });

    const mergedInput = fetchedDecision
      ? mergeLaneClassificationInput(
        {
          code: fetchedDecision.code,
          question_plain: fetchedDecision.question_plain,
          recommended_rationale: fetchedDecision.recommended_rationale,
          reversal_cost: fetchedDecision.reversal_cost,
          options: fetchedDecision.options,
          citations: fetchedDecision.citations,
          ai_prep_packet: fetchedDecision.ai_prep_packet,
        },
        body,
      )
      : body;

    const classification = classifyDecisionLane(mergedInput);

    let updatedDecision: { id: string; code: string; lane: DecisionLane } | null = null;
    if (body.apply_update === true) {
      updatedDecision = await applyLaneUpdate({
        lane: classification.lane,
        decisionId: body.decision_id,
        decisionCode: body.decision_code,
      }) as { id: string; code: string; lane: DecisionLane };
    }

    return safeJsonOk({
      lane: classification.lane,
      matched_keywords: classification.matchedKeywords,
      reason: classification.reason,
      updated_decision: updatedDecision,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "lane-classifier", req });
    console.error("lane-classifier error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return safeJsonError(message, 500, origin);
  }
});
