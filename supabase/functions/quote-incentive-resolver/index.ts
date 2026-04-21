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
interface Incentive {
  id: string;
  manufacturer: string;
  program_name: string;
  discount_type: "flat" | "pct" | "apr_buydown" | "cash_back";
  discount_value: number;
  stackable: boolean;
  requires_approval: boolean;
}

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

    const incentives = (matches ?? []) as Incentive[];

    // Resolve stackability — for each manufacturer, allow ALL stackables and
    // at most ONE non-stackable (the highest-value one).
    const byMfr = new Map<string, Incentive[]>();
    for (const inc of incentives) {
      const k = inc.manufacturer.toLowerCase();
      if (!byMfr.has(k)) byMfr.set(k, []);
      byMfr.get(k)!.push(inc);
    }

    const applied: Array<{ incentive: Incentive; amount: number }> = [];
    const skipped: Array<{ incentive: Incentive; reason: string }> = [];

    for (const [, group] of byMfr) {
      const stackables = group.filter((g) => g.stackable);
      const nonStackables = group.filter((g) => !g.stackable);
      const chosenNonStackable = nonStackables.length > 0
        ? nonStackables.reduce((a, b) => (computeAmount(a, quote) > computeAmount(b, quote) ? a : b))
        : null;

      for (const stk of stackables) {
        applied.push({ incentive: stk, amount: computeAmount(stk, quote) });
      }
      if (chosenNonStackable) {
        applied.push({ incentive: chosenNonStackable, amount: computeAmount(chosenNonStackable, quote) });
        for (const ns of nonStackables) {
          if (ns.id !== chosenNonStackable.id) {
            skipped.push({ incentive: ns, reason: "non-stackable, lower value than peer" });
          }
        }
      }
    }

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

function computeAmount(incentive: Incentive, quote: { subtotal: number | null; equipment_total: number | null }): number {
  const base = (quote.equipment_total ?? quote.subtotal ?? 0) as number;
  switch (incentive.discount_type) {
    case "flat":
    case "cash_back":
      return Number(incentive.discount_value);
    case "pct":
      return Math.round(base * (Number(incentive.discount_value) / 100) * 100) / 100;
    case "apr_buydown":
      // Buydown represents a financing cost reduction; surface as a flat
      // estimate of (discount_value * base / 100) for the customer-facing total.
      return Math.round(base * (Number(incentive.discount_value) / 100) * 100) / 100;
  }
}
