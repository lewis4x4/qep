/**
 * Service invoice generator — wraps shared helper for manual/regenerate invokes.
 * Auth: user JWT
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { generateInvoiceForServiceJob } from "../_shared/service-invoice.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const body = await req.json() as { job_id?: string };
    if (!body.job_id) return safeJsonError("job_id required", 400, origin);

    const r = await generateInvoiceForServiceJob(auth.supabase, body.job_id);
    if (r.error) return safeJsonError(r.error, 400, origin);
    return safeJsonOk({ invoice_id: r.invoice_id }, origin);
  } catch (err) {
    console.error("service-invoice-generator:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
