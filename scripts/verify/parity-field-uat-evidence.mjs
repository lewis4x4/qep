#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import xlsx from "xlsx";

const repoRoot = resolve(import.meta.dir, "..", "..");
const DEFAULT_WORKBOOK = resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx");
const DEFAULT_LEDGER = resolve(
  repoRoot,
  "docs/IntelliDealer/_Manifests/QEP_D1_1_PARTIAL_ROW_FIELD_UAT_EVIDENCE_LEDGER_2026-05-21.md",
);
const REQUIRED_SERVICE_MOBILE_ARTIFACTS = [
  "QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md",
  "QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md",
  "QEP-Phase-4-Service-Mobile-UAT-Operator-Guide-20260422.md",
  "QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md",
];

const args = parseArgs(process.argv.slice(2));
const workbookPath = resolve(process.cwd(), args.workbook ?? DEFAULT_WORKBOOK);
const ledgerPath = resolve(process.cwd(), args.ledger ?? DEFAULT_LEDGER);
const checks = [];

const workbook = loadWorkbook(workbookPath);
const ledger = loadText(ledgerPath);
const partialRows = workbook ? extractPartialRows(workbook) : [];

if (ledger) {
  addCheck("ledger declares D1.1/QEP-86", ledger.includes("D1.1") && ledger.includes("QEP-86"), ledgerPath);
  addCheck(
    "ledger preserves no-promotion guardrail",
    /no workbook status promotion/i.test(ledger) && /remain[s]? `?PARTIAL`?/i.test(ledger),
    "ledger must not imply closure before signed/live evidence",
  );

  for (const artifact of REQUIRED_SERVICE_MOBILE_ARTIFACTS) {
    const artifactPath = resolve(repoRoot, "docs/IntelliDealer/_Manifests", artifact);
    addCheck(`service mobile artifact exists: ${artifact}`, existsSync(artifactPath), artifactPath);
    addCheck(`ledger cites service mobile artifact: ${artifact}`, ledger.includes(artifact), artifact);
  }

  for (const row of partialRows) {
    const token = `${row.sheet}!${row.row_number}`;
    addCheck(`ledger covers partial row ${token}`, ledger.includes(token), `${row.item} (${row.phase})`);
  }
}

const result = {
  verdict: checks.every((check) => check.ok) ? "PASS" : "FAIL",
  generated_at: new Date().toISOString(),
  workbook: workbookPath,
  ledger: ledgerPath,
  partial_row_count: partialRows.length,
  partial_rows: partialRows,
  checks,
  failed: checks.filter((check) => !check.ok),
};

console.log(JSON.stringify(result, null, 2));

if (result.failed.length > 0) {
  process.exitCode = 1;
}

function loadWorkbook(path) {
  if (!existsSync(path)) {
    addCheck("workbook exists", false, path);
    return null;
  }
  addCheck("workbook exists", true, path);
  try {
    const workbook = xlsx.read(readFileSync(path), { type: "buffer", cellDates: false });
    addCheck("workbook opens", true, `${workbook.SheetNames.length} sheets`);
    return workbook;
  } catch (error) {
    addCheck("workbook opens", false, String(error?.message ?? error));
    return null;
  }
}

function loadText(path) {
  if (!existsSync(path)) {
    addCheck("ledger exists", false, path);
    return null;
  }
  addCheck("ledger exists", true, path);
  return readFileSync(path, "utf8");
}

function extractPartialRows(workbook) {
  const rows = [];
  for (const sheet of ["Field Parity Matrix", "Action & Button Parity", "Gap Register"]) {
    const worksheet = workbook.Sheets[sheet];
    if (!worksheet) continue;
    const table = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: false });
    if (table.length < 2) continue;
    const headerRowIndex = findHeaderRowIndex(table);
    if (headerRowIndex === -1) continue;
    const headers = table[headerRowIndex].map(normalizeHeader);
    const statusIndex = findStatusIndex(headers);
    for (let rowIndex = headerRowIndex + 1; rowIndex < table.length; rowIndex += 1) {
      const row = table[rowIndex];
      if (normalizeStatus(row[statusIndex]) !== "PARTIAL") continue;
      const rowObject = objectFromRow(headers, row);
      rows.push({
        sheet,
        row_number: rowIndex + 1,
        phase: pick(rowObject, "phase"),
        screen: pick(rowObject, "intellidealer_screen", "screen_name"),
        item: pick(rowObject, "intellidealer_field", "action_button", "gap_description", "tab_name"),
        qep_target: pick(rowObject, "qep_table", "equivalent_in_qep_os", "qep_target_table_module", "qep_equivalent_route_or_component"),
        notes: pick(rowObject, "migration_gap_notes", "notes", "evidence_review_update", "recommended_action"),
      });
    }
  }
  return rows;
}

function findHeaderRowIndex(table) {
  return table.findIndex((row) => findStatusIndex(row.map(normalizeHeader)) !== -1);
}

function findStatusIndex(headers) {
  return headers.findIndex((header) => header === "parity_status" || header === "current_status");
}

function objectFromRow(headers, row) {
  const output = {};
  for (let index = 0; index < headers.length; index += 1) {
    if (headers[index]) output[headers[index]] = cellText(row[index]);
  }
  return output;
}

function pick(rowObject, ...keys) {
  for (const key of keys) {
    if (rowObject[key]) return rowObject[key];
  }
  return "";
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
