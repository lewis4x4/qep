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
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "GET") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

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
    console.error("deal-composite error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
