/**
 * Deal Composite Edge Function
 *
 * Single endpoint returning complete deal context:
 * deal + stage + contact + company + needs_assessment + cadences +
 * demos + deposit + activities + loss_fields
 *
 * Replaces 9 separate frontend queries on the deal detail page.
 *
 * GET: ?deal_id=...
 * Auth: rep/admin/manager/owner (workspace-scoped via RPC)
 */
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "GET") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const url = new URL(req.url);
    const dealId = url.searchParams.get("deal_id");
    if (!dealId) {
      return safeJsonError("deal_id is required", 400, origin);
    }

    const { data, error } = await supabase.rpc("get_deal_composite", {
      p_deal_id: dealId,
    });

    if (error) {
      console.error("deal-composite RPC error:", error);
      return safeJsonError("Failed to load deal", 500, origin);
    }

    if (data?.error) {
      return safeJsonError(data.error, 404, origin);
    }

    return safeJsonOk(data, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "deal-composite", req });
    console.error("deal-composite error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
