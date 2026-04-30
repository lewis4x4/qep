#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "./_shared/local-env.mjs";

loadLocalEnv(process.cwd());

const workbook = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : "docs/IntelliDealer/Customer Master.xlsx";
const runId = process.argv.find((arg) => arg.startsWith("--run-id="))?.slice("--run-id=".length);

if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) {
  console.error("Invalid --run-id. Expected a UUID.");
  process.exit(2);
}

const auditResult = spawnSync("python3", ["./scripts/audit-intellidealer-customer-master.py", workbook, "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (auditResult.status !== 0) {
  process.stderr.write(auditResult.stderr || auditResult.stdout);
  process.exit(auditResult.status ?? 1);
}

const audit = JSON.parse(auditResult.stdout);
if (!audit.ok) {
  console.error(JSON.stringify({ verdict: "FAIL", reason: "local workbook audit failed", audit }, null, 2));
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN.");
  process.exit(2);
}

const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  readFileSync("supabase/config.toml", "utf8").match(/^project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];

if (!projectRef) {
  console.error("Missing Supabase project ref.");
  process.exit(2);
}

const runFilter = runId ? `where id = '${runId}'::uuid` : "";
const query = `
select to_jsonb(run_row) as run
from (
  select *
  from public.qrm_intellidealer_customer_import_dashboard
  ${runFilter}
  order by created_at desc
  limit 1
) run_row;
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query }),
});

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

const rows = JSON.parse(text);
const run = rows?.[0]?.run;
if (!run) {
  console.error(JSON.stringify({ verdict: "FAIL", reason: "no production IntelliDealer customer import run found" }, null, 2));
  process.exit(1);
}

const sheetRows = {
  master: audit.sheets.MAST.rows,
  contacts: audit.sheets.CONTACTS.rows,
  contactMemos: audit.sheets["Cust Contact Memos"].rows,
  arAgency: audit.sheets["AR AGENCY"].rows,
  profitability: audit.sheets.PROFITABILITY.rows,
};

const checks = [
  check("run committed", run.status === "committed", run.status),
  check("source file name matches local workbook", run.source_file_name === basename(workbook), `${run.source_file_name} vs ${basename(workbook)}`),
  check("source file hash matches local workbook", run.source_file_hash === audit.sha256, `${shortHash(run.source_file_hash)} vs ${shortHash(audit.sha256)}`),
  check("customer master source count matches", run.master_rows === sheetRows.master, `${run.master_rows} vs ${sheetRows.master}`),
  check("contacts source count matches", run.contact_rows === sheetRows.contacts, `${run.contact_rows} vs ${sheetRows.contacts}`),
  check("contact memo source count matches", run.contact_memo_rows === sheetRows.contactMemos, `${run.contact_memo_rows} vs ${sheetRows.contactMemos}`),
  check("A/R agency source count matches", run.ar_agency_rows === sheetRows.arAgency, `${run.ar_agency_rows} vs ${sheetRows.arAgency}`),
  check("profitability source count matches", run.profitability_rows === sheetRows.profitability, `${run.profitability_rows} vs ${sheetRows.profitability}`),
  check("customer master staged count matches", run.master_stage_count === sheetRows.master, `${run.master_stage_count} vs ${sheetRows.master}`),
  check("contacts staged count matches", run.contacts_stage_count === sheetRows.contacts, `${run.contacts_stage_count} vs ${sheetRows.contacts}`),
  check("contact memo staged count matches", run.contact_memos_stage_count === sheetRows.contactMemos, `${run.contact_memos_stage_count} vs ${sheetRows.contactMemos}`),
  check("A/R agency staged count matches", run.ar_agency_stage_count === sheetRows.arAgency, `${run.ar_agency_stage_count} vs ${sheetRows.arAgency}`),
  check("profitability staged count matches", run.profitability_stage_count === sheetRows.profitability, `${run.profitability_stage_count} vs ${sheetRows.profitability}`),
  check("customer master mapped", run.mapped_master_count === sheetRows.master, `${run.mapped_master_count} vs ${sheetRows.master}`),
  check("contacts mapped", run.mapped_contacts_count === sheetRows.contacts, `${run.mapped_contacts_count} vs ${sheetRows.contacts}`),
  check("A/R agency mapped", run.mapped_ar_agency_count === sheetRows.arAgency, `${run.mapped_ar_agency_count} vs ${sheetRows.arAgency}`),
  check("profitability mapped", run.mapped_profitability_count === sheetRows.profitability, `${run.mapped_profitability_count} vs ${sheetRows.profitability}`),
  check("nonblank memos reconciled", run.contact_memos_nonblank_count === audit.data_profile.nonblank_contact_memos, `${run.contact_memos_nonblank_count} vs ${audit.data_profile.nonblank_contact_memos}`),
  check("no import errors", run.import_errors_count === 0, String(run.import_errors_count)),
  check("raw card rows redacted", run.raw_card_rows_count === 0, String(run.raw_card_rows_count)),
  check("redacted card count matches source non-placeholder cards", run.redacted_card_rows_count === audit.data_profile.ar_non_placeholder_cards, `${run.redacted_card_rows_count} vs ${audit.data_profile.ar_non_placeholder_cards}`),
  check("canonical A/R rows match source", run.canonical_ar_agencies_count === sheetRows.arAgency, `${run.canonical_ar_agencies_count} vs ${sheetRows.arAgency}`),
  check("canonical profitability rows match source", run.canonical_profitability_facts_count === sheetRows.profitability, `${run.canonical_profitability_facts_count} vs ${sheetRows.profitability}`),
];

const failed = checks.filter((item) => !item.ok);
const report = {
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  workbook,
  run_id: run.id,
  source_file_hash: audit.sha256,
  checks,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failed.length === 0 ? 0 : 1);

function check(name, ok, detail) {
  return { name, ok, detail };
}

function shortHash(value) {
  if (!value) return "missing";
  return value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}
