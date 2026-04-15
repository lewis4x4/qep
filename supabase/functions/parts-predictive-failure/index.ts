/**
 * Parts Predictive Failure — Phase 3.3 Moonshot.
 *
 * For each customer machine we track, projects which parts will likely be
 * needed in the next 90 days, and tells the sales rep to pre-position them.
 *
 * Strategy:
 *   1. Call predict_parts_needs() SQL RPC — pure-SQL baseline from
 *      customer_fleet current_hours vs machine_profiles.maintenance_schedule +
 *      common_wear_parts.
 *   2. (Optional v2) Augment with Claude-generated reasoning for edge cases —
 *      seasonal patterns, customer-specific usage profiles, etc.
 *   3. Return a summary of plays with next-action hints.
 *
 * Auth: admin / manager / owner (like other cron-style orchestrators).
 * Can be invoked by:
 *   - Daily cron (primary)
 *   - Manual "recompute plays" button in /parts/companion/intelligence
 *   - Post-telemetry update webhook (future)
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
  lookahead_days?: number;
  workspace?: string | null;
  // When true: also call auto-replenish afterwards so scheduled orders reflect
  // the freshly-computed plays
  chain_auto_replenish?: boolean;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    // Support both user-JWT (from Intelligence page) and service_role (cron)
    const authHeader = req.headers.get("Authorization")?.trim() ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError(origin, 500, "Missing SUPABASE_URL / SERVICE_ROLE_KEY");
    }

    let supabase: SupabaseClient;
    let calledBy: string;

    if (authHeader === `Bearer ${serviceKey}`) {
      // Service-role cron path
      supabase = createClient(supabaseUrl, serviceKey);
      calledBy = "cron";
    } else {
      const auth = await requireServiceUser(authHeader, origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError(origin, 403, "predictive failure requires admin/manager/owner role");
      }
      // Service client for the heavy RPC writes
      supabase = createClient(supabaseUrl, serviceKey);
      calledBy = `user:${auth.userId}`;
    }

    const body = (req.method === "POST" ? await req.json() : {}) as RequestBody;
    const lookahead = body.lookahead_days ?? 90;

    // ── 1. Run the pure-SQL baseline prediction ──────────────────────────
    const { data: predictResult, error: predictErr } = await supabase
      .rpc("predict_parts_needs", {
        p_workspace: body.workspace ?? null,
        p_lookahead_days: lookahead,
      });

    if (predictErr) {
      return safeJsonError(origin, 500, `predict_parts_needs failed: ${predictErr.message}`);
    }

    // ── 2. Optionally chain into auto-replenish ──────────────────────────
    let replenishResult: Record<string, unknown> | null = null;
    if (body.chain_auto_replenish === true) {
      try {
        const replenishRes = await fetch(
          `${supabaseUrl}/functions/v1/parts-auto-replenish`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          },
        );
        replenishResult = await replenishRes.json();
      } catch (err) {
        console.warn("auto-replenish chain failed:", (err as Error).message);
        replenishResult = { error: (err as Error).message };
      }
    }

    // ── 3. Fetch summary for the response ────────────────────────────────
    const { data: summary } = await supabase
      .rpc("predictive_plays_summary", {
        p_workspace: body.workspace ?? null,
      });

    const elapsedMs = Date.now() - startMs;

    // Log cron run (if called by service role)
    if (calledBy === "cron") {
      await logServiceCronRun(supabase, {
        jobName: "parts-predictive-failure",
        ok: true,
        metadata: {
          elapsed_ms: elapsedMs,
          lookahead_days: lookahead,
          predict_result: predictResult,
          replenish_chained: body.chain_auto_replenish === true,
        },
      });
    }

    return safeJsonOk(origin, {
      ok: true,
      called_by: calledBy,
      elapsed_ms: elapsedMs,
      predict: predictResult,
      replenish: replenishResult,
      summary,
    });
  } catch (err) {
    captureEdgeException(err, { fn: "parts-predictive-failure" });
    return safeJsonError(origin, 500, (err as Error).message);
  }
});
