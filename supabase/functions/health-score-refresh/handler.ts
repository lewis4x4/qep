import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { refreshCustomerProfileSnapshot } from "../_shared/customer-profile-refresh.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface HealthRefreshBody {
  source?: unknown;
  workspace_id?: unknown;
}

interface HealthProfileRow {
  id: string;
  crm_company_id: string | null;
  health_score: number | null;
  customer_name: string;
  health_score_updated_at: string | null;
}

export interface HealthScoreRefreshDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  refreshCustomerProfileSnapshot: typeof refreshCustomerProfileSnapshot;
}

const defaultDependencies: HealthScoreRefreshDependencies = {
  createAdminClient,
  resolveCallerContext,
  refreshCustomerProfileSnapshot,
};

class HealthScoreRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthScoreRefreshError";
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function assertDatabaseResult(
  error: { message?: string } | null,
  operation: string,
): void {
  if (error) {
    throw new HealthScoreRefreshError(
      `${operation}: ${error.message ?? "database request failed"}`,
    );
  }
}

async function readBody(req: Request): Promise<HealthRefreshBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as HealthRefreshBody;
}

export function resolveHealthScoreWorkspaceSelection(params: {
  caller: CallerContext;
  requestedWorkspaceId: string | null;
  isCron: boolean;
}):
  | { ok: true; mode: "single"; workspaceId: string }
  | { ok: true; mode: "service_cron" }
  | { ok: false; status: 400 | 401 | 403; message: string } {
  if (!params.caller.isServiceRole) {
    if (!params.caller.userId || !params.caller.role) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    if (
      params.requestedWorkspaceId &&
      params.requestedWorkspaceId !== params.caller.workspaceId
    ) {
      return {
        ok: false,
        status: 403,
        message: "The requested workspace is not authorized for this caller",
      };
    }
    return {
      ok: true,
      mode: "single",
      workspaceId: params.caller.workspaceId,
    };
  }

  const serviceWorkspace = params.caller.workspaceId ??
    params.requestedWorkspaceId;
  if (
    params.caller.workspaceId && params.requestedWorkspaceId &&
    params.caller.workspaceId !== params.requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }
  if (serviceWorkspace) {
    return { ok: true, mode: "single", workspaceId: serviceWorkspace };
  }
  if (params.isCron) return { ok: true, mode: "service_cron" };
  return {
    ok: false,
    status: 400,
    message:
      "Service callers must provide a workspace unless running the per-workspace cron sweep",
  };
}

export async function discoverServiceWorkspaces(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await admin.rpc(
    "list_health_score_refresh_workspaces",
  );
  assertDatabaseResult(error, "Health refresh workspace inventory failed");
  const workspaces = new Set<string>();
  for (const item of Array.isArray(data) ? data : []) {
    const workspaceId = cleanString(
      typeof item === "string"
        ? item
        : (item as Record<string, unknown>).workspace_id,
    );
    if (workspaceId) workspaces.add(workspaceId);
  }
  return [...workspaces].sort();
}

async function loadWorkspaceHealthProfiles(
  admin: SupabaseClient,
  workspaceId: string,
  order: "score_desc" | "stale_asc",
  limit: number,
): Promise<HealthProfileRow[]> {
  // customer_profiles_extended predates workspace_id. The service-only RPC
  // applies company/contact tenancy in SQL before returning any candidate.
  const { data, error } = await admin.rpc(
    "list_customer_health_profiles_for_workspace",
    {
      p_workspace_id: workspaceId,
      p_order: order,
      p_limit: limit,
    },
  );
  assertDatabaseResult(error, "Workspace health profile identity read failed");
  const profiles: HealthProfileRow[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = cleanString(row.id);
    const companyId = cleanString(row.crm_company_id);
    if (!id) continue;
    profiles.push({
      id,
      crm_company_id: companyId,
      health_score: (row.health_score as number | null) ?? null,
      customer_name: String(row.customer_name ?? "Unknown customer"),
      health_score_updated_at: (row.health_score_updated_at as string | null) ??
        null,
    });
  }
  return profiles;
}

async function summarizeWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const profiles = (await loadWorkspaceHealthProfiles(
    admin,
    workspaceId,
    "score_desc",
    100,
  ))
    .filter((profile) => profile.health_score !== null)
    .sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0))
    .slice(0, 100);
  const scores = profiles.map((profile) => profile.health_score as number);
  const avg = scores.length > 0
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 0;
  return {
    workspace_id: workspaceId,
    total_scored: scores.length,
    avg_score: Math.round(avg * 10) / 10,
    distribution: {
      excellent: scores.filter((score) => score >= 80).length,
      good: scores.filter((score) => score >= 60 && score < 80).length,
      fair: scores.filter((score) => score >= 40 && score < 60).length,
      at_risk: scores.filter((score) => score < 40).length,
    },
    top_customers: profiles.slice(0, 10).map((profile) => ({
      health_score: profile.health_score,
      customer_name: profile.customer_name,
    })),
  };
}

async function refreshWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  dependencies: HealthScoreRefreshDependencies,
): Promise<Record<string, unknown>> {
  const profiles = (await loadWorkspaceHealthProfiles(
    admin,
    workspaceId,
    "stale_asc",
    200,
  ))
    .sort((a, b) => {
      if (!a.health_score_updated_at) return -1;
      if (!b.health_score_updated_at) return 1;
      return Date.parse(a.health_score_updated_at) -
        Date.parse(b.health_score_updated_at);
    })
    .slice(0, 200);

  let scoresRefreshed = 0;
  let scoresFailed = 0;
  for (const profile of profiles) {
    const { error } = await admin.rpc("compute_customer_health_score", {
      p_customer_profile_id: profile.id,
    });
    if (error) scoresFailed++;
    else scoresRefreshed++;
  }

  const { data: alertCount, error: alertError } = await admin.rpc(
    "generate_cross_department_alerts",
    { p_workspace_id: workspaceId },
  );
  assertDatabaseResult(
    alertError,
    "Workspace cross-department alert generation failed",
  );

  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const [parts, invoices, deals, rentalInvoices] = await Promise.all([
    admin.from("parts_orders").select("crm_company_id").eq(
      "workspace_id",
      workspaceId,
    ).gt("created_at", since).not("crm_company_id", "is", null).limit(500),
    admin.from("customer_invoices").select("crm_company_id").eq(
      "workspace_id",
      workspaceId,
    ).gt("created_at", since).not("crm_company_id", "is", null).limit(500),
    admin.from("crm_deals").select("company_id").eq(
      "workspace_id",
      workspaceId,
    ).gt("updated_at", since).not("company_id", "is", null).limit(500),
    admin.from("rental_invoices").select("rental_contract_id").eq(
      "workspace_id",
      workspaceId,
    ).gt("created_at", since).limit(500),
  ]);
  assertDatabaseResult(parts.error, "Workspace parts activity read failed");
  assertDatabaseResult(
    invoices.error,
    "Workspace invoice activity read failed",
  );
  assertDatabaseResult(deals.error, "Workspace deal activity read failed");
  assertDatabaseResult(
    rentalInvoices.error,
    "Workspace rental invoice activity read failed",
  );

  const activeCompanies = new Set<string>();
  for (const row of parts.data ?? []) {
    const id = cleanString(row.crm_company_id);
    if (id) activeCompanies.add(id);
  }
  for (const row of invoices.data ?? []) {
    const id = cleanString(row.crm_company_id);
    if (id) activeCompanies.add(id);
  }
  for (const row of deals.data ?? []) {
    const id = cleanString(row.company_id);
    if (id) activeCompanies.add(id);
  }

  const contractIds = [
    ...new Set(
      (rentalInvoices.data ?? []).map((row) =>
        cleanString(row.rental_contract_id)
      ).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (contractIds.length > 0) {
    const { data: contracts, error } = await admin
      .from("rental_contracts")
      .select("qrm_company_id")
      .eq("workspace_id", workspaceId)
      .in("id", contractIds)
      .not("qrm_company_id", "is", null);
    assertDatabaseResult(
      error,
      "Workspace rental contract activity read failed",
    );
    for (const row of contracts ?? []) {
      const id = cleanString(row.qrm_company_id);
      if (id) activeCompanies.add(id);
    }
  }

  let dnaRefreshed = 0;
  let dnaFailed = 0;
  if (activeCompanies.size > 0) {
    const companyIds = [...activeCompanies].slice(0, 200);
    const { data: companyScopes, error: companyError } = await admin
      .from("crm_companies")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("id", companyIds)
      .is("deleted_at", null);
    assertDatabaseResult(
      companyError,
      "Workspace active company scope read failed",
    );
    const scopedCompanyIds = (companyScopes ?? []).map((row) =>
      row.id as string
    );
    if (scopedCompanyIds.length > 0) {
      const { data: activeProfiles, error: profileError } = await admin
        .from("customer_profiles_extended")
        .select("id, crm_company_id")
        .in("crm_company_id", scopedCompanyIds)
        .limit(50);
      assertDatabaseResult(
        profileError,
        "Workspace active DNA profile read failed",
      );
      for (const profile of activeProfiles ?? []) {
        try {
          await dependencies.refreshCustomerProfileSnapshot(admin, {
            lookup: { customer_profiles_extended_id: profile.id as string },
            actorRole: "owner",
            actorUserId: null,
            isServiceRole: true,
            workspaceId,
          });
          dnaRefreshed++;
        } catch {
          dnaFailed++;
        }
      }
    }
  }

  return {
    ok: true,
    workspace_id: workspaceId,
    scores_refreshed: scoresRefreshed,
    scores_failed: scoresFailed,
    alerts_generated: alertCount ?? 0,
    dna_refreshed: dnaRefreshed,
    dna_failed: dnaFailed,
  };
}

export async function handleHealthScoreRefresh(
  req: Request,
  overrides: Partial<HealthScoreRefreshDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "GET" && req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const body = await readBody(req);
    const urlWorkspaceId = cleanString(
      new URL(req.url).searchParams.get("workspace_id"),
    );
    const bodyWorkspaceId = cleanString(body.workspace_id);
    if (
      urlWorkspaceId && bodyWorkspaceId && urlWorkspaceId !== bodyWorkspaceId
    ) {
      return safeJsonError("Conflicting workspace targets", 400, origin);
    }

    const admin = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, admin);
    if (
      !caller.isServiceRole &&
      caller.role !== "manager" && caller.role !== "owner"
    ) {
      if (!caller.userId || !caller.role) {
        return safeJsonError("Unauthorized", 401, origin);
      }
      return safeJsonError(
        "Health score refresh requires manager or owner role",
        403,
        origin,
      );
    }

    const selection = resolveHealthScoreWorkspaceSelection({
      caller,
      requestedWorkspaceId: urlWorkspaceId ?? bodyWorkspaceId,
      isCron: req.method === "POST" && cleanString(body.source) === "cron",
    });
    if (!selection.ok) {
      return safeJsonError(selection.message, selection.status, origin);
    }

    const workspaceIds = selection.mode === "single"
      ? [selection.workspaceId]
      : await discoverServiceWorkspaces(admin);
    if (selection.mode === "service_cron" && workspaceIds.length === 0) {
      return safeJsonOk(
        { ok: true, workspaces: [], workspace_count: 0 },
        origin,
      );
    }

    if (selection.mode === "single") {
      const result = req.method === "GET"
        ? await summarizeWorkspace(admin, selection.workspaceId)
        : await refreshWorkspace(
          admin,
          selection.workspaceId,
          dependencies,
        );
      return safeJsonOk(result, origin);
    }

    const results: Array<Record<string, unknown>> = [];
    let failed = 0;
    for (const workspaceId of workspaceIds) {
      try {
        results.push(await refreshWorkspace(admin, workspaceId, dependencies));
      } catch (error) {
        failed++;
        results.push({
          ok: false,
          workspace_id: workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return safeJsonOk(
      {
        ok: failed === 0,
        workspace_count: workspaceIds.length,
        failed_workspace_count: failed,
        workspaces: results,
      },
      origin,
      failed === 0 ? 200 : 500,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(error, { fn: "health-score-refresh", req });
    console.error("health-score-refresh error:", error);
    return safeJsonError("Internal server error", 500, origin);
  }
}
