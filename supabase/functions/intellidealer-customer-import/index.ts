/**
 * IntelliDealer Customer Import admin operations.
 *
 * Actions:
 *   - preview: accepts the browser XLSX audit and writes an audited/failed
 *              import-run ledger row. It does not populate staging tables or
 *              canonical QRM tables.
 *   - init_stage: validates an audited preview run and clears retryable stage rows.
 *   - stage_chunk: inserts browser-mapped stage rows into a whitelisted stage table.
 *   - complete_stage: verifies stage counts and marks the run staged.
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

type Action = "preview" | "init_stage" | "stage_chunk" | "complete_stage" | "status" | "cancel" | "commit";
type StageTableKey = "master" | "contacts" | "memos" | "arAgencies" | "profitability";

interface RequestBody {
  action: Action;
  storage_path?: string;
  source_file_name?: string;
  source_file_hash?: string;
  file_size_bytes?: number;
  audit?: WorkbookAudit;
  run_id?: string;
  table_key?: StageTableKey;
  rows?: Record<string, unknown>[];
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
const MAX_STAGE_ROWS_PER_CHUNK = 500;
const STAGE_TABLES: Record<StageTableKey, string> = {
  master: "qrm_intellidealer_customer_master_stage",
  contacts: "qrm_intellidealer_customer_contacts_stage",
  memos: "qrm_intellidealer_customer_contact_memos_stage",
  arAgencies: "qrm_intellidealer_customer_ar_agency_stage",
  profitability: "qrm_intellidealer_customer_profitability_stage",
};
const STAGE_TABLE_ORDER: StageTableKey[] = ["master", "contacts", "memos", "arAgencies", "profitability"];

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
      case "init_stage":
        return await handleInitStage(auth.supabase, auth.workspaceId, body, origin);
      case "stage_chunk":
        return await handleStageChunk(auth.supabase, auth.workspaceId, body, origin);
      case "complete_stage":
        return await handleCompleteStage(auth.supabase, auth.workspaceId, body, origin);
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

async function handleInitStage(
  supabase: SupabaseClient,
  workspaceId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);

  const loaded = await loadRun(supabase, workspaceId, body.run_id);
  if (loaded.error) return safeJsonError(loaded.error, loaded.status, origin);
  const run = loaded.run;
  if (run.status !== "audited") {
    return safeJsonError(`Only audited preview runs can be staged. Current status is ${run.status}.`, 409, origin);
  }
  if (!isRecord(run.metadata) || run.metadata.preview_only !== true) {
    return safeJsonError("Only browser preview runs can enter browser staging", 409, origin);
  }
  const audit = isRecord(run.metadata.audit) ? run.metadata.audit : null;
  if (audit?.ok !== true) {
    return safeJsonError("Only preview runs with a passing workbook audit can be staged", 409, origin);
  }

  for (const table of Object.values(STAGE_TABLES)) {
    const { error } = await supabase.from(table).delete().eq("run_id", body.run_id).eq("workspace_id", workspaceId);
    if (error) return safeJsonError(`failed to clear ${table}: ${error.message}`, 500, origin);
  }
  const { error: clearError } = await supabase
    .from("qrm_intellidealer_customer_import_errors")
    .delete()
    .eq("run_id", body.run_id)
    .eq("workspace_id", workspaceId);
  if (clearError) return safeJsonError(`failed to clear import errors: ${clearError.message}`, 500, origin);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .update({
      status: "staging",
      completed_at: null,
      error_count: 0,
      metadata: {
        ...run.metadata,
        staging_started_at: now,
        staging_source: "browser_chunked",
      },
    })
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId);
  if (error) return safeJsonError(`failed to start staging: ${error.message}`, 500, origin);

  return safeJsonOk({ run_id: body.run_id, status: "staging", workspace_id: workspaceId }, origin);
}

async function handleStageChunk(
  supabase: SupabaseClient,
  workspaceId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);
  if (!body.table_key || !STAGE_TABLES[body.table_key]) return safeJsonError("valid table_key required", 400, origin);
  if (!Array.isArray(body.rows)) return safeJsonError("rows array required", 400, origin);
  if (body.rows.length > MAX_STAGE_ROWS_PER_CHUNK) {
    return safeJsonError(`stage chunks are limited to ${MAX_STAGE_ROWS_PER_CHUNK} rows`, 413, origin);
  }

  const loaded = await loadRun(supabase, workspaceId, body.run_id);
  if (loaded.error) return safeJsonError(loaded.error, loaded.status, origin);
  if (loaded.run.status !== "staging") {
    return safeJsonError(`Run must be staging before rows can be inserted. Current status is ${loaded.run.status}.`, 409, origin);
  }

  const rows = body.rows.map((row) => {
    const { id: _id, canonical_company_id: _company, canonical_contact_id: _contact, canonical_memo_id: _memo, canonical_agency_id: _agency, staged_at: _staged, ...safeRow } = row;
    return {
      ...safeRow,
      run_id: body.run_id,
      workspace_id: workspaceId,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase.from(STAGE_TABLES[body.table_key]).insert(rows);
    if (error) return safeJsonError(`failed to stage ${body.table_key}: ${error.message}`, 500, origin);
  }

  return safeJsonOk({ run_id: body.run_id, table_key: body.table_key, inserted: rows.length }, origin);
}

async function handleCompleteStage(
  supabase: SupabaseClient,
  workspaceId: string,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);

  const loaded = await loadRun(supabase, workspaceId, body.run_id);
  if (loaded.error) return safeJsonError(loaded.error, loaded.status, origin);
  const run = loaded.run;
  if (run.status !== "staging") {
    return safeJsonError(`Run must be staging before it can be completed. Current status is ${run.status}.`, 409, origin);
  }

  const counts = await countStageRows(supabase, workspaceId, body.run_id);
  if (counts.error) return safeJsonError(counts.error, 500, origin);

  const expected = {
    master: Number(run.master_rows ?? 0),
    contacts: Number(run.contact_rows ?? 0),
    memos: Number(run.contact_memo_rows ?? 0),
    arAgencies: Number(run.ar_agency_rows ?? 0),
    profitability: Number(run.profitability_rows ?? 0),
  };
  const mismatches = STAGE_TABLE_ORDER
    .filter((key) => counts.counts[key] !== expected[key])
    .map((key) => `${key}: expected ${expected[key]}, staged ${counts.counts[key]}`);
  const now = new Date().toISOString();

  if (mismatches.length > 0) {
    const metadata = {
      ...(isRecord(run.metadata) ? run.metadata : {}),
      stage_counts: counts.counts,
      stage_expected_counts: expected,
      stage_completed_at: now,
      stage_error: mismatches.join("; "),
    };
    await supabase.from("qrm_intellidealer_customer_import_errors").insert({
      run_id: body.run_id,
      workspace_id: workspaceId,
      source_sheet: "browser_stage",
      severity: "error",
      reason_code: "stage_count_mismatch",
      message: mismatches.join("; "),
      payload: { expected, actual: counts.counts },
    });
    const { error } = await supabase
      .from("qrm_intellidealer_customer_import_runs")
      .update({ status: "failed", completed_at: now, error_count: mismatches.length, metadata })
      .eq("id", body.run_id)
      .eq("workspace_id", workspaceId);
    if (error) return safeJsonError(`failed to mark staging failed: ${error.message}`, 500, origin);
    return safeJsonError(`Staged row counts do not match preview audit: ${mismatches.join("; ")}`, 409, origin);
  }

  const metadata = {
    ...(isRecord(run.metadata) ? run.metadata : {}),
    preview_only: false,
    stage_counts: counts.counts,
    stage_completed_at: now,
  };
  const { error } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .update({ status: "staged", completed_at: now, metadata })
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId);
  if (error) return safeJsonError(`failed to complete staging: ${error.message}`, 500, origin);

  return safeJsonOk({ run_id: body.run_id, status: "staged", counts: counts.counts }, origin);
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
    .select("id, status, metadata")
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (loadError) return safeJsonError(`failed to load import run: ${loadError.message}`, 500, origin);
  if (!run) return safeJsonError("import run not found", 404, origin);
  if (!["audited", "staging", "failed"].includes(String(run.status)) || !isRecord(run.metadata) || run.metadata.preview_only !== true) {
    return safeJsonError("Only audited, staging, or failed preview runs can be cancelled", 409, origin);
  }
  for (const table of Object.values(STAGE_TABLES)) {
    const { error } = await supabase.from(table).delete().eq("run_id", body.run_id).eq("workspace_id", workspaceId);
    if (error) return safeJsonError(`failed to clear ${table}: ${error.message}`, 500, origin);
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

async function loadRun(
  supabase: SupabaseClient,
  workspaceId: string,
  runId: string,
): Promise<
  | {
    run: {
      id: string;
      status: string;
      workspace_id: string;
      master_rows: number;
      contact_rows: number;
      contact_memo_rows: number;
      ar_agency_rows: number;
      profitability_rows: number;
      metadata: unknown;
    };
    error?: never;
    status?: never;
  }
  | { error: string; status: number; run?: never }
> {
  const { data, error } = await supabase
    .from("qrm_intellidealer_customer_import_runs")
    .select("id, status, workspace_id, master_rows, contact_rows, contact_memo_rows, ar_agency_rows, profitability_rows, metadata")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return { error: `failed to load import run: ${error.message}`, status: 500 };
  if (!data) return { error: "import run not found", status: 404 };
  return { run: data };
}

async function countStageRows(
  supabase: SupabaseClient,
  workspaceId: string,
  runId: string,
): Promise<{ counts: Record<StageTableKey, number>; error?: never } | { error: string; counts?: never }> {
  const counts = {} as Record<StageTableKey, number>;
  for (const key of STAGE_TABLE_ORDER) {
    const { count, error } = await supabase
      .from(STAGE_TABLES[key])
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("workspace_id", workspaceId);
    if (error) return { error: `failed to count ${key}: ${error.message}` };
    counts[key] = count ?? 0;
  }
  return { counts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
