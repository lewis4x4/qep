/**
 * Data Quality Audit — workspace-scoped manual reads, global nightly writes.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always audits the caller's active workspace only.
 *   Body `workspace` / `workspace_id` is ignored so a forged target cannot widen
 *   scope. Missing active workspace fails closed (403). JWT POST does not persist
 *   to exec_data_quality_summary because that table is keyed by issue_class only.
 * - Service role (cron / internal): audits all workspaces when no workspace hint
 *   is provided. Optional `x-workspace-id`, body `workspace` / `workspace_id`, or
 *   `?workspace_id=` narrows the pass to one shop. Unscoped POST persists the
 *   nightly global summary; scoped POST returns counts only.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

export interface AuditResult {
  issue_class: string;
  issue_description: string;
  open_count: number;
  severity: "critical" | "warning" | "info";
  suggested_action: string;
}

export type AuditScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

export interface DataQualityAuditBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveDataQualityAuditScope(params: {
  isServiceRole: boolean;
  callerWorkspaceId: string | null;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; scope: AuditScope }
  | { ok: false; status: 403; message: string } {
  const callerWorkspaceId = cleanString(params.callerWorkspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);

  if (!params.isServiceRole) {
    if (!callerWorkspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    return { ok: true, scope: { mode: "workspace", workspaceId: callerWorkspaceId } };
  }

  const workspaceId = requestedWorkspaceId ?? callerWorkspaceId;
  if (workspaceId) {
    return {
      ok: true,
      scope: { mode: "workspace", workspaceId },
    };
  }
  return { ok: true, scope: { mode: "all" } };
}

function applyWorkspaceEq<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  scope: AuditScope,
  column = "workspace_id",
): T {
  if (scope.mode === "workspace") {
    return query.eq(column, scope.workspaceId);
  }
  return query;
}

async function readBody(req: Request): Promise<DataQualityAuditBody> {
  if (req.method === "GET") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as DataQualityAuditBody;
}

// deno-lint-ignore no-explicit-any
export async function runAudit(
  admin: SupabaseClient<any>,
  scope: AuditScope,
): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  let unownedEquipQuery = admin
    .from("qrm_equipment")
    .select("*", { count: "exact", head: true })
    .is("company_id", null);
  unownedEquipQuery = applyWorkspaceEq(unownedEquipQuery, scope);
  const { count: unownedEquip } = await unownedEquipQuery;
  if (unownedEquip && unownedEquip > 0) {
    results.push({
      issue_class: "equipment_no_owner",
      issue_description: "Equipment records without company linkage",
      open_count: unownedEquip,
      severity: "warning",
      suggested_action:
        "Assign orphan equipment to customer companies or mark as dealer stock.",
    });
  }

  let missingMakeQuery = admin
    .from("qrm_equipment")
    .select("*", { count: "exact", head: true })
    .or("make.is.null,model.is.null");
  missingMakeQuery = applyWorkspaceEq(missingMakeQuery, scope);
  const { count: missingMake } = await missingMakeQuery;
  if (missingMake && missingMake > 0) {
    results.push({
      issue_class: "equipment_missing_make_model",
      issue_description: "Equipment with missing make or model",
      open_count: missingMake,
      severity: "critical",
      suggested_action: "Run normalization pass from catalog or manual update.",
    });
  }

  let noGeocodeQuery = admin
    .from("crm_companies")
    .select("*", { count: "exact", head: true })
    .not("address_line1", "is", null)
    .or("latitude.is.null,longitude.is.null");
  noGeocodeQuery = applyWorkspaceEq(noGeocodeQuery, scope);
  const { count: noGeocode } = await noGeocodeQuery;
  if (noGeocode && noGeocode > 0) {
    results.push({
      issue_class: "companies_missing_geocoords",
      issue_description: "Companies with addresses but no coordinates",
      open_count: noGeocode,
      severity: "info",
      suggested_action:
        "Run geocoding batch job to populate lat/lng from addresses.",
    });
  }

  let dupCount = 0;
  try {
    let dupSerialsQuery = admin
      .from("qrm_equipment")
      .select("serial_number")
      .not("serial_number", "is", null)
      .neq("serial_number", "");
    dupSerialsQuery = applyWorkspaceEq(dupSerialsQuery, scope);
    const { data: dupSerials } = await dupSerialsQuery;
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

  let orphanDealsQuery = admin
    .from("crm_deals")
    .select("*", { count: "exact", head: true })
    .is("closed_at", null)
    .or("company_id.is.null,primary_contact_id.is.null");
  orphanDealsQuery = applyWorkspaceEq(orphanDealsQuery, scope);
  const { count: orphanDeals } = await orphanDealsQuery;
  if (orphanDeals && orphanDeals > 0) {
    results.push({
      issue_class: "deals_missing_linkage",
      issue_description: "Open deals without company or contact linkage",
      open_count: orphanDeals,
      severity: "warning",
      suggested_action: "Link deals to their parent company and primary contact.",
    });
  }

  let unlinkedPortalQuery = admin
    .from("portal_customers")
    .select("*", { count: "exact", head: true })
    .is("crm_company_id", null);
  unlinkedPortalQuery = applyWorkspaceEq(unlinkedPortalQuery, scope);
  const { count: unlinkedPortal } = await unlinkedPortalQuery;
  if (unlinkedPortal && unlinkedPortal > 0) {
    results.push({
      issue_class: "portal_identities_unlinked",
      issue_description: "Portal identities without a company anchor",
      open_count: unlinkedPortal,
      severity: "warning",
      suggested_action:
        "Link each portal identity to its CRM company (crm_company_id) so fleet, parts, and rental activity roll up to the account.",
    });
  }

  let staleHealth: number | null = null;
  try {
    let staleHealthQuery = admin
      .from("customer_profiles_extended")
      .select("id, crm_companies!inner(workspace_id)", {
        count: "exact",
        head: true,
      })
      .not("health_score", "is", null)
      .lt(
        "health_score_updated_at",
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
      );
    if (scope.mode === "workspace") {
      staleHealthQuery = staleHealthQuery.eq(
        "crm_companies.workspace_id",
        scope.workspaceId,
      );
    }
    const result = await staleHealthQuery;
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

  let noTaxJurisdictionQuery = admin
    .from("quotes")
    .select("*", { count: "exact", head: true })
    .eq("status", "draft")
    .is("tax_jurisdiction", null);
  noTaxJurisdictionQuery = applyWorkspaceEq(noTaxJurisdictionQuery, scope);
  const { count: noTaxJurisdiction } = await noTaxJurisdictionQuery;
  if (noTaxJurisdiction && noTaxJurisdiction > 0) {
    results.push({
      issue_class: "quotes_missing_tax_jurisdiction",
      issue_description: "Draft quotes without tax jurisdiction",
      open_count: noTaxJurisdiction,
      severity: "warning",
      suggested_action:
        "Populate tax jurisdiction from customer address before sending.",
    });
  }

  let noOccurrenceQuery = admin
    .from("crm_activities")
    .select("*", { count: "exact", head: true })
    .is("occurred_at", null);
  noOccurrenceQuery = applyWorkspaceEq(noOccurrenceQuery, scope);
  const { count: noOccurrence } = await noOccurrenceQuery;
  if (noOccurrence && noOccurrence > 0) {
    results.push({
      issue_class: "activities_missing_date",
      issue_description: "Activities without occurrence date",
      open_count: noOccurrence,
      severity: "warning",
      suggested_action:
        "Backfill occurrence dates from created_at or manual review.",
    });
  }

  return results;
}

function summarizeAudit(auditResults: AuditResult[]) {
  return {
    total_issues: auditResults.reduce((s, r) => s + r.open_count, 0),
    critical: auditResults
      .filter((r) => r.severity === "critical")
      .reduce((s, r) => s + r.open_count, 0),
    warning: auditResults
      .filter((r) => r.severity === "warning")
      .reduce((s, r) => s + r.open_count, 0),
    info: auditResults
      .filter((r) => r.severity === "info")
      .reduce((s, r) => s + r.open_count, 0),
    issues: auditResults,
    audited_at: new Date().toISOString(),
  };
}

// deno-lint-ignore no-explicit-any
async function persistGlobalAuditSummary(
  admin: SupabaseClient<any>,
  auditResults: AuditResult[],
): Promise<void> {
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
}

export interface DataQualityAuditDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
}

const defaultDependencies: DataQualityAuditDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
};

export async function handleDataQualityAudit(
  req: Request,
  overrides: Partial<DataQualityAuditDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const isServiceRole = dependencies.isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!isServiceRole && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const admin = dependencies.createAdminClient();

    let caller: CallerContext = {
      authHeader: authHeader ?? null,
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: null,
    };

    if (!isServiceRole) {
      caller = await dependencies.resolveCallerContext(req, admin);
      if (!caller.userId || !caller.role) {
        return safeJsonError("Unauthorized", 401, origin);
      }
      if (caller.role === "rep") {
        return safeJsonError(
          "Data quality audit requires manager or owner role",
          403,
          origin,
        );
      }
      if (!["admin", "manager", "owner"].includes(caller.role)) {
        return safeJsonError("Forbidden", 403, origin);
      }
    } else {
      caller = await dependencies.resolveCallerContext(req, admin);
    }

    const body = await readBody(req);
    const urlWorkspaceId = cleanString(
      new URL(req.url).searchParams.get("workspace_id"),
    );
    const bodyWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);
    const requestedWorkspaceId = isServiceRole
      ? (bodyWorkspaceId ?? urlWorkspaceId)
      : null;

    const scopeSelection = resolveDataQualityAuditScope({
      isServiceRole,
      callerWorkspaceId: caller.workspaceId,
      requestedWorkspaceId,
    });
    if (!scopeSelection.ok) {
      return safeJsonError(
        scopeSelection.message,
        scopeSelection.status,
        origin,
      );
    }
    const scope = scopeSelection.scope;

    if (req.method === "GET") {
      const auditResults = await runAudit(admin, scope);
      return safeJsonOk(summarizeAudit(auditResults), origin);
    }

    if (req.method === "POST") {
      const auditResults = await runAudit(admin, scope);

      if (isServiceRole && scope.mode === "all") {
        await persistGlobalAuditSummary(admin, auditResults);
      }

      return safeJsonOk({
        ok: true,
        issues_found: auditResults.length,
        total_records_affected: auditResults.reduce(
          (s, r) => s + r.open_count,
          0,
        ),
        critical_count: auditResults.filter((r) => r.severity === "critical")
          .length,
        audited_at: new Date().toISOString(),
        persisted: isServiceRole && scope.mode === "all",
      }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(err, { fn: "data-quality-audit", req });
    console.error("[data-quality-audit] error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
}
