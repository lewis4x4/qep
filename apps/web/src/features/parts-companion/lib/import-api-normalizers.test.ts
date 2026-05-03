import { describe, expect, test } from "bun:test";
import {
  normalizeCommitImportResult,
  normalizeDashboardStats,
  normalizeImportConflicts,
  normalizeImportPreviewResult,
  normalizeImportRun,
  normalizePreviewStats,
  normalizeResolvedConflictCount,
} from "./import-api-normalizers";

const previewStats = {
  rows_scanned: "10",
  rows_to_insert: "2",
  rows_to_update: "3",
  rows_unchanged: "4",
  rows_errored: "1",
  rows_conflicted: "5",
  sample_inserts: [{ part_number: "P-100" }, "bad"],
  sample_updates: [
    {
      key: "P-101",
      before: { list_price: 10 },
      after: { list_price: 12 },
      changed_fields: ["list_price", 42],
    },
  ],
  errors: [{ row: "7", part_number: "P-102", reason: "Bad row" }, { row: 8 }],
};

const importRun = {
  id: "run-1",
  workspace_id: "default",
  uploaded_by: "user-1",
  source_file_name: "parts.xlsx",
  source_file_hash: "hash-1",
  source_storage_path: "bucket/path",
  file_type: "partmast",
  vendor_id: "vendor-1",
  vendor_code: "VEND",
  branch_scope: "LOU",
  row_count: "10",
  rows_inserted: "2",
  rows_updated: "3",
  rows_skipped: "1",
  rows_errored: "0",
  rows_conflicted: "4",
  status: "awaiting_conflicts",
  preview_diff: {
    stats: previewStats,
    plan_meta: { inserts: "2", updates: "3", conflicts: "4" },
  },
  error_log: { warnings: [] },
  options: { dry_run: true },
  started_at: "2026-05-03T12:00:00.000Z",
  completed_at: null,
};

describe("parts import API normalizers", () => {
  test("normalizes preview stats", () => {
    expect(normalizePreviewStats(previewStats)).toEqual({
      rows_scanned: 10,
      rows_to_insert: 2,
      rows_to_update: 3,
      rows_unchanged: 4,
      rows_errored: 1,
      rows_conflicted: 5,
      sample_inserts: [{ part_number: "P-100" }],
      sample_updates: [
        {
          key: "P-101",
          before: { list_price: 10 },
          after: { list_price: 12 },
          changed_fields: ["list_price"],
        },
      ],
      errors: [{ row: 7, part_number: "P-102", reason: "Bad row" }],
    });
  });

  test("normalizes import runs and preview responses", () => {
    expect(normalizeImportRun(importRun)).toEqual({
      id: "run-1",
      workspace_id: "default",
      uploaded_by: "user-1",
      source_file_name: "parts.xlsx",
      source_file_hash: "hash-1",
      source_storage_path: "bucket/path",
      file_type: "partmast",
      vendor_id: "vendor-1",
      vendor_code: "VEND",
      branch_scope: "LOU",
      row_count: 10,
      rows_inserted: 2,
      rows_updated: 3,
      rows_skipped: 1,
      rows_errored: 0,
      rows_conflicted: 4,
      status: "awaiting_conflicts",
      preview_diff: {
        stats: normalizePreviewStats(previewStats),
        plan_meta: { inserts: 2, updates: 3, conflicts: 4 },
      },
      error_log: { warnings: [] },
      options: { dry_run: true },
      started_at: "2026-05-03T12:00:00.000Z",
      completed_at: null,
    });

    expect(normalizeImportPreviewResult({
      run_id: "run-1",
      status: "previewing",
      file_type: "vendor_price",
      file_size_bytes: "1234",
      file_hash: "hash-1",
      stats: previewStats,
      duplicate_of: importRun,
    })?.file_size_bytes).toBe(1234);
  });

  test("normalizes dashboard stats and conflicts", () => {
    expect(normalizeDashboardStats({
      total_parts: "100",
      total_vendor_prices: "200",
      unresolved_conflicts: "3",
      high_priority_conflicts: "1",
      recent_runs: [
        {
          id: "run-1",
          file_name: "parts.xlsx",
          file_type: "bad",
          status: "bad",
          row_count: "10",
          rows_inserted: "2",
          rows_updated: "3",
          rows_conflicted: "4",
          started_at: "2026-05-03T12:00:00.000Z",
          completed_at: null,
        },
      ],
      branches: ["LOU", 42],
      last_partmast_import: "2026-05-03T12:00:00.000Z",
    })).toEqual({
      total_parts: 100,
      total_vendor_prices: 200,
      unresolved_conflicts: 3,
      high_priority_conflicts: 1,
      recent_runs: [
        {
          id: "run-1",
          file_name: "parts.xlsx",
          file_type: "unknown",
          status: "pending",
          row_count: 10,
          rows_inserted: 2,
          rows_updated: 3,
          rows_conflicted: 4,
          started_at: "2026-05-03T12:00:00.000Z",
          completed_at: null,
        },
      ],
      branches: ["LOU"],
      last_partmast_import: "2026-05-03T12:00:00.000Z",
    });

    expect(normalizeImportConflicts([
      {
        id: "conflict-1",
        run_id: "run-1",
        part_id: "part-1",
        part_number: "P-100",
        field_name: "list_price",
        field_label: "List Price",
        current_value: "10",
        current_set_by: "user-1",
        current_set_at: "2026-05-02T00:00:00.000Z",
        incoming_value: "12",
        incoming_source: "file",
        priority: "bad",
        resolution: "take_incoming",
        resolution_value: "12",
        resolved_by: "user-2",
        resolved_at: "2026-05-03T00:00:00.000Z",
        notes: "OK",
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "conflict-1",
        run_id: "run-1",
        part_id: "part-1",
        part_number: "P-100",
        field_name: "list_price",
        field_label: "List Price",
        current_value: "10",
        current_set_by: "user-1",
        current_set_at: "2026-05-02T00:00:00.000Z",
        incoming_value: "12",
        incoming_source: "file",
        priority: "normal",
        resolution: "take_incoming",
        resolution_value: "12",
        resolved_by: "user-2",
        resolved_at: "2026-05-03T00:00:00.000Z",
        notes: "OK",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes commit and bulk resolution results", () => {
    expect(normalizeCommitImportResult({
      run_id: "run-1",
      status: "committed",
      rows_inserted: "2",
      rows_updated: "3",
    })).toEqual({
      run_id: "run-1",
      status: "committed",
      rows_inserted: 2,
      rows_updated: 3,
    });
    expect(normalizeResolvedConflictCount("4")).toBe(4);
  });

  test("returns safe empty import defaults for malformed inputs", () => {
    expect(normalizeImportRun(null)).toBeNull();
    expect(normalizeImportConflicts(undefined)).toEqual([]);
    expect(normalizeDashboardStats(null)).toEqual({
      total_parts: 0,
      total_vendor_prices: 0,
      unresolved_conflicts: 0,
      high_priority_conflicts: 0,
      recent_runs: [],
      branches: [],
      last_partmast_import: null,
    });
  });
});
