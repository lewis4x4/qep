/**
 * Health Score Refresh Edge Function (Cron or Manual)
 *
 * Moonshot 5: Cross-Department Nervous System.
 * Batch-refreshes customer health scores and generates cross-department alerts.
 *
 * POST: Refresh health scores + generate alerts
 * GET:  Summary of current health score distribution
 *
 * Auth: service_role (cron) or manager/owner (manual)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { refreshCustomerProfileSnapshot } from "../_shared/customer-profile-refresh.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    // Cron path: accept x-internal-service-secret before requiring Bearer.
    const cronCaller = isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!cronCaller && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = cronCaller || authHeader === `Bearer ${serviceRoleKey}`;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    if (!isServiceRole) {
      // User path — canonical ES256-safe JWT auth. Narrow to manager/owner
      // since health score refresh is a sensitive aggregate operation.
      const auth = await requireServiceUser(authHeader ?? null, origin);
      if (!auth.ok) return auth.response;
      if (!["manager", "owner"].includes(auth.role)) {
        return safeJsonError("Health score refresh requires manager or owner role", 403, origin);
      }
    }

    // GET: Current health score summary
    if (req.method === "GET") {
      const { data } = await supabaseAdmin
        .from("customer_profiles_extended")
        .select("health_score, customer_name")
        .not("health_score", "is", null)
        .order("health_score", { ascending: false })
        .limit(100);

      const scores = (data ?? []).map((d: { health_score: number }) => d.health_score);
      const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;

      return safeJsonOk({
        total_scored: scores.length,
        avg_score: Math.round(avg * 10) / 10,
        distribution: {
          excellent: scores.filter((s: number) => s >= 80).length,
          good: scores.filter((s: number) => s >= 60 && s < 80).length,
          fair: scores.filter((s: number) => s >= 40 && s < 60).length,
          at_risk: scores.filter((s: number) => s < 40).length,
        },
        top_customers: (data ?? []).slice(0, 10),
      }, origin);
    }

    // POST: Refresh all scores + generate alerts
    if (req.method === "POST") {
      const { data: profiles } = await supabaseAdmin
        .from("customer_profiles_extended")
        .select("id")
        .order("health_score_updated_at", { ascending: true, nullsFirst: true })
        .limit(200);

      let scoresRefreshed = 0;
      for (const profile of profiles ?? []) {
        const { error } = await supabaseAdmin.rpc("compute_customer_health_score", {
          p_customer_profile_id: profile.id,
        });
        if (!error) scoresRefreshed++;
      }

      // Generate cross-department alerts
      const { data: alertCount, error: alertErr } = await supabaseAdmin.rpc("generate_cross_department_alerts", {
        p_workspace_id: "default",
      });

      // N4.1 lifecycle DNA sweep: refresh company-anchored profiles whose
      // company had cross-stream activity since the last daily run, so
      // lifetime value and personas move on parts/rental/AR events — not
      // just DGE page views. 36h window overlaps runs; direct calls, no
      // separate job-queue drain needed.
      let dnaRefreshed = 0;
      let dnaFailed = 0;
      try {
        const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
        const [parts, invoices, deals, rentalInv] = await Promise.all([
          supabaseAdmin.from("parts_orders").select("crm_company_id").gt("created_at", since).not("crm_company_id", "is", null).limit(500),
          supabaseAdmin.from("customer_invoices").select("crm_company_id").gt("created_at", since).not("crm_company_id", "is", null).limit(500),
          supabaseAdmin.from("crm_deals").select("company_id").gt("updated_at", since).not("company_id", "is", null).limit(500),
          supabaseAdmin.from("rental_invoices").select("rental_contract_id").gt("created_at", since).limit(500),
        ]);
        const activeCompanies = new Set<string>();
        for (const r of parts.data ?? []) activeCompanies.add(r.crm_company_id as string);
        for (const r of invoices.data ?? []) activeCompanies.add(r.crm_company_id as string);
        for (const r of deals.data ?? []) activeCompanies.add(r.company_id as string);
        const contractIds = [...new Set((rentalInv.data ?? []).map((r) => r.rental_contract_id as string))];
        if (contractIds.length > 0) {
          const { data: contracts } = await supabaseAdmin
            .from("rental_contracts")
            .select("qrm_company_id")
            .in("id", contractIds)
            .not("qrm_company_id", "is", null);
          for (const r of contracts ?? []) activeCompanies.add(r.qrm_company_id as string);
        }

        if (activeCompanies.size > 0) {
          const { data: activeProfiles } = await supabaseAdmin
            .from("customer_profiles_extended")
            .select("id")
            .in("crm_company_id", [...activeCompanies].slice(0, 200))
            .limit(50);
          for (const profile of activeProfiles ?? []) {
            try {
              await refreshCustomerProfileSnapshot(supabaseAdmin, {
                lookup: { customer_profiles_extended_id: profile.id as string },
                actorRole: "owner",
                actorUserId: null,
                isServiceRole: true,
              });
              dnaRefreshed++;
            } catch (_err) {
              dnaFailed++;
            }
          }
        }
      } catch (err) {
        console.error("health-score-refresh: DNA sweep failed:", err);
      }

      return safeJsonOk({
        ok: true,
        scores_refreshed: scoresRefreshed,
        alerts_generated: alertErr ? 0 : (alertCount ?? 0),
        dna_refreshed: dnaRefreshed,
        dna_failed: dnaFailed,
      }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "health-score-refresh", req });
    console.error("health-score-refresh error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
