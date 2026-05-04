import { describe, expect, test } from "bun:test";

import {
  evaluateOemBaseOptionsImportReadiness,
  getOemBaseOptionsImportRequirements,
  normalizeOemBaseOptionsImportRunRows,
} from "../oem-base-options-import-api";

describe("oem-base-options-import-api", () => {
  test("documents exact file-import requirements without inventing OEM formats", () => {
    expect(getOemBaseOptionsImportRequirements("file")).toEqual([
      "Authorized Bobcat/Vermeer sample file from the OEM catalog/import owner.",
      "File format definition covering base codes, option codes, descriptions, pricing/cost fields, effective dates, supersession behavior, and delete/deactivate semantics.",
      "Upload ownership and storage retention policy.",
      "Invalid-row error reporting requirements.",
      "Confirmed canonical write target: equipment_base_codes, equipment_options, and equipment_base_codes_import_runs.",
    ]);
  });

  test("blocks Bobcat file import readiness until sample, format, policy, errors, and canonical writes are supplied", () => {
    expect(evaluateOemBaseOptionsImportReadiness({ manufacturer: "bobcat", path: "file" })).toEqual({
      ready: false,
      blockers: [
        "Bobcat: canonical table mapping/write target is not confirmed.",
        "Bobcat: authorized sample file is missing.",
        "Bobcat: file format definition is missing.",
        "Bobcat: upload ownership and retention policy is undefined.",
        "Bobcat: invalid-row error reporting requirements are undefined.",
      ],
    });
  });

  test("documents exact API-import requirements without inventing provider contracts", () => {
    expect(getOemBaseOptionsImportRequirements("api")).toEqual([
      "OEM API contract.",
      "OEM API credentials.",
      "Pull cadence plus retry/error policy.",
      "Provider-payload mapping to canonical equipment_base_codes, equipment_options, and equipment_base_codes_import_runs.",
      "Ownership of stale/deactivated option handling.",
      "Confirmed canonical write target: equipment_base_codes, equipment_options, and equipment_base_codes_import_runs.",
    ]);
  });

  test("blocks Vermeer API import readiness until contract, credentials, cadence, mapping, and stale handling exist", () => {
    expect(evaluateOemBaseOptionsImportReadiness({
      manufacturer: "vermeer",
      path: "api",
      canonicalWriteTargetConfirmed: true,
    })).toEqual({
      ready: false,
      blockers: [
        "Vermeer: OEM API contract is missing.",
        "Vermeer: API credentials are not confirmed.",
        "Vermeer: pull cadence and retry/error policy are undefined.",
        "Vermeer: provider payload to canonical table mapping is undefined.",
        "Vermeer: stale/deactivated option handling is undefined.",
      ],
    });
  });

  test("marks a fully evidenced file path ready for parser implementation", () => {
    expect(evaluateOemBaseOptionsImportReadiness({
      manufacturer: "bobcat",
      path: "file",
      authorizedSampleFileProvided: true,
      fileFormatDefinitionProvided: true,
      uploadOwnershipAndRetentionDefined: true,
      invalidRowErrorReportingDefined: true,
      canonicalWriteTargetConfirmed: true,
    })).toEqual({ ready: true, blockers: [] });
  });

  test("normalizes only Bobcat and Vermeer import-run ledger rows", () => {
    expect(normalizeOemBaseOptionsImportRunRows([
      {
        id: "run-1",
        manufacturer: "bobcat",
        import_format: "blocked-fixture-required",
        source_filename: "bobcat-sample.csv",
        source_storage_path: "imports/bobcat-sample.csv",
        source_sha256: "abc",
        rows_inserted: "2",
        rows_updated: 3,
        rows_skipped: "1",
        run_status: "surprise_status",
        error: null,
        metadata: { parser: "fixture-backed" },
        ran_at: "2026-05-04T12:00:00Z",
        created_at: "2026-05-04T12:00:00Z",
        updated_at: "2026-05-04T12:01:00Z",
      },
      {
        id: "run-2",
        manufacturer: "yanmar",
        run_status: "completed",
        ran_at: "2026-05-04T12:00:00Z",
        created_at: "2026-05-04T12:00:00Z",
        updated_at: "2026-05-04T12:01:00Z",
      },
      { id: "bad", manufacturer: "vermeer" },
    ])).toEqual([
      {
        id: "run-1",
        manufacturer: "bobcat",
        importFormat: "blocked-fixture-required",
        sourceFilename: "bobcat-sample.csv",
        sourceStoragePath: "imports/bobcat-sample.csv",
        sourceSha256: "abc",
        rowsInserted: 2,
        rowsUpdated: 3,
        rowsSkipped: 1,
        runStatus: "unknown",
        error: null,
        metadata: { parser: "fixture-backed" },
        ranAt: "2026-05-04T12:00:00Z",
        createdAt: "2026-05-04T12:00:00Z",
        updatedAt: "2026-05-04T12:01:00Z",
      },
    ]);
  });
});
