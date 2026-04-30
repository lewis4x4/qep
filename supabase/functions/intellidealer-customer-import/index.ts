/**
 * IntelliDealer Customer Import admin operations.
 *
 * Actions:
 *   - preview: reads uploaded XLSX from Storage, audits workbook integrity, and
 *              writes an audited/failed import-run ledger row. It does not
 *              populate staging tables or canonical QRM tables.
 *   - status:  returns a run scoped to the caller's workspace.
 *   - cancel:  marks an audited/failed preview run as cancelled.
 *   - commit:  only accepts already staged runs, then delegates to the existing
 *              commit_intellidealer_customer_import RPC.
 *
 * Auth: admin / manager / owner only via requireServiceUser.
 */

import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

type Action = "preview" | "status" | "cancel" | "commit";

interface RequestBody {
  action: Action;
  storage_path?: string;
  source_file_name?: string;
  source_file_hash?: string;
  file_size_bytes?: number;
  audit?: WorkbookAudit;
  run_id?: string;
}

interface SheetAudit {
  name: string;
  expected_rows: number;
  actual_rows: number;
  ok: boolean;
}

interface AuditIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

interface WorkbookAudit {
  ok: boolean;
  sheets: SheetAudit[];
  errors: AuditIssue[];
  warnings: AuditIssue[];
  counts: {
    master_rows: number;
    contact_rows: number;
    contact_memo_rows: number;
    ar_agency_rows: number;
    profitability_rows: number;
  };
  profile: Record<string, unknown>;
}

const REQUIRED_ROLES = new Set(["admin", "manager", "owner"]);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!REQUIRED_ROLES.has(auth.role)) {
      return safeJsonError("IntelliDealer customer import requires admin/manager/owner role", 403, origin);
    }

    const body = (await req.json()) as RequestBody;
    switch (body.action) {
      case "preview":
        return await handlePreview(auth.supabase, auth.workspaceId, auth.userId, body, origin);
      case "status":
        return await handleStatus(auth.supabase, auth.workspaceId, body, origin);
      case "cancel":
        return await handleCancel(auth.supabase, auth.workspaceId, body, origin);
      case "commit":
        return await handleCommit(auth.supabase, auth.workspaceId, body, origin);
      default:
        return safeJsonError(`unknown action: ${(body as { action?: string }).action}`, 400, origin);
    }
  } catch (error) {
    captureEdgeException(error, { fn: "intellidealer-customer-import" });
    return safeJsonError(error instanceof Error ? error.message : "IntelliDealer import failed", 500, origin);
  }
});

async function handlePreview(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.storage_path || !body.source_file_name) {
    return safeJsonError("storage_path and source_file_name required", 400, origin);
  }
  if (!body.storage_path.startsWith("intellidealer-customer-imports/")) {
    return safeJsonError("storage_path must be in intellidealer-customer-imports bucket", 400, origin);
  }
  if (!body.source_file_name.toLowerCase().endsWith(".xlsx")) {
    return safeJsonError("Only .xlsx workbooks are supported", 400, origin);
  }
  if (!body.audit || !body.source_file_hash || typeof body.file_size_bytes !== "number") {
    return safeJsonError("Browser audit, source_file_hash, and file_size_bytes are required for preview", 400, origin);
  }
  if (!/^[a-f0-9]{64}$/i.test(body.source_file_hash)) {
    return safeJsonError("source_file_hash must be a SHA-256 hex digest", 400, origin);
  }

  const audit = body.audit;
  const now = new Date().toISOString();
  const status = audit.ok ? "audited" : "failed";

  const { data: run, error } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .insert({
      workspace_id: workspaceId,
      source_file_name: body.source_file_name,
      source_file_hash: body.source_file_hash.toLowerCase(),
      status,
      master_rows: audit.counts.master_rows,
      contact_rows: audit.counts.contact_rows,
      contact_memo_rows: audit.counts.contact_memo_rows,
      ar_agency_rows: audit.counts.ar_agency_rows,
      profitability_rows: audit.counts.profitability_rows,
      error_count: audit.errors.length,
      warning_count: audit.warnings.length,
      initiated_by: actorId,
      completed_at: now,
      metadata: {
        audit,
        source_storage_path: body.storage_path,
        file_size_bytes: body.file_size_bytes,
        preview_only: true,
        audit_source: "browser_xlsx",
        edge_function: "intellidealer-customer-import",
      },
    })
    .select("id, status, created_at, completed_at")
    .single();

  if (error || !run) {
    return safeJsonError(`failed to create IntelliDealer preview run: ${error?.message ?? "no run"}`, 500, origin);
  }

  return safeJsonOk({
    run_id: run.id,
    status: run.status,
    source_file_hash: body.source_file_hash.toLowerCase(),
    file_size_bytes: body.file_size_bytes,
    created_at: run.created_at,
    completed_at: run.completed_at,
    audit,
  }, origin);
}

async function handleStatus(
  supabase: SupabaseClient,
  workspaceId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);

  const { data, error } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .select("*")
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) return safeJsonError(`failed to load import run: ${error.message}`, 500, origin);
  if (!data) return safeJsonError("import run not found", 404, origin);
  return safeJsonOk({ run: data }, origin);
}

async function handleCancel(
  supabase: SupabaseClient,
  workspaceId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);

  const { data: run, error: loadError } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .select("id, status")
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (loadError) return safeJsonError(`failed to load import run: ${loadError.message}`, 500, origin);
  if (!run) return safeJsonError("import run not found", 404, origin);
  if (!["audited", "failed"].includes(String(run.status))) {
    return safeJsonError("Only audited or failed preview runs can be cancelled", 409, origin);
  }

  const { error } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId);
  if (error) return safeJsonError(`failed to cancel import run: ${error.message}`, 500, origin);
  return safeJsonOk({ run_id: body.run_id, status: "cancelled" }, origin);
}

async function handleCommit(
  supabase: SupabaseClient,
  workspaceId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);

  const { data: run, error: loadError } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .select("id, status")
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (loadError) return safeJsonError(`failed to load import run: ${loadError.message}`, 500, origin);
  if (!run) return safeJsonError("import run not found", 404, origin);
  if (run.status !== "staged") {
    return safeJsonError("Only staged runs can be committed. Uploaded previews are audit-only until browser staging is wired.", 409, origin);
  }

  const { data, error } = await supabase.rpc("commit_intellidealer_customer_import", {
    p_run_id: body.run_id,
  });
  if (error) return safeJsonError(`commit failed: ${error.message}`, 500, origin);
  return safeJsonOk({ run_id: body.run_id, result: data }, origin);
}
