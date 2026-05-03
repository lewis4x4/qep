// ============================================================
// Parts Intelligence Engine — Import API adapter
// Communicates with parts-bulk-import edge function and
// parts_import_runs / parts_import_conflicts tables.
// ============================================================

import { supabase } from "../../../lib/supabase";
import {
  normalizeCommitImportResult,
  normalizeDashboardStats,
  normalizeImportConflicts,
  normalizeImportPreviewResult,
  normalizeImportRun,
  normalizeResolvedConflictCount,
  type CommitImportResult,
  type ImportPreviewResult,
} from "./import-api-normalizers";

// ── types ──────────────────────────────────────────────────

export type ImportFileType = "partmast" | "vendor_price" | "vendor_contacts" | "unknown";

export type ImportStatus =
  | "pending"
  | "parsing"
  | "previewing"
  | "awaiting_conflicts"
  | "committing"
  | "committed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export interface ImportRun {
  id: string;
  workspace_id: string;
  uploaded_by: string | null;
  source_file_name: string;
  source_file_hash: string;
  source_storage_path: string | null;
  file_type: ImportFileType;
  vendor_id: string | null;
  vendor_code: string | null;
  branch_scope: string | null;
  row_count: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_errored: number;
  rows_conflicted: number;
  status: ImportStatus;
  preview_diff: PreviewDiff | null;
  error_log: Record<string, unknown> | null;
  options: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
}

export interface PreviewDiff {
  stats: PreviewStats;
  plan_meta?: { inserts?: number; updates?: number; conflicts?: number };
}

export interface PreviewStats {
  rows_scanned: number;
  rows_to_insert: number;
  rows_to_update: number;
  rows_unchanged: number;
  rows_errored: number;
  rows_conflicted: number;
  sample_inserts: Array<Record<string, unknown>>;
  sample_updates: Array<{
    key: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changed_fields: string[];
  }>;
  errors: Array<{ row: number; part_number?: string; reason: string }>;
}

export interface ImportConflict {
  id: string;
  run_id: string;
  part_id: string;
  part_number: string;
  field_name: string;
  field_label: string | null;
  current_value: unknown;
  current_set_by: string | null;
  current_set_at: string | null;
  incoming_value: unknown;
  incoming_source: string | null;
  priority: "high" | "normal" | "low";
  resolution: "keep_current" | "take_incoming" | "custom" | null;
  resolution_value: unknown;
  resolved_by: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface DashboardStats {
  total_parts: number;
  total_vendor_prices: number;
  unresolved_conflicts: number;
  high_priority_conflicts: number;
  recent_runs: Array<{
    id: string;
    file_name: string;
    file_type: ImportFileType;
    status: ImportStatus;
    row_count: number;
    rows_inserted: number;
    rows_updated: number;
    rows_conflicted: number;
    started_at: string;
    completed_at: string | null;
  }>;
  branches: string[];
  last_partmast_import: string | null;
}

// ── helpers ────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

async function invokeBulkImport(body: Record<string, unknown>): Promise<unknown> {
  const token = await getAccessToken();
  const { data, error } = await supabase.functions.invoke("parts-bulk-import", {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    const msg =
      error.context instanceof Response
        ? await error.context.text().catch(() => error.message)
        : error.message;
    throw new Error(msg || "parts-bulk-import failed");
  }
  return data;
}

// ── upload to storage ──────────────────────────────────────

export interface UploadedFile {
  storage_path: string;
  source_file_name: string;
  size_bytes: number;
}

export async function uploadImportFile(file: File): Promise<UploadedFile> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("Not authenticated");

  const bucket = "parts-imports";
  const uuid = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${Date.now()}-${uuid}-${safeName}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType:
      file.name.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/octet-stream",
  });
  if (error) throw new Error(`upload failed: ${error.message}`);

  return {
    storage_path: `${bucket}/${path}`,
    source_file_name: file.name,
    size_bytes: file.size,
  };
}

// ── edge fn actions ────────────────────────────────────────

export async function startImportPreview(input: {
  storage_path: string;
  source_file_name: string;
  file_type_hint?: ImportFileType;
  vendor_id?: string | null;
  vendor_code?: string | null;
  branch_scope?: string | null;
  effective_date?: string | null;
}): Promise<ImportPreviewResult> {
  const result = normalizeImportPreviewResult(await invokeBulkImport({ action: "preview", ...input }));
  if (!result) throw new Error("parts-bulk-import preview: malformed response");
  return result;
}

export async function commitImportRun(runId: string): Promise<CommitImportResult> {
  const result = normalizeCommitImportResult(await invokeBulkImport({ action: "commit", run_id: runId }));
  if (!result) throw new Error("parts-bulk-import commit: malformed response");
  return result;
}

export async function cancelImportRun(runId: string): Promise<void> {
  await invokeBulkImport({ action: "cancel", run_id: runId });
}

// ── direct reads via RLS ───────────────────────────────────

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc("parts_import_dashboard_stats", {
    p_workspace: null,
  });
  if (error) throw error;
  return normalizeDashboardStats(data);
}

export async function fetchImportRun(runId: string): Promise<ImportRun> {
  const { data, error } = await supabase
    .from("parts_import_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error || !data) throw error ?? new Error("run not found");
  const run = normalizeImportRun(data);
  if (!run) throw new Error("parts_import_runs: malformed run response");
  return run;
}

export async function fetchRunConflicts(runId: string): Promise<ImportConflict[]> {
  const { data, error } = await supabase
    .from("parts_import_conflicts")
    .select("*")
    .eq("run_id", runId)
    .order("priority", { ascending: true })
    .order("field_name", { ascending: true });
  if (error) throw error;
  return normalizeImportConflicts(data);
}

export async function resolveConflict(input: {
  conflict_id: string;
  resolution: "keep_current" | "take_incoming" | "custom";
  resolution_value?: unknown;
  notes?: string;
}): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const patch: Record<string, unknown> = {
    resolution: input.resolution,
    resolution_value: input.resolution_value ?? null,
    resolved_by: session?.user.id,
    resolved_at: new Date().toISOString(),
  };
  if (input.notes) patch.notes = input.notes;
  const { error } = await supabase
    .from("parts_import_conflicts")
    .update(patch)
    .eq("id", input.conflict_id);
  if (error) throw error;
}

export async function resolveBulkConflicts(input: {
  run_id: string;
  field_names: string[];
  resolution: "keep_current" | "take_incoming" | "custom";
  notes?: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc("resolve_parts_import_conflicts_bulk", {
    p_run_id: input.run_id,
    p_field_names: input.field_names,
    p_resolution: input.resolution,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return normalizeResolvedConflictCount(data);
}
