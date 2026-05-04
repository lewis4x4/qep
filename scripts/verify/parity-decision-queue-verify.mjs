#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const DEFAULT_QUEUE = resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md");
const PACKET_DIR = resolve(repoRoot, "docs/IntelliDealer/_Manifests");
const ALLOWED_CURRENT_STATUSES = new Set(["GAP", "PARTIAL"]);
const ALLOWED_QUEUE_STATUSES = new Set(["QUEUED", "COMPLETE", "BLOCKED"]);

const args = parseArgs(process.argv.slice(2));
const queuePath = resolve(process.cwd(), args.queue ?? DEFAULT_QUEUE);
const expectedRows = args.expectRows == null ? null : Number(args.expectRows);
const checks = [];

const queueRows = parseQueue(queuePath);
addCheck("decision queue exists", existsSync(queuePath), relative(queuePath));
addCheck("decision queue has rows", queueRows.length > 0, `${queueRows.length} rows`);

if (expectedRows !== null) {
  addCheck("expected decision queue row count", queueRows.length === expectedRows, `${queueRows.length}/${expectedRows}`);
}

for (const row of queueRows) {
  verifyRow(row);
}

const failed = checks.filter((check) => !check.ok);
const result = {
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  generated_at: new Date().toISOString(),
  queue: relative(queuePath),
  row_count: queueRows.length,
  queued_count: queueRows.filter((row) => row.status.toUpperCase() === "QUEUED").length,
  rows: queueRows,
  checks,
  failed,
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

function verifyRow(row) {
  const prefix = `${row.slice}: ${row.workbook_row}`;
  const packetPath = resolve(PACKET_DIR, row.packet);
  const currentStatus = row.current_status.toUpperCase();
  const queueStatus = row.status.toUpperCase();

  addCheck(`${prefix} has workbook row`, row.workbook_row.length > 0, row.workbook_row);
  addCheck(`${prefix} current status allowed`, ALLOWED_CURRENT_STATUSES.has(currentStatus), row.current_status);
  addCheck(`${prefix} queue status allowed`, ALLOWED_QUEUE_STATUSES.has(queueStatus), row.status);
  addCheck(`${prefix} packet exists`, existsSync(packetPath), relative(packetPath));
  addCheck(`${prefix} closure evidence stated`, row.closure_evidence_required.length >= 40, row.closure_evidence_required);
  addCheck(`${prefix} owner requirement stated`, row.assigned_to.length >= 10, row.assigned_to);
  addCheck(`${prefix} target stated`, row.target.length >= 3, row.target);

  if (existsSync(packetPath)) {
    const packetText = readFileSync(packetPath, "utf8");
    addCheck(`${prefix} packet is dated`, packetText.includes("2026-05-04") || packetText.includes("Date:"), row.packet);
    addCheck(`${prefix} packet names closure path`, /decision|evidence|closure|done when|required/i.test(packetText), row.packet);
  }
}

function parseQueue(filePath) {
  if (!existsSync(filePath)) return [];
  const rows = [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("| Slice")) continue;
    if (line.includes("---")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => stripMarkdown(cell));

    if (cells.length < 8 || cells[0] === "Slice") continue;

    rows.push({
      slice: cells[0],
      workbook_row: cells[1],
      current_status: cells[2],
      packet: cells[3],
      closure_evidence_required: cells[4],
      assigned_to: cells[5],
      target: cells[6],
      status: cells[7],
    });
  }

  return rows;
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function relative(filePath) {
  return filePath.startsWith(`${repoRoot}/`) ? filePath.slice(repoRoot.length + 1) : filePath;
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
