import type {
  DashboardStats,
  ImportConflict,
  ImportFileType,
  ImportRun,
  ImportStatus,
  PreviewDiff,
  PreviewStats,
} from "./import-api";

export type ImportPreviewResult = {
  run_id: string;
  status: ImportStatus;
  file_type: ImportFileType;
  file_size_bytes: number;
  file_hash: string;
  stats: PreviewStats;
  duplicate_of: ImportRun | null;
};

export type CommitImportResult = {
  run_id: string;
  status: ImportStatus;
  rows_inserted: number;
  rows_updated: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function importFileType(value: unknown): ImportFileType {
  return value === "partmast" || value === "vendor_price" || value === "vendor_contacts" || value === "unknown"
    ? value
    : "unknown";
}

function importStatus(value: unknown): ImportStatus {
  return value === "pending" ||
    value === "parsing" ||
    value === "previewing" ||
    value === "awaiting_conflicts" ||
    value === "committing" ||
    value === "committed" ||
    value === "failed" ||
    value === "rolled_back" ||
    value === "cancelled"
    ? value
    : "pending";
}

function conflictPriority(value: unknown): ImportConflict["priority"] {
  return value === "high" || value === "normal" || value === "low" ? value : "normal";
}

function conflictResolution(value: unknown): ImportConflict["resolution"] {
  return value === "keep_current" || value === "take_incoming" || value === "custom" ? value : null;
}

export function normalizePreviewStats(value: unknown): PreviewStats {
  const record = objectValue(value);
  return {
    rows_scanned: numberValue(record.rows_scanned) ?? 0,
    rows_to_insert: numberValue(record.rows_to_insert) ?? 0,
    rows_to_update: numberValue(record.rows_to_update) ?? 0,
    rows_unchanged: numberValue(record.rows_unchanged) ?? 0,
    rows_errored: numberValue(record.rows_errored) ?? 0,
    rows_conflicted: numberValue(record.rows_conflicted) ?? 0,
    sample_inserts: Array.isArray(record.sample_inserts)
      ? record.sample_inserts.filter(isRecord)
      : [],
    sample_updates: normalizeSampleUpdates(record.sample_updates),
    errors: normalizePreviewErrors(record.errors),
  };
}

function normalizeSampleUpdates(rows: unknown): PreviewStats["sample_updates"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const key = nullableString(value.key);
    if (!key) return null;
    return {
      key,
      before: objectValue(value.before),
      after: objectValue(value.after),
      changed_fields: Array.isArray(value.changed_fields)
        ? value.changed_fields.filter((field): field is string => typeof field === "string")
        : [],
    };
  }).filter((row): row is PreviewStats["sample_updates"][number] => row !== null);
}

function normalizePreviewErrors(rows: unknown): PreviewStats["errors"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const reason = nullableString(value.reason);
    if (!reason) return null;
    return {
      row: numberValue(value.row) ?? 0,
      ...(nullableString(value.part_number) ? { part_number: nullableString(value.part_number) ?? undefined } : {}),
      reason,
    };
  }).filter((row): row is PreviewStats["errors"][number] => row !== null);
}

export function normalizePreviewDiff(value: unknown): PreviewDiff | null {
  if (!isRecord(value)) return null;
  return {
    stats: normalizePreviewStats(value.stats),
    ...(isRecord(value.plan_meta)
      ? { plan_meta: normalizePlanMeta(value.plan_meta) }
      : {}),
  };
}

function normalizePlanMeta(value: unknown): NonNullable<PreviewDiff["plan_meta"]> {
  const record = objectValue(value);
  const inserts = numberValue(record.inserts);
  const updates = numberValue(record.updates);
  const conflicts = numberValue(record.conflicts);
  return {
    ...(inserts !== null ? { inserts } : {}),
    ...(updates !== null ? { updates } : {}),
    ...(conflicts !== null ? { conflicts } : {}),
  };
}

export function normalizeImportRun(value: unknown): ImportRun | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const workspaceId = nullableString(value.workspace_id);
  const sourceFileName = nullableString(value.source_file_name);
  const sourceFileHash = nullableString(value.source_file_hash);
  const startedAt = nullableString(value.started_at);
  if (!id || !workspaceId || !sourceFileName || !sourceFileHash || !startedAt) return null;
  return {
    id,
    workspace_id: workspaceId,
    uploaded_by: nullableString(value.uploaded_by),
    source_file_name: sourceFileName,
    source_file_hash: sourceFileHash,
    source_storage_path: nullableString(value.source_storage_path),
    file_type: importFileType(value.file_type),
    vendor_id: nullableString(value.vendor_id),
    vendor_code: nullableString(value.vendor_code),
    branch_scope: nullableString(value.branch_scope),
    row_count: numberValue(value.row_count) ?? 0,
    rows_inserted: numberValue(value.rows_inserted) ?? 0,
    rows_updated: numberValue(value.rows_updated) ?? 0,
    rows_skipped: numberValue(value.rows_skipped) ?? 0,
    rows_errored: numberValue(value.rows_errored) ?? 0,
    rows_conflicted: numberValue(value.rows_conflicted) ?? 0,
    status: importStatus(value.status),
    preview_diff: normalizePreviewDiff(value.preview_diff),
    error_log: isRecord(value.error_log) ? value.error_log : null,
    options: objectValue(value.options),
    started_at: startedAt,
    completed_at: nullableString(value.completed_at),
  };
}

export function normalizeImportConflicts(rows: unknown): ImportConflict[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeImportConflict).filter((row): row is ImportConflict => row !== null);
}

function normalizeImportConflict(value: unknown): ImportConflict | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const runId = nullableString(value.run_id);
  const partId = nullableString(value.part_id);
  const partNumber = nullableString(value.part_number);
  const fieldName = nullableString(value.field_name);
  const createdAt = nullableString(value.created_at);
  if (!id || !runId || !partId || !partNumber || !fieldName || !createdAt) return null;
  return {
    id,
    run_id: runId,
    part_id: partId,
    part_number: partNumber,
    field_name: fieldName,
    field_label: nullableString(value.field_label),
    current_value: value.current_value,
    current_set_by: nullableString(value.current_set_by),
    current_set_at: nullableString(value.current_set_at),
    incoming_value: value.incoming_value,
    incoming_source: nullableString(value.incoming_source),
    priority: conflictPriority(value.priority),
    resolution: conflictResolution(value.resolution),
    resolution_value: value.resolution_value,
    resolved_by: nullableString(value.resolved_by),
    resolved_at: nullableString(value.resolved_at),
    notes: nullableString(value.notes),
    created_at: createdAt,
  };
}

export function normalizeDashboardStats(value: unknown): DashboardStats {
  const record = objectValue(value);
  return {
    total_parts: numberValue(record.total_parts) ?? 0,
    total_vendor_prices: numberValue(record.total_vendor_prices) ?? 0,
    unresolved_conflicts: numberValue(record.unresolved_conflicts) ?? 0,
    high_priority_conflicts: numberValue(record.high_priority_conflicts) ?? 0,
    recent_runs: normalizeDashboardRuns(record.recent_runs),
    branches: Array.isArray(record.branches)
      ? record.branches.filter((branch): branch is string => typeof branch === "string")
      : [],
    last_partmast_import: nullableString(record.last_partmast_import),
  };
}

function normalizeDashboardRuns(rows: unknown): DashboardStats["recent_runs"] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const fileName = nullableString(value.file_name);
    const startedAt = nullableString(value.started_at);
    if (!id || !fileName || !startedAt) return null;
    return {
      id,
      file_name: fileName,
      file_type: importFileType(value.file_type),
      status: importStatus(value.status),
      row_count: numberValue(value.row_count) ?? 0,
      rows_inserted: numberValue(value.rows_inserted) ?? 0,
      rows_updated: numberValue(value.rows_updated) ?? 0,
      rows_conflicted: numberValue(value.rows_conflicted) ?? 0,
      started_at: startedAt,
      completed_at: nullableString(value.completed_at),
    };
  }).filter((row): row is DashboardStats["recent_runs"][number] => row !== null);
}

export function normalizeImportPreviewResult(value: unknown): ImportPreviewResult | null {
  if (!isRecord(value)) return null;
  const runId = nullableString(value.run_id);
  const fileHash = nullableString(value.file_hash);
  if (!runId || !fileHash) return null;
  return {
    run_id: runId,
    status: importStatus(value.status),
    file_type: importFileType(value.file_type),
    file_size_bytes: numberValue(value.file_size_bytes) ?? 0,
    file_hash: fileHash,
    stats: normalizePreviewStats(value.stats),
    duplicate_of: normalizeImportRun(value.duplicate_of),
  };
}

export function normalizeCommitImportResult(value: unknown): CommitImportResult | null {
  if (!isRecord(value)) return null;
  const runId = nullableString(value.run_id);
  if (!runId) return null;
  return {
    run_id: runId,
    status: importStatus(value.status),
    rows_inserted: numberValue(value.rows_inserted) ?? 0,
    rows_updated: numberValue(value.rows_updated) ?? 0,
  };
}

export function normalizeResolvedConflictCount(value: unknown): number {
  return numberValue(value) ?? 0;
}
