/**
 * QRM Absence Engine Nightly — tenant-scoped absence snapshots per workspace.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 *   Body `workspace` / `workspace_id` is ignored so a forged target cannot
 *   retarget the sweep. Missing active workspace fails closed (403).
 * - Service role (cron / internal): unscoped when no explicit workspace hint;
 *   honors `x-workspace-id` header and/or body `workspace` / `workspace_id`
 *   to narrow to one tenant.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  buildRepAbsence,
  type DealAbsenceRow,
} from "../_shared/qrm-command-center/knowledge-gaps-engine.ts";

export interface AbsenceEngineNightlyBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  iron_role: string | null;
};

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveAbsenceEngineWorkspaceSelection(params: {
  caller: CallerContext;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; mode: "single"; workspaceId: string }
  | { ok: true; mode: "service_unscoped" }
  | { ok: false; status: 401 | 403; message: string } {
  if (!params.caller.isServiceRole) {
    if (!params.caller.userId || !params.caller.role) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    const role = params.caller.role;
    if (role !== "admin" && role !== "manager" && role !== "owner") {
      return {
        ok: false,
        status: 403,
        message: "Absence engine nightly requires manager, owner, or admin role",
      };
    }
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    // Body workspace hints are ignored for JWT callers so a forged target
    // cannot retarget the sweep; active_workspace_id is authoritative.
    return {
      ok: true,
      mode: "single",
      workspaceId: params.caller.workspaceId,
    };
  }

  const headerWorkspaceId = cleanString(params.caller.workspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);
  if (
    headerWorkspaceId && requestedWorkspaceId &&
    headerWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }

  const workspaceId = headerWorkspaceId ?? requestedWorkspaceId;
  if (workspaceId) {
    return { ok: true, mode: "single", workspaceId };
  }
  return { ok: true, mode: "service_unscoped" };
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function discoverWorkspacesFromDeals(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data: workspaceRows, error: workspaceErr } = await admin
    .from("crm_deals")
    .select("workspace_id")
    .is("deleted_at", null)
    .limit(2000);

  if (workspaceErr) {
    throw new Error("Failed to load workspace scope");
  }

  return [...new Set(((workspaceRows ?? []) as Array<{ workspace_id: string | null }>)
    .map((row) => row.workspace_id ?? "default")
    .filter(Boolean))];
}

export async function processAbsenceEngineWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  snapshotDate: string,
): Promise<boolean> {
  const { data: rawDeals, error: dealsErr } = await admin
    .from("crm_deals")
    .select("id, assigned_rep_id, amount, expected_close_on, primary_contact_id, company_id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("closed_at", null)
    .limit(2000);

  if (dealsErr) return false;

  const repIds = [...new Set(((rawDeals ?? []) as Array<Record<string, unknown>>)
    .map((row) => typeof row.assigned_rep_id === "string" ? row.assigned_rep_id : null)
    .filter((value): value is string => Boolean(value)))];

  let profileById = new Map<string, ProfileRow>();
  if (repIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, full_name, iron_role")
      .in("id", repIds);
    profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((row) => [row.id, row]));
  }

  const deals: DealAbsenceRow[] = ((rawDeals ?? []) as Array<Record<string, unknown>>).map((row) => {
    const repId = typeof row.assigned_rep_id === "string" ? row.assigned_rep_id : null;
    const profile = repId ? profileById.get(repId) ?? null : null;
    return {
      id: String(row.id),
      assigned_rep_id: repId,
      amount: typeof row.amount === "number" ? row.amount : null,
      expected_close_on: typeof row.expected_close_on === "string" ? row.expected_close_on : null,
      primary_contact_id: typeof row.primary_contact_id === "string" ? row.primary_contact_id : null,
      company_id: typeof row.company_id === "string" ? row.company_id : null,
      profiles: profile ? { full_name: profile.full_name, iron_role: profile.iron_role } : null,
    };
  });

  const { repAbsence, worstFields } = buildRepAbsence(deals);

  const { data: gapRows } = await admin
    .from("knowledge_gaps")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("resolved", false)
    .limit(1000);

  const { data: runRow, error: runErr } = await admin
    .from("qrm_absence_engine_runs")
    .upsert({
      workspace_id: workspaceId,
      snapshot_date: snapshotDate,
      generated_at: new Date().toISOString(),
      top_gap_count: (gapRows ?? []).length,
      worst_fields: worstFields,
    }, { onConflict: "workspace_id,snapshot_date" })
    .select("id")
    .maybeSingle();

  if (runErr || !runRow?.id) return false;

  await admin
    .from("qrm_absence_engine_rep_snapshots")
    .delete()
    .eq("run_id", runRow.id);

  if (repAbsence.length > 0) {
    await admin
      .from("qrm_absence_engine_rep_snapshots")
      .insert(
        repAbsence.map((row) => ({
          run_id: runRow.id,
          workspace_id: workspaceId,
          snapshot_date: snapshotDate,
          rep_id: row.repId,
          rep_name: row.repName,
          iron_role: row.ironRole,
          deal_count: row.dealCount,
          missing_amount: row.missingAmount,
          missing_close_date: row.missingCloseDate,
          missing_contact: row.missingContact,
          missing_company: row.missingCompany,
          absence_score: row.absenceScore,
        })),
      );
  }

  return true;
}

async function readBody(req: Request): Promise<AbsenceEngineNightlyBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as AbsenceEngineNightlyBody;
}

export interface AbsenceEngineNightlyDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  discoverWorkspacesFromDeals: typeof discoverWorkspacesFromDeals;
  processAbsenceEngineWorkspace: typeof processAbsenceEngineWorkspace;
}

const defaultDependencies: AbsenceEngineNightlyDependencies = {
  createAdminClient,
  resolveCallerContext,
  discoverWorkspacesFromDeals,
  processAbsenceEngineWorkspace,
};

export async function handleAbsenceEngineNightly(
  req: Request,
  overrides: Partial<AbsenceEngineNightlyDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

    const admin = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, admin);
    const body = await readBody(req);
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);

    const workspaceSelection = resolveAbsenceEngineWorkspaceSelection({
      caller,
      requestedWorkspaceId,
    });
    if (!workspaceSelection.ok) {
      return safeJsonError(
        workspaceSelection.message,
        workspaceSelection.status,
        origin,
      );
    }

    const snapshotDate = todayIso();
    let workspacesProcessed = 0;

    if (workspaceSelection.mode === "single") {
      if (await dependencies.processAbsenceEngineWorkspace(
        admin,
        workspaceSelection.workspaceId,
        snapshotDate,
      )) {
        workspacesProcessed = 1;
      }
    } else {
      const workspaceIds = await dependencies.discoverWorkspacesFromDeals(admin);
      for (const workspaceId of workspaceIds) {
        if (await dependencies.processAbsenceEngineWorkspace(
          admin,
          workspaceId,
          snapshotDate,
        )) {
          workspacesProcessed += 1;
        }
      }
    }

    return safeJsonOk({
      ok: true,
      snapshot_date: snapshotDate,
      workspaces_processed: workspacesProcessed,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(err, { fn: "qrm-absence-engine-nightly", req });
    console.error("qrm-absence-engine-nightly error:", err);
    if (err instanceof Error && err.message === "Failed to load workspace scope") {
      return safeJsonError(err.message, 500, origin);
    }
    return safeJsonError("Internal server error", 500, origin);
  }
}
