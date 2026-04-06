/**
 * Post draft internal billing staging lines (consumed parts) to customer_invoices.
 * Auth: user JWT only (same as service-parts-manager).
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface Body {
  service_job_id?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as Body;
    const jobId = body.service_job_id?.trim();
    if (!jobId) return safeJsonError("service_job_id required", 400, origin);

    const { data, error } = await auth.supabase.rpc("service_post_internal_billing_to_invoice", {
      p_service_job_id: jobId,
      p_actor_id: auth.userId,
    });

    if (error) {
      const msg = error.message ?? "billing_post_failed";
      const code = (error as { code?: string }).code;
      const status = code === "42501" || /forbidden/i.test(msg) ? 403 : 400;
      return safeJsonError(msg, status, origin);
    }

    const payload = data as { ok?: boolean; error?: string } | null;
    if (payload && payload.ok === false && payload.error === "no_draft_lines") {
      return safeJsonError("no_draft_lines", 400, origin);
    }

    return safeJsonOk(data ?? {}, origin);
  } catch (err) {
    console.error("service-billing-post error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
