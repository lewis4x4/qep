import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  APPRAISAL_ALLOWED_ROLES,
  canAuthorPerformanceAppraisal,
  isReviewType,
  isScorecardRole,
} from "../_shared/performance-appraisal.ts";

type JsonRecord = Record<string, unknown>;

type Action = "create" | "score" | "finalize" | "sign" | "acknowledge";

function getAppraisalIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("appraisals");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  const fnIdx = parts.indexOf("performance-appraisals");
  if (fnIdx >= 0 && parts[fnIdx + 1] && parts[fnIdx + 1] !== "scorecards") {
    return parts[fnIdx + 1];
  }
  return null;
}

function normalizeAction(value: unknown): Action | null {
  return value === "create" || value === "score" || value === "finalize" ||
      value === "sign" || value === "acknowledge"
    ? value
    : null;
}

async function readBody(req: Request): Promise<JsonRecord> {
  const body = await req.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? body as JsonRecord : {};
}

function requireString(body: JsonRecord, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`missing_${key}`);
  }
  return value.trim();
}

function optionalString(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalNumber(body: JsonRecord, key: string): number | null {
  const value = body[key];
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_${key}`);
  return parsed;
}

function rpcErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown appraisal error";
  const maybe = error as { message?: unknown; details?: unknown };
  return typeof maybe.message === "string" ? maybe.message : "Unknown appraisal error";
}

function rpcErrorStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 400;
  const code = (error as { code?: unknown }).code;
  return code === "42501" || code === "PGRST301" ? 403 : 400;
}

function mapCaughtError(err: unknown, origin: string | null): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("missing_") || message.startsWith("invalid_")) {
    return safeJsonError(message, 400, origin);
  }
  return safeJsonError(message, 500, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
      APPRAISAL_ALLOWED_ROLES,
    );
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const appraisalId = getAppraisalIdFromPath(url.pathname);

    if (req.method === "GET") {
      if (url.pathname.endsWith("/scorecards")) {
        const { data, error } = await auth.supabase
          .from("employee_appraisal_scorecard_categories")
          .select("scorecard_role,category_key,display_order,category_name,criteria,source_document")
          .eq("active", true)
          .order("scorecard_role", { ascending: true })
          .order("display_order", { ascending: true });
        if (error) return safeJsonError(error.message, 500, origin);
        return safeJsonOk({ scorecards: data ?? [] }, origin);
      }

      if (appraisalId) {
        const { data, error } = await auth.supabase
          .from("v_employee_performance_appraisals")
          .select("*")
          .eq("id", appraisalId)
          .maybeSingle();
        if (error) return safeJsonError(error.message, 500, origin);
        if (!data) return safeJsonError("Appraisal not found", 404, origin);
        return safeJsonOk({ appraisal: data }, origin);
      }

      const subjectEmployeeId = url.searchParams.get("subject_employee_id");
      const status = url.searchParams.get("status");
      let query = auth.supabase
        .from("v_employee_performance_appraisals")
        .select("*")
        .order("review_period_end", { ascending: false })
        .limit(100);
      if (subjectEmployeeId) query = query.eq("subject_employee_id", subjectEmployeeId);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return safeJsonError(error.message, 500, origin);
      return safeJsonOk({ appraisals: data ?? [] }, origin);
    }

    if (req.method !== "POST" && req.method !== "PATCH") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const body = await readBody(req);
    const action = normalizeAction(body.action) ?? (appraisalId ? "score" : "create");

    if (action === "create") {
      if (!canAuthorPerformanceAppraisal(auth.role)) {
        return safeJsonError("Only managers, admins, and owners can create appraisals", 403, origin);
      }
      const reviewType = requireString(body, "review_type");
      if (!isReviewType(reviewType)) return safeJsonError("Invalid review_type", 400, origin);
      const scorecardRole = body.scorecard_role == null ? null : requireString(body, "scorecard_role");
      if (scorecardRole != null && !isScorecardRole(scorecardRole)) {
        return safeJsonError("Invalid scorecard_role", 400, origin);
      }
      const { data, error } = await auth.supabase.rpc("employee_appraisal_create", {
        p_subject_employee_id: requireString(body, "subject_employee_id"),
        p_review_type: reviewType,
        p_review_period_start: requireString(body, "review_period_start"),
        p_review_period_end: requireString(body, "review_period_end"),
        p_scorecard_role: scorecardRole,
        p_cost_of_living_raise_pct: optionalNumber(body, "cost_of_living_raise_pct") ?? 0,
        p_manager_summary: optionalString(body, "manager_summary"),
      });
      if (error) return safeJsonError(rpcErrorMessage(error), rpcErrorStatus(error), origin);
      return safeJsonOk({ appraisal_id: data }, origin);
    }

    const targetAppraisalId = appraisalId ?? optionalString(body, "appraisal_id");
    if (!targetAppraisalId) return safeJsonError("missing_appraisal_id", 400, origin);

    if (action === "score") {
      if (!canAuthorPerformanceAppraisal(auth.role)) {
        return safeJsonError("Only managers, admins, and owners can score appraisals", 403, origin);
      }
      const scores = body.scores;
      if (!Array.isArray(scores)) return safeJsonError("scores must be an array", 400, origin);
      const { error } = await auth.supabase.rpc("employee_appraisal_score", {
        p_appraisal_id: targetAppraisalId,
        p_scores: scores,
        p_manager_summary: optionalString(body, "manager_summary"),
        p_cost_of_living_raise_pct: optionalNumber(body, "cost_of_living_raise_pct"),
        p_key_strengths: Array.isArray(body.key_strengths) ? body.key_strengths : null,
        p_improvement_areas: Array.isArray(body.improvement_areas) ? body.improvement_areas : null,
        p_goals_next_period: Array.isArray(body.goals_next_period) ? body.goals_next_period : null,
      });
      if (error) return safeJsonError(rpcErrorMessage(error), rpcErrorStatus(error), origin);
      return safeJsonOk({ ok: true }, origin);
    }

    if (action === "finalize") {
      if (!canAuthorPerformanceAppraisal(auth.role)) {
        return safeJsonError("Only managers, admins, and owners can finalize appraisals", 403, origin);
      }
      const { error } = await auth.supabase.rpc("employee_appraisal_finalize", {
        p_appraisal_id: targetAppraisalId,
        p_manager_summary: optionalString(body, "manager_summary"),
        p_manager_signature_name: optionalString(body, "manager_signature_name"),
      });
      if (error) return safeJsonError(rpcErrorMessage(error), rpcErrorStatus(error), origin);
      return safeJsonOk({ ok: true }, origin);
    }

    const { error } = await auth.supabase.rpc("employee_appraisal_acknowledge", {
      p_appraisal_id: targetAppraisalId,
      p_employee_signature_name: optionalString(body, "employee_signature_name"),
      p_employee_comments: optionalString(body, "employee_comments"),
    });
    if (error) return safeJsonError(rpcErrorMessage(error), rpcErrorStatus(error), origin);
    return safeJsonOk({ ok: true }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "performance-appraisals", req });
    return mapCaughtError(err, origin);
  }
});
