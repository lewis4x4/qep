#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const DEFAULT_QUEUE = resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md");
const DEFAULT_REGISTER = resolve(
  repoRoot,
  "docs/IntelliDealer/_Manifests/QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md",
);
const REQUIRED_ISSUES = ["JAR-103", "JAR-104", "JAR-105", "JAR-106", "JAR-107", "JAR-108", "JAR-109"];
const REQUIRED_SOURCE_PACKAGES = [
  "equipment-reversal-finance-policy",
  "jd-provider-scope-contract-fixtures",
  "bobcat-base-options-fixture",
  "vermeer-base-options-fixture",
  "vesign-provider-contract-webhook-fixtures",
  "tethr-provider-contract-payload-fixtures",
  "service-mobile-field-uat-result",
  "ironguides-contract-feed-fixtures",
];

const args = parseArgs(process.argv.slice(2));
const queuePath = resolve(process.cwd(), args.queue ?? DEFAULT_QUEUE);
const registerPath = resolve(process.cwd(), args.register ?? DEFAULT_REGISTER);
const checks = [];

const queueRows = parseQueue(queuePath);
const register = loadRegister(registerPath);

addCheck("external decision queue exists", existsSync(queuePath), relative(queuePath));
addCheck("external decision queue has seven rows", queueRows.length === 7, `${queueRows.length}/7`);
addCheck("external decision queue issue set matches", sameSet(queueRows.map((row) => row.linear_issue), REQUIRED_ISSUES), queueRows.map((row) => row.linear_issue).join(", "));

if (register) {
  addCheck("register declares D1.2/QEP-87", register.includes("D1.2") && register.includes("QEP-87"), relative(registerPath));
  addCheck(
    "register preserves no-fabrication guardrail",
    /do not fabricate/i.test(register) && /remain[s]? blocked/i.test(register),
    "register must say missing external evidence remains blocked",
  );

  for (const row of queueRows) {
    addCheck(`register covers ${row.linear_issue}`, register.includes(row.linear_issue), row.workbook_row);
    addCheck(`register cites packet ${row.packet}`, register.includes(row.packet), row.linear_issue);
  }

  for (const packageId of REQUIRED_SOURCE_PACKAGES) {
    addCheck(`register covers package ${packageId}`, register.includes(packageId), packageId);
  }
}

const result = {
  verdict: checks.every((check) => check.ok) ? "PASS" : "FAIL",
  generated_at: new Date().toISOString(),
  queue: relative(queuePath),
  register: relative(registerPath),
  required_issues: REQUIRED_ISSUES,
  required_source_packages: REQUIRED_SOURCE_PACKAGES,
  queue_rows: queueRows,
  checks,
  failed: checks.filter((check) => !check.ok),
};

console.log(JSON.stringify(result, null, 2));

if (result.failed.length > 0) process.exitCode = 1;

function loadRegister(path) {
  if (!existsSync(path)) {
    addCheck("source fixture/vendor contract register exists", false, relative(path));
    return null;
  }
  addCheck("source fixture/vendor contract register exists", true, relative(path));
  return readFileSync(path, "utf8");
}

function parseQueue(filePath) {
  if (!existsSync(filePath)) return [];
  const rows = [];
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.startsWith("| Slice") || line.includes("---")) continue;
    const cells = line.split("|").slice(1, -1).map(stripMarkdown);
    if (cells.length < 9 || cells[0] === "Slice") continue;
    rows.push({
      slice: cells[0],
      workbook_row: cells[1],
      current_status: cells[2],
      packet: cells[3],
      closure_evidence_required: cells[4],
      assigned_to: cells[5],
      target: cells[6],
      status: cells[7],
      linear_issue: extractLinearIssue(cells[8]),
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

function extractLinearIssue(value) {
  return String(value ?? "").match(/JAR-\d+/)?.[0] ?? "";
}

function sameSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return actualSet.size === actual.length && expected.every((value) => actualSet.has(value));
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
