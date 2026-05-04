#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import xlsx from "xlsx";

const repoRoot = resolve(import.meta.dir, "..", "..");
const DEFAULT_WORKBOOK = resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx");
const OPEN_STATUSES = new Set(["GAP", "PARTIAL"]);

const args = parseArgs(process.argv.slice(2));
const workbookPath = resolve(process.cwd(), args.workbook ?? DEFAULT_WORKBOOK);
const format = args.format ?? "json";
const expectedOpen = args.expectOpen == null ? null : Number(args.expectOpen);

if (!existsSync(workbookPath)) {
  console.error(`Parity workbook not found: ${workbookPath}`);
  process.exit(1);
}

if (!Number.isFinite(expectedOpen) && expectedOpen !== null) {
  console.error(`Invalid --expect-open value: ${args.expectOpen}`);
  process.exit(1);
}

const workbook = xlsx.read(readFileSync(workbookPath), { type: "buffer", cellDates: false });
const rows = extractOpenRows(workbook);
const countsBySheet = countBy(rows, "sheet");
const countsByStatus = countBy(rows, "status");
const result = {
  workbook: workbookPath,
  generated_at: new Date().toISOString(),
  open_statuses: [...OPEN_STATUSES],
  total_open_rows: rows.length,
  counts_by_sheet: countsBySheet,
  counts_by_status: countsByStatus,
  rows,
};

if (format === "json") {
  console.log(JSON.stringify(result, null, 2));
} else if (format === "markdown") {
  console.log(toMarkdown(result));
} else {
  console.error(`Unsupported --format value: ${format}. Use json or markdown.`);
  process.exit(1);
}

if (expectedOpen !== null && rows.length !== expectedOpen) {
  console.error(`Expected ${expectedOpen} open parity rows, found ${rows.length}.`);
  process.exitCode = 1;
}

function extractOpenRows(wb) {
  const extracted = [];

  for (const sheetName of wb.SheetNames) {
    const worksheet = wb.Sheets[sheetName];
    const table = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: false });
    if (table.length < 2) continue;

    const headerRowIndex = findHeaderRowIndex(table);
    if (headerRowIndex === -1) continue;

    const headers = table[headerRowIndex].map(normalizeHeader);
    const statusIndex = findStatusIndex(headers);
    if (statusIndex === -1) continue;

    for (let rowIndex = headerRowIndex + 1; rowIndex < table.length; rowIndex += 1) {
      const row = table[rowIndex];
      const status = normalizeStatus(row[statusIndex]);
      if (!OPEN_STATUSES.has(status)) continue;

      const rowObject = objectFromRow(headers, row);
      extracted.push({
        sheet: sheetName,
        row_number: rowIndex + 1,
        status,
        phase: pick(rowObject, "phase"),
        screen: pick(rowObject, "intellidealer_screen", "screen_name"),
        item: pick(rowObject, "intellidealer_field", "action_button", "gap_description", "tab_name"),
        qep_target: pick(rowObject, "qep_table", "equivalent_in_qep_os", "qep_target_table_module", "qep_equivalent_route_or_component"),
        notes: pick(rowObject, "migration_gap_notes", "notes", "evidence_review_update", "recommended_action"),
      });
    }
  }

  return extracted;
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

function objectFromRow(headers, row) {
  const output = {};
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (!header) continue;
    output[header] = cellText(row[index]);
  }
  return output;
}

function pick(rowObject, ...keys) {
  for (const key of keys) {
    const value = rowObject[key];
    if (value) return value;
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

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "(blank)";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function toMarkdown(result) {
  const lines = [
    "# QEP Parity Open Rows",
    "",
    `Workbook: \`${result.workbook}\``,
    `Generated: ${result.generated_at}`,
    `Total open rows: ${result.total_open_rows}`,
    "",
    "## Counts by Sheet",
    "",
    "| Sheet | Open rows |",
    "| --- | ---: |",
  ];

  for (const [sheet, count] of Object.entries(result.counts_by_sheet)) {
    lines.push(`| ${escapeMarkdown(sheet)} | ${count} |`);
  }

  lines.push("", "## Rows", "", "| Sheet | Row | Status | Phase | Screen | Item |", "| --- | ---: | --- | --- | --- | --- |");
  for (const row of result.rows) {
    lines.push(
      `| ${escapeMarkdown(row.sheet)} | ${row.row_number} | ${row.status} | ${escapeMarkdown(row.phase)} | ${escapeMarkdown(row.screen)} | ${escapeMarkdown(row.item)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function escapeMarkdown(value) {
  return cellText(value).replace(/\|/g, "\\|");
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg === "--markdown") {
      parsed.format = "markdown";
      continue;
    }
    if (arg === "--json") {
      parsed.format = "json";
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    parsed[key] = match[2];
  }
  return parsed;
}
