import type { Database } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export const OEM_BASE_OPTIONS_MANUFACTURERS = ["bobcat", "vermeer"] as const;

export type OemBaseOptionsManufacturer = typeof OEM_BASE_OPTIONS_MANUFACTURERS[number];
export type OemBaseOptionsImportPath = "file" | "api";
export type OemBaseOptionsImportStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "unknown";

type EquipmentBaseCodesImportRunRow = Database["public"]["Tables"]["equipment_base_codes_import_runs"]["Row"];

export interface OemBaseOptionsImportRun {
  id: string;
  manufacturer: OemBaseOptionsManufacturer;
  importFormat: string | null;
  sourceFilename: string | null;
  sourceStoragePath: string | null;
  sourceSha256: string | null;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  runStatus: OemBaseOptionsImportStatus;
  error: string | null;
  metadata: EquipmentBaseCodesImportRunRow["metadata"];
  ranAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemBaseOptionsImportEvidence {
  manufacturer: OemBaseOptionsManufacturer;
  path: OemBaseOptionsImportPath;
  authorizedSampleFileProvided?: boolean;
  fileFormatDefinitionProvided?: boolean;
  uploadOwnershipAndRetentionDefined?: boolean;
  invalidRowErrorReportingDefined?: boolean;
  apiContractProvided?: boolean;
  apiCredentialsConfirmed?: boolean;
  pullCadenceAndRetryPolicyDefined?: boolean;
  canonicalPayloadMappingDefined?: boolean;
  staleOrDeactivatedOptionHandlingDefined?: boolean;
  canonicalWriteTargetConfirmed?: boolean;
}

export interface OemBaseOptionsReadinessResult {
  ready: boolean;
  blockers: string[];
}

export const OEM_BASE_OPTIONS_FILE_IMPORT_REQUIREMENTS = [
  "Authorized Bobcat/Vermeer sample file from the OEM catalog/import owner.",
  "File format definition covering base codes, option codes, descriptions, pricing/cost fields, effective dates, supersession behavior, and delete/deactivate semantics.",
  "Upload ownership and storage retention policy.",
  "Invalid-row error reporting requirements.",
  "Confirmed canonical write target: equipment_base_codes, equipment_options, and equipment_base_codes_import_runs.",
] as const;

export const OEM_BASE_OPTIONS_API_IMPORT_REQUIREMENTS = [
  "OEM API contract.",
  "OEM API credentials.",
  "Pull cadence plus retry/error policy.",
  "Provider-payload mapping to canonical equipment_base_codes, equipment_options, and equipment_base_codes_import_runs.",
  "Ownership of stale/deactivated option handling.",
  "Confirmed canonical write target: equipment_base_codes, equipment_options, and equipment_base_codes_import_runs.",
] as const;

export function oemBaseOptionsManufacturerLabel(manufacturer: OemBaseOptionsManufacturer): string {
  return manufacturer === "bobcat" ? "Bobcat" : "Vermeer";
}

export function getOemBaseOptionsImportRequirements(path: OemBaseOptionsImportPath): readonly string[] {
  return path === "file" ? OEM_BASE_OPTIONS_FILE_IMPORT_REQUIREMENTS : OEM_BASE_OPTIONS_API_IMPORT_REQUIREMENTS;
}

export function evaluateOemBaseOptionsImportReadiness(
  evidence: OemBaseOptionsImportEvidence,
): OemBaseOptionsReadinessResult {
  const blockers: string[] = [];
  const label = oemBaseOptionsManufacturerLabel(evidence.manufacturer);

  if (!evidence.canonicalWriteTargetConfirmed) {
    blockers.push(`${label}: canonical table mapping/write target is not confirmed.`);
  }

  if (evidence.path === "file") {
    if (!evidence.authorizedSampleFileProvided) blockers.push(`${label}: authorized sample file is missing.`);
    if (!evidence.fileFormatDefinitionProvided) blockers.push(`${label}: file format definition is missing.`);
    if (!evidence.uploadOwnershipAndRetentionDefined) blockers.push(`${label}: upload ownership and retention policy is undefined.`);
    if (!evidence.invalidRowErrorReportingDefined) blockers.push(`${label}: invalid-row error reporting requirements are undefined.`);
  } else {
    if (!evidence.apiContractProvided) blockers.push(`${label}: OEM API contract is missing.`);
    if (!evidence.apiCredentialsConfirmed) blockers.push(`${label}: API credentials are not confirmed.`);
    if (!evidence.pullCadenceAndRetryPolicyDefined) blockers.push(`${label}: pull cadence and retry/error policy are undefined.`);
    if (!evidence.canonicalPayloadMappingDefined) blockers.push(`${label}: provider payload to canonical table mapping is undefined.`);
    if (!evidence.staleOrDeactivatedOptionHandlingDefined) blockers.push(`${label}: stale/deactivated option handling is undefined.`);
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeManufacturer(value: unknown): OemBaseOptionsManufacturer | null {
  return OEM_BASE_OPTIONS_MANUFACTURERS.includes(value as OemBaseOptionsManufacturer)
    ? value as OemBaseOptionsManufacturer
    : null;
}

function normalizeRunStatus(value: unknown): OemBaseOptionsImportStatus {
  if (value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "cancelled") {
    return value;
  }
  return "unknown";
}

export function normalizeOemBaseOptionsImportRunRows(value: unknown): OemBaseOptionsImportRun[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const manufacturer = normalizeManufacturer(row.manufacturer);
    const ranAt = requiredString(row.ran_at);
    const createdAt = requiredString(row.created_at);
    const updatedAt = requiredString(row.updated_at);
    if (!id || !manufacturer || !ranAt || !createdAt || !updatedAt) return [];

    return [{
      id,
      manufacturer,
      importFormat: nullableString(row.import_format),
      sourceFilename: nullableString(row.source_filename),
      sourceStoragePath: nullableString(row.source_storage_path),
      sourceSha256: nullableString(row.source_sha256),
      rowsInserted: numberOrZero(row.rows_inserted),
      rowsUpdated: numberOrZero(row.rows_updated),
      rowsSkipped: numberOrZero(row.rows_skipped),
      runStatus: normalizeRunStatus(row.run_status),
      error: nullableString(row.error),
      metadata: isRecord(row.metadata) || Array.isArray(row.metadata) ? row.metadata as EquipmentBaseCodesImportRunRow["metadata"] : {},
      ranAt,
      createdAt,
      updatedAt,
    }];
  });
}

export async function listOemBaseOptionsImportRuns(limit = 12): Promise<OemBaseOptionsImportRun[]> {
  const { data, error } = await supabase
    .from("equipment_base_codes_import_runs")
    .select(
      "id, manufacturer, import_format, source_filename, source_storage_path, source_sha256, rows_inserted, rows_updated, rows_skipped, run_status, error, metadata, ran_at, created_at, updated_at",
    )
    .in("manufacturer", [...OEM_BASE_OPTIONS_MANUFACTURERS])
    .order("ran_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return normalizeOemBaseOptionsImportRunRows(data);
}
