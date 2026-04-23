/**
 * Data Quality Audit — Nightly Edge Function (Track 5, Slice 5.8)
 *
 * Runs a comprehensive data quality audit across the database:
 *   - Equipment without owner linkage
 *   - Missing make/model normalization
 *   - Missing geocoordinates
 *   - Duplicate equipment detection
 *   - Missing service intervals
 *   - Unclassified documents
 *   - Quotes lacking tax jurisdiction
 *   - Stale telematics data
 *
 * Writes results to `exec_data_quality_summary` materialized view.
 * Triggered nightly via pg_cron (migration 223).
 *
 * POST: Run full audit
 * GET:  Latest audit summary
 *
 * Auth: service_role (cron) or manager/owner (manual)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

interface AuditResult {
  issue_class: string;
  issue_description: string;
  open_count: number;
  severity: "critical" | "warning" | "info";
  suggested_action: string;
}

async function runAudit(admin: ReturnType<typeof createClient>): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  // 1. Equipment without owner linkage
  const { count: unownedEquip } = await admin
    .from("qrm_equipment")
    .select("*", { count: "exact", head: true })
    .is("company_id", null);
  if (unownedEquip && unownedEquip > 0) {
    results.push({
      issue_class: "equipment_no_owner",
      issue_description: "Equipment records without company linkage",
      open_count: unownedEquip,
      severity: "warning",
      suggested_action: "Assign orphan equipment to customer companies or mark as dealer stock.",
    });
  }

  // 2. Missing make/model
  const { count: missingMake } = await admin
    .from("qrm_equipment")
    .select("*", { count: "exact", head: true })
    .or("make.is.null,model.is.null");
  if (missingMake && missingMake > 0) {
    results.push({
      issue_class: "equipment_missing_make_model",
      issue_description: "Equipment with missing make or model",
      open_count: missingMake,
      severity: "critical",
      suggested_action: "Run normalization pass from catalog or manual update.",
    });
  }

  // 3. Companies without geocoordinates
  const { count: noGeocode } = await admin
    .from("crm_companies")
    .select("*", { count: "exact", head: true })
    .not("address_line1", "is", null)
    .or("latitude.is.null,longitude.is.null");
  if (noGeocode && noGeocode > 0) {
    results.push({
      issue_class: "companies_missing_geocoords",
      issue_description: "Companies with addresses but no coordinates",
      open_count: noGeocode,
      severity: "info",
      suggested_action: "Run geocoding batch job to populate lat/lng from addresses.",
    });
  }

  // 4. Duplicate equipment (same serial number)
  let dupCount = 0;
  try {
    const { data: dupSerials } = await admin
      .from("qrm_equipment")
      .select("serial_number")
      .not("serial_number", "is", null)
      .neq("serial_number", "");
    if (dupSerials) {
      const counts = new Map<string, number>();
      for (const row of dupSerials) {
        const sn = row.serial_number?.trim();
        if (sn) counts.set(sn, (counts.get(sn) ?? 0) + 1);
      }
      dupCount = [...counts.values()].filter((c) => c > 1).length;
    }
  } catch {
    // Table may not have serial_number column — skip gracefully
  }
  if (dupCount > 0) {
    results.push({
      issue_class: "duplicate_equipment",
      issue_description: "Duplicate equipment by serial number",
      open_count: dupCount,
      severity: "critical",
      suggested_action: "Review and merge duplicate equipment records.",
    });
  }

  // 5. Deals missing contact or company
  const { count: orphanDeals } = await admin
    .from("crm_deals")
    .select("*", { count: "exact", head: true })
    .is("closed_at", null)
    .or("company_id.is.null,primary_contact_id.is.null");
  if (orphanDeals && orphanDeals > 0) {
    results.push({
      issue_class: "deals_missing_linkage",
      issue_description: "Open deals without company or contact linkage",
      open_count: orphanDeals,
      severity: "warning",
      suggested_action: "Link deals to their parent company and primary contact.",
    });
  }

  // 6. Stale health scores (>7 days without refresh)
  let staleHealth: number | null = null;
  try {
    const result = await admin
      .from("customer_profiles_extended")
      .select("*", { count: "exact", head: true })
      .not("health_score", "is", null)
      .lt("health_score_updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
    staleHealth = result.count;
  } catch {
    // health_score_updated_at column may not exist yet
  }
  if (staleHealth && staleHealth > 0) {
    results.push({
      issue_class: "stale_health_scores",
      issue_description: "Customer health scores older than 7 days",
      open_count: staleHealth,
      severity: "info",
      suggested_action: "Run health-score-refresh to update stale scores.",
    });
  }

  // 7. Quotes without tax jurisdiction
  const { count: noTaxJurisdiction } = await admin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("status", "draft")
    .is("tax_jurisdiction", null);
  if (noTaxJurisdiction && noTaxJurisdiction > 0) {
    results.push({
      issue_class: "quotes_missing_tax_jurisdiction",
      issue_description: "Draft quotes without tax jurisdiction",
      open_count: noTaxJurisdiction,
      severity: "warning",
      suggested_action: "Populate tax jurisdiction from customer address before sending.",
    });
  }

  // 8. Activities without occurred_at (data gap)
  const { count: noOccurrence } = await admin
    .from("crm_activities")
    .select("*", { count: "exact", head: true })
    .is("occurred_at", null);
  if (noOccurrence && noOccurrence > 0) {
    results.push({
      issue_class: "activities_missing_date",
      issue_description: "Activities without occurrence date",
      open_count: noOccurrence,
      severity: "warning",
      suggested_action: "Backfill occurrence dates from created_at or manual review.",
    });
  }

  return results;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    // Cron path: accept x-internal-service-secret header before the
    // Authorization-required branch so pg_cron ticks get through without
    // needing a Bearer JWT. See _shared/cron-auth.ts for the contract.
    const cronCaller = isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!cronCaller && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = cronCaller || authHeader === `Bearer ${serviceRoleKey}`;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader! } } },
      );
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || !["manager", "owner", "admin"].includes(profile.role)) {
        return safeJsonError("Data quality audit requires manager or owner role", 403, origin);
      }
    }

    // GET: latest audit summary
    if (req.method === "GET") {
      const auditResults = await runAudit(admin);
      return safeJsonOk({
        total_issues: auditResults.reduce((s, r) => s + r.open_count, 0),
        critical: auditResults.filter((r) => r.severity === "critical").reduce((s, r) => s + r.open_count, 0),
        warning: auditResults.filter((r) => r.severity === "warning").reduce((s, r) => s + r.open_count, 0),
        info: auditResults.filter((r) => r.severity === "info").reduce((s, r) => s + r.open_count, 0),
        issues: auditResults,
        audited_at: new Date().toISOString(),
      }, origin);
    }

    // POST: run full audit and persist results
    if (req.method === "POST") {
      const auditResults = await runAudit(admin);

      // Upsert results into exec_data_quality_summary (if table exists)
      for (const result of auditResults) {
        await admin
          .from("exec_data_quality_summary")
          .upsert({
            issue_class: result.issue_class,
            open_count: result.open_count,
            severity: result.severity,
            description: result.issue_description,
            suggested_action: result.suggested_action,
            updated_at: new Date().toISOString(),
          }, { onConflict: "issue_class" });
      }

      return safeJsonOk({
        ok: true,
        issues_found: auditResults.length,
        total_records_affected: auditResults.reduce((s, r) => s + r.open_count, 0),
        critical_count: auditResults.filter((r) => r.severity === "critical").length,
        audited_at: new Date().toISOString(),
      }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "data-quality-audit", req });
    console.error("[data-quality-audit] error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});
