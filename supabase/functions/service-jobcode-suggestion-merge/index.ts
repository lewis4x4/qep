/**
 * Apply a pending job_code_template_suggestions row to job_codes (admin/manager/owner).
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

const MERGE_ROLES = new Set(["admin", "manager", "owner"]);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!MERGE_ROLES.has(auth.role)) {
      return safeJsonError("Manager or admin required", 403, origin);
    }

    const body = await req.json() as { suggestion_id?: string };
    if (!body.suggestion_id) {
      return safeJsonError("suggestion_id required", 400, origin);
    }

    const { data: row, error: fetchErr } = await auth.supabase
      .from("job_code_template_suggestions")
      .select("id, job_code_id, suggested_parts_template, suggested_common_add_ons, review_status")
      .eq("id", body.suggestion_id)
      .maybeSingle();

    if (fetchErr || !row) return safeJsonError("Suggestion not found", 404, origin);
    if (row.review_status !== "pending") {
      return safeJsonError("Suggestion is not pending", 400, origin);
    }

    const { error: updJc } = await auth.supabase
      .from("job_codes")
      .update({
        parts_template: row.suggested_parts_template,
        common_add_ons: row.suggested_common_add_ons,
        is_system_generated: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.job_code_id);

    if (updJc) return safeJsonError(updJc.message, 400, origin);

    const { error: updSug } = await auth.supabase
      .from("job_code_template_suggestions")
      .update({
        review_status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updSug) return safeJsonError(updSug.message, 400, origin);

    return safeJsonOk({ ok: true, job_code_id: row.job_code_id }, origin);
  } catch (e) {
    console.error("service-jobcode-suggestion-merge:", e);
    if (e instanceof SyntaxError) {
      return safeJsonError("Invalid JSON", 400, origin);
    }
    return safeJsonError("Internal error", 500, origin);
  }
});
