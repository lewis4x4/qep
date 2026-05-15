/**
 * Quote Incentive Resolver Edge Function (Wave 5A.3 / Phase 2A)
 *
 * Walks the line items on a quote, queries match_quote_incentives() for
 * applicable manufacturer_incentives, resolves stackability collisions
 * (only one non-stackable per manufacturer), and persists the chosen
 * applications into quote_incentive_applications.
 *
 * POST /quote-incentive-resolver
 *   { quote_package_id: uuid, dry_run?: boolean }
 *
 * Returns:
 *   { applied: [...], skipped: [...], total_savings: number }
 *
 * Auth: rep/admin/manager/owner
 */
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { normalizeIncentive, resolveIncentiveStack } from "./logic.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    // Canonical JWT auth — ES256-safe via GoTrue, gates rep/admin/manager/owner,
    // returns a user-scoped supabase client so RLS sees caller identity on writes.
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const supabase = auth.supabase;
    const user = { id: auth.userId };

    const body = await req.json().catch(() => ({}));
    const quoteId: string | undefined = body.quote_package_id;
    const dryRun: boolean = body.dry_run === true;
    if (!quoteId) return safeJsonError("quote_package_id required", 400, origin);

    // Pull quote subtotal so we can compute pct discounts
    const { data: quote, error: quoteErr } = await supabase
      .from("quote_packages")
      .select("id, subtotal, equipment_total, status")
      .eq("id", quoteId)
      .single();
    if (quoteErr || !quote) return safeJsonError("Quote not found", 404, origin);

    // Get matching incentives via the RPC
    const { data: matches, error: matchErr } = await supabase
      .rpc("match_quote_incentives", { p_quote_package_id: quoteId });
    if (matchErr) return safeJsonError("Match RPC failed", 500, origin);

    const incentives = (matches ?? []).flatMap((match: unknown) => {
      const normalized = normalizeIncentive(match);
      return normalized ? [normalized] : [];
    });
    const { applied, skipped } = resolveIncentiveStack(incentives, quote);

    const totalSavings = applied.reduce((sum, a) => sum + a.amount, 0);

    // Persist applications unless dry_run
    if (!dryRun && applied.length > 0) {
      // First, soft-delete any prior auto_applied rows for this quote
      await supabase
        .from("quote_incentive_applications")
        .update({ removed_at: new Date().toISOString(), removed_by: user.id, removal_reason: "superseded by resolver re-run" })
        .eq("quote_package_id", quoteId)
        .eq("auto_applied", true)
        .is("removed_at", null);

      const insertRows = applied.map((a) => ({
        quote_package_id: quoteId,
        incentive_id: a.incentive.id,
        applied_amount: a.amount,
        applied_by: user.id,
        auto_applied: true,
      }));
      const { error: insErr } = await supabase
        .from("quote_incentive_applications")
        .insert(insertRows);
      if (insErr) return safeJsonError("Failed to persist applications", 500, origin);
    }

    return safeJsonOk({
      applied: applied.map((a) => ({
        incentive_id: a.incentive.id,
        program_name: a.incentive.program_name,
        manufacturer: a.incentive.manufacturer,
        discount_type: a.incentive.discount_type,
        stack_kind: a.incentive.stack_kind,
        amount: a.amount,
        requires_approval: a.incentive.requires_approval,
        stackable: a.incentive.stackable,
      })),
      skipped: skipped.map((s) => ({
        incentive_id: s.incentive.id,
        program_name: s.incentive.program_name,
        reason: s.reason,
      })),
      total_savings: totalSavings,
      dry_run: dryRun,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "quote-incentive-resolver", req });
    console.error("quote-incentive-resolver error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
