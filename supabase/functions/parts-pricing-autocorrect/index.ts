/**
 * Parts Pricing Autocorrect — Slice P2.5.
 *
 * Scans v_parts_pricing_drift for out-of-tolerance parts and either:
 *   1. Writes suggestions for admin approval (default, safe path)
 *   2. Applies directly (when the matching rule has auto_apply=true)
 *
 * Auth: service_role (cron) OR admin/manager/owner (manual trigger from UI).
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

interface RequestBody {
  rule_id?: string | null;
  // When true, auto-applies suggestions for rules where auto_apply=true
  apply_auto_rules?: boolean;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization")?.trim() ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError(origin, 500, "Missing SUPABASE_URL / SERVICE_ROLE_KEY");
    }

    let supabase: SupabaseClient;
    let calledBy: string;

    if (authHeader === `Bearer ${serviceKey}`) {
      supabase = createClient(supabaseUrl, serviceKey);
      calledBy = "cron";
    } else {
      const auth = await requireServiceUser(authHeader, origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError(origin, 403, "pricing autocorrect requires admin/manager/owner role");
      }
      supabase = createClient(supabaseUrl, serviceKey);
      calledBy = `user:${auth.userId}`;
    }

    const body = (req.method === "POST" ? await req.json() : {}) as RequestBody;

    // ── 1. Run the suggestions generator ──────────────────────────────────
    const { data: genResult, error: genErr } = await supabase
      .rpc("pricing_suggestions_generate", { p_rule_id: body.rule_id ?? null });

    if (genErr) {
      return safeJsonError(origin, 500, `pricing_suggestions_generate failed: ${genErr.message}`);
    }

    // ── 2. For auto_apply rules, fetch pending and apply them ────────────
    let autoAppliedCount = 0;
    if (body.apply_auto_rules === true) {
      // Fetch pending suggestions whose rules have auto_apply=true
      const { data: autoSuggestions } = await supabase
        .from("parts_pricing_suggestions")
        .select("id, rule_id, parts_pricing_rules!inner(auto_apply)")
        .eq("status", "pending")
        .eq("parts_pricing_rules.auto_apply", true);

      const autoIds = (autoSuggestions ?? []).map((s: { id: string }) => s.id);
      if (autoIds.length > 0) {
        const { data: applyResult, error: applyErr } = await supabase
          .rpc("pricing_suggestions_apply", {
            p_suggestion_ids: autoIds,
            p_note: `auto-applied via parts-pricing-autocorrect (${calledBy})`,
          });
        if (applyErr) {
          console.warn("auto-apply failed:", applyErr.message);
        } else {
          autoAppliedCount =
            (applyResult as { applied_count?: number })?.applied_count ?? 0;
        }
      }
    }

    // ── 3. Fetch summary for response ────────────────────────────────────
    const { data: summary } = await supabase.rpc("pricing_rules_summary");

    const elapsedMs = Date.now() - startMs;

    if (calledBy === "cron") {
      await logServiceCronRun(supabase, {
        jobName: "parts-pricing-autocorrect",
        ok: true,
        metadata: {
          elapsed_ms: elapsedMs,
          gen_result: genResult,
          auto_applied: autoAppliedCount,
        },
      });
    }

    return safeJsonOk(origin, {
      ok: true,
      called_by: calledBy,
      elapsed_ms: elapsedMs,
      generate: genResult,
      auto_applied_count: autoAppliedCount,
      summary,
    });
  } catch (err) {
    captureEdgeException(err, { fn: "parts-pricing-autocorrect" });
    return safeJsonError(origin, 500, (err as Error).message);
  }
});
