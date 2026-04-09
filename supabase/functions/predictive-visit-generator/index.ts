/**
 * Predictive Visit Generator — Nightly Edge Function (Slice 3.2)
 *
 * Generates daily visit recommendations for all active reps.
 * Scores customers across multiple signals:
 *   - Overdue follow-ups (>7 days since last contact)
 *   - Fleet replacement windows (equipment age/hours)
 *   - Open deal value and DGE scores
 *   - Days since last meaningful contact
 *   - Seasonal demand patterns
 *
 * Produces up to 10 ranked recommendations per rep per day.
 * Idempotent: re-running overwrites the same day's list.
 *
 * Trigger: nightly via pg_cron (migration 220)
 * Manual: POST with service role key or x-internal-service-secret
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const MAX_RECOMMENDATIONS = 10;

interface CustomerSignal {
  company_id: string;
  contact_id: string | null;
  company_name: string;
  contact_name: string | null;
  last_contact_days: number | null;
  open_deal_value: number;
  dge_score: number | null;
  fleet_replacement_score: number;
  seasonal_score: number;
  distance_km: number | null;
  reason: string;
}

function computePriorityScore(signal: CustomerSignal): number {
  let score = 0;

  // Overdue follow-up (0-30 points)
  if (signal.last_contact_days != null) {
    if (signal.last_contact_days > 30) score += 30;
    else if (signal.last_contact_days > 14) score += 20;
    else if (signal.last_contact_days > 7) score += 10;
  } else {
    score += 25; // Never contacted — high priority
  }

  // Open deal value (0-25 points)
  if (signal.open_deal_value > 100000) score += 25;
  else if (signal.open_deal_value > 50000) score += 15;
  else if (signal.open_deal_value > 0) score += 8;

  // DGE score (0-20 points)
  if (signal.dge_score != null) {
    score += Math.min(20, Math.floor(signal.dge_score / 5));
  }

  // Fleet replacement (0-15 points)
  score += Math.min(15, Math.floor(signal.fleet_replacement_score));

  // Seasonal (0-10 points)
  score += Math.min(10, Math.floor(signal.seasonal_score));

  return Math.min(100, score);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const today = new Date().toISOString().split("T")[0];

    // Get all active reps
    const { data: reps, error: repsErr } = await admin
      .from("profiles")
      .select("id, full_name, email, active_workspace_id")
      .eq("is_active", true)
      .in("role", ["rep", "admin", "manager"]);

    if (repsErr) throw repsErr;
    if (!reps || reps.length === 0) {
      return safeJsonOk({ message: "No active reps found", generated: 0 }, origin);
    }

    let totalGenerated = 0;

    for (const rep of reps) {
      // Gather signals for this rep's customers
      // 1. Companies with recent activity or open deals assigned to this rep
      const { data: dealCompanies } = await admin
        .from("crm_deals")
        .select("company_id, amount, dge_score, primary_contact_id, name")
        .eq("owner_id", rep.id)
        .is("closed_at", null)
        .is("deleted_at", null);

      // 2. Recent activity to determine last contact
      const { data: recentActivities } = await admin
        .from("crm_activities")
        .select("company_id, contact_id, occurred_at")
        .eq("owner_id", rep.id)
        .order("occurred_at", { ascending: false })
        .limit(200);

      // Build last-contact map
      const lastContactMap = new Map<string, string>();
      for (const act of recentActivities ?? []) {
        const key = act.company_id;
        if (key && !lastContactMap.has(key)) {
          lastContactMap.set(key, act.occurred_at);
        }
      }

      // Get company names
      const companyIds = [...new Set((dealCompanies ?? []).map((d) => d.company_id).filter(Boolean))];
      const { data: companies } = await admin
        .from("crm_companies")
        .select("id, name")
        .in("id", companyIds.length > 0 ? companyIds : ["00000000-0000-0000-0000-000000000000"]);

      const companyMap = new Map((companies ?? []).map((c) => [c.id, c.name]));

      // Build signals
      const signals: CustomerSignal[] = (dealCompanies ?? []).map((deal) => {
        const lastContact = lastContactMap.get(deal.company_id);
        const lastContactDays = lastContact
          ? Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000)
          : null;

        // Seasonal score based on month
        const month = new Date().getMonth();
        const seasonalScore = [3, 2, 5, 7, 8, 9, 8, 7, 6, 5, 4, 3][month];

        return {
          company_id: deal.company_id,
          contact_id: deal.primary_contact_id ?? null,
          company_name: companyMap.get(deal.company_id) ?? deal.name ?? "Unknown",
          contact_name: null,
          last_contact_days: lastContactDays,
          open_deal_value: deal.amount ?? 0,
          dge_score: deal.dge_score ?? null,
          fleet_replacement_score: 5, // Base score — fleet intelligence integration later
          seasonal_score: seasonalScore,
          distance_km: null, // Requires geocoding — placeholder
          reason: buildReason(lastContactDays, deal.amount, deal.dge_score),
        };
      });

      // Also add companies with no open deals but stale contact
      const staleCompanyIds = [...lastContactMap.entries()]
        .filter(([, date]) => {
          const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
          return days > 14;
        })
        .filter(([id]) => !companyIds.includes(id))
        .map(([id]) => id);

      if (staleCompanyIds.length > 0) {
        const { data: staleCompanies } = await admin
          .from("crm_companies")
          .select("id, name")
          .in("id", staleCompanyIds.slice(0, 20));

        for (const company of staleCompanies ?? []) {
          const lastContact = lastContactMap.get(company.id);
          const lastContactDays = lastContact
            ? Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000)
            : null;

          signals.push({
            company_id: company.id,
            contact_id: null,
            company_name: company.name ?? "Unknown",
            contact_name: null,
            last_contact_days: lastContactDays,
            open_deal_value: 0,
            dge_score: null,
            fleet_replacement_score: 3,
            seasonal_score: 4,
            distance_km: null,
            reason: `${lastContactDays ?? "No"} days since last contact — follow up recommended`,
          });
        }
      }

      // Score and rank
      const scored = signals
        .map((s) => ({ ...s, priority_score: computePriorityScore(s) }))
        .sort((a, b) => b.priority_score - a.priority_score)
        .slice(0, MAX_RECOMMENDATIONS);

      // Upsert the visit list for today
      const { error: upsertErr } = await admin
        .from("predictive_visit_lists")
        .upsert(
          {
            rep_id: rep.id,
            list_date: today,
            recommendations: scored,
            visits_total: scored.length,
            visits_completed: 0,
            generated_at: new Date().toISOString(),
            generation_model: "rule-based-v1",
          },
          { onConflict: "rep_id,list_date" },
        );

      if (upsertErr) {
        console.error(`[predictive-visit-generator] upsert failed for rep ${rep.id}:`, upsertErr.message);
        continue;
      }

      totalGenerated++;
    }

    return safeJsonOk({
      success: true,
      generated: totalGenerated,
      date: today,
      message: `Generated visit lists for ${totalGenerated} reps`,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "predictive-visit-generator", req });
    console.error("[predictive-visit-generator] error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});

function buildReason(lastContactDays: number | null, dealAmount: number | null, dgeScore: number | null): string {
  const parts: string[] = [];
  if (lastContactDays != null && lastContactDays > 14) {
    parts.push(`${lastContactDays}d since contact`);
  }
  if (dealAmount != null && dealAmount > 0) {
    parts.push(`$${(dealAmount / 1000).toFixed(0)}k open deal`);
  }
  if (dgeScore != null && dgeScore > 50) {
    parts.push("high DGE score");
  }
  return parts.length > 0 ? parts.join(" — ") : "Recommended visit";
}
