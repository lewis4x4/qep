#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import xlsx from "xlsx";

const repoRoot = resolve(import.meta.dir, "..", "..");
const DEFAULT_REPO_WORKBOOK = resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx");
const DEFAULT_DESKTOP_WORKBOOK = "/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx";
const EXPECTED_SHEETS = [
  "Executive Summary",
  "2026-05-04 Review Evidence",
  "Screen Inventory",
  "Field Parity Matrix",
  "Action & Button Parity",
  "Tab Structure Parity",
  "Phase Build Status",
  "Gap Register",
  "Phase 1 Sprint Actions",
  "QEP Table Catalog",
  "Coverage Legend",
];
const ALLOWED_STATUSES = new Set(["BUILT", "PARTIAL", "GAP", "N_A"]);
const ERROR_TOKENS = ["#REF!", "#VALUE!", "#N/A", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!"];

const args = parseArgs(process.argv.slice(2));
const repoWorkbookPath = resolve(process.cwd(), args.workbook ?? DEFAULT_REPO_WORKBOOK);
const desktopWorkbookPath = args.desktopWorkbook === "none"
  ? null
  : resolve(process.cwd(), args.desktopWorkbook ?? DEFAULT_DESKTOP_WORKBOOK);
const checks = [];

const repoWorkbook = loadWorkbook("repo workbook", repoWorkbookPath);
if (repoWorkbook) {
  verifySheetInventory(repoWorkbook);
  verifyWorkbookCells(repoWorkbook);
  verifyStatusColumns(repoWorkbook);
}

if (desktopWorkbookPath) {
  verifyWorkbookCopyParity(repoWorkbookPath, desktopWorkbookPath);
}

const failed = checks.filter((check) => !check.ok);
const result = {
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  generated_at: new Date().toISOString(),
  repo_workbook: repoWorkbookPath,
  desktop_workbook: desktopWorkbookPath,
  checks,
  failed,
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

function loadWorkbook(label, workbookPath) {
  if (!existsSync(workbookPath)) {
    addCheck(`${label} exists`, false, workbookPath);
    return null;
  }

  addCheck(`${label} exists`, true, workbookPath);

  try {
    const workbook = xlsx.read(readFileSync(workbookPath), { type: "buffer", cellDates: false });
    addCheck(`${label} opens`, true, `${workbook.SheetNames.length} sheets`);
    return workbook;
  } catch (error) {
    addCheck(`${label} opens`, false, String(error?.message ?? error));
    return null;
  }
}

function verifySheetInventory(workbook) {
  const sheetNames = workbook.SheetNames;
  addCheck("expected sheet count", sheetNames.length === EXPECTED_SHEETS.length, `${sheetNames.length}/${EXPECTED_SHEETS.length}`);

  for (const expectedSheet of EXPECTED_SHEETS) {
    addCheck(`sheet exists: ${expectedSheet}`, sheetNames.includes(expectedSheet), expectedSheet);
  }
}

function verifyWorkbookCells(workbook) {
  const errors = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet?.["!ref"]) continue;
    const range = xlsx.utils.decode_range(worksheet["!ref"]);
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const address = xlsx.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[address];
        if (!cell) continue;
        const value = cellText(cell.w ?? cell.v);
        if (cell.t === "e" || ERROR_TOKENS.some((token) => value.includes(token))) {
          errors.push(`${sheetName}!${address}=${value || cell.t}`);
        }
      }
    }
  }

  addCheck("formula/error scan clean", errors.length === 0, errors.length === 0 ? "0 matches" : errors.slice(0, 20).join("; "));
}

function verifyStatusColumns(workbook) {
  const statusCounts = {};
  const invalidStatuses = [];
  const reviewStatuses = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const table = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: false });
    if (table.length < 2) continue;

    const headerRowIndex = findHeaderRowIndex(table);
    if (headerRowIndex === -1) continue;

    const headers = table[headerRowIndex].map(normalizeHeader);
    const statusIndex = findStatusIndex(headers);
    if (statusIndex === -1) continue;

    for (let rowIndex = headerRowIndex + 1; rowIndex < table.length; rowIndex += 1) {
      const status = normalizeStatus(table[rowIndex][statusIndex]);
      if (!status) continue;
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      if (status === "REVIEW") {
        reviewStatuses.push(`${sheetName}!row${rowIndex + 1}`);
      } else if (!ALLOWED_STATUSES.has(status)) {
        invalidStatuses.push(`${sheetName}!row${rowIndex + 1}=${status}`);
      }
    }
  }

  addCheck("no REVIEW statuses", reviewStatuses.length === 0, reviewStatuses.length === 0 ? "0 matches" : reviewStatuses.join("; "));
  addCheck("status values allowed", invalidStatuses.length === 0, invalidStatuses.length === 0 ? JSON.stringify(statusCounts) : invalidStatuses.join("; "));
}

function verifyWorkbookCopyParity(repoPath, desktopPath) {
  const repoExists = existsSync(repoPath);
  const desktopExists = existsSync(desktopPath);

  addCheck("desktop workbook exists", desktopExists, desktopPath);
  if (!repoExists || !desktopExists) return;

  const repoHash = sha256File(repoPath);
  const desktopHash = sha256File(desktopPath);
  const repoSize = statSync(repoPath).size;
  const desktopSize = statSync(desktopPath).size;

  addCheck("repo/desktop workbook SHA-256 match", repoHash === desktopHash, `repo=${repoHash}; desktop=${desktopHash}`);
  addCheck("repo/desktop workbook byte sizes match", repoSize === desktopSize, `repo=${repoSize}; desktop=${desktopSize}`);
}

function findHeaderRowIndex(table) {
  return table.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return findStatusIndex(headers) !== -1;
  });
}

function findStatusIndex(headers) {
  return headers.findIndex((header) => header === "parity_status" || header === "current_status");
}

function normalizeHeader(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeStatus(value) {
  return cellText(value).toUpperCase().replace(/\s+/g, "_");
}

function cellText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    parsed[key] = match[2];
  }
  return parsed;
}
