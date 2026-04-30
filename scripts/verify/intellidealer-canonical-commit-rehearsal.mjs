#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const PRODUCTION_PROJECT_REF = "iciddijgonywtxoelous";
const DEFAULT_WORKBOOK = "docs/IntelliDealer/Customer Master.xlsx";
const EXPECTED_REDACTED_CARD_ROWS = 347;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const workbook = resolve(repoRoot, args.workbook ?? DEFAULT_WORKBOOK);
const workspace = args.workspace ?? "default";
const batchSize = Number(args.batchSize ?? 100);
const allowProduction = args.allowProduction || process.env.INTELLIDEALER_REHEARSAL_ALLOW_PRODUCTION === "1";

if (!existsSync(workbook)) {
  console.error(JSON.stringify({ verdict: "FAIL", reason: `workbook not found: ${workbook}` }, null, 2));
  process.exit(2);
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  console.error(JSON.stringify({ verdict: "FAIL", reason: "batch size must be an integer from 1 to 500" }, null, 2));
  process.exit(2);
}

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectRef = resolveProjectRef(supabaseUrl);

if (!supabaseUrl || !serviceRoleKey || !accessToken || !projectRef) {
  console.error(JSON.stringify({
    verdict: "FAIL",
    reason: "requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN, and SUPABASE_PROJECT_REF or a Supabase project URL",
  }, null, 2));
  process.exit(2);
}

if (isProductionTarget(projectRef, supabaseUrl) && !allowProduction) {
  console.error(JSON.stringify({
    verdict: "REFUSED",
    reason: "canonical commit rehearsal is blocked against production by default",
    project_ref: projectRef,
    override: "Set INTELLIDEALER_REHEARSAL_ALLOW_PRODUCTION=1 only if you intentionally want to mutate production.",
  }, null, 2));
  process.exit(3);
}

const stageResult = spawnSync("python3", [
  resolve(repoRoot, "scripts/stage-intellidealer-customer-master.py"),
  workbook,
  "--workspace",
  workspace,
  "--commit",
  "--commit-canonical",
  "--batch-size",
  String(batchSize),
], {
  cwd: repoRoot,
  env: process.env,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 20,
});

const stageOutput = `${stageResult.stdout ?? ""}\n${stageResult.stderr ?? ""}`.trim();
const runId = stageOutput.match(/Created staging run ([0-9a-f-]{36})/i)?.[1] ?? null;

if (stageResult.status !== 0 || !runId) {
  console.error(JSON.stringify({
    verdict: "FAIL",
    phase: "stage_and_commit",
    run_id: runId,
    exit_code: stageResult.status,
    output: stageOutput.slice(-8000),
  }, null, 2));
  process.exit(stageResult.status || 1);
}

let verification;
try {
  verification = await verifyCommittedRun(projectRef, accessToken, runId);
} catch (error) {
  console.error(JSON.stringify({
    verdict: "FAIL",
    phase: "verification",
    run_id: runId,
    reason: error instanceof Error ? error.message : "verification failed",
  }, null, 2));
  process.exit(1);
}
const checks = buildChecks(verification, basename(workbook));
const failed = checks.filter((check) => !check.ok);

console.log(JSON.stringify({
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  mode: "canonical_commit_rehearsal",
  project_ref: projectRef,
  production_override: allowProduction,
  run_id: runId,
  workbook,
  batch_size: batchSize,
  checks,
  stage_output_tail: stageOutput.slice(-2000),
}, null, 2));

if (failed.length > 0) process.exit(1);

async function verifyCommittedRun(projectRef, token, runId) {
  const query = `
set statement_timeout = '15min';
select jsonb_build_object(
  'run_status', (
    select status
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'source_file_name', (
    select source_file_name
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'master_rows', (
    select master_rows
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'contact_rows', (
    select contact_rows
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'contact_memo_rows', (
    select contact_memo_rows
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'ar_agency_rows', (
    select ar_agency_rows
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'profitability_rows', (
    select profitability_rows
    from public.qrm_intellidealer_customer_import_runs
    where id = '${runId}'::uuid
  ),
  'master_stage_count', (
    select count(*)
    from public.qrm_intellidealer_customer_master_stage
    where run_id = '${runId}'::uuid
  ),
  'contacts_stage_count', (
    select count(*)
    from public.qrm_intellidealer_customer_contacts_stage
    where run_id = '${runId}'::uuid
  ),
  'contact_memos_stage_count', (
    select count(*)
    from public.qrm_intellidealer_customer_contact_memos_stage
    where run_id = '${runId}'::uuid
  ),
  'ar_agency_stage_count', (
    select count(*)
    from public.qrm_intellidealer_customer_ar_agency_stage
    where run_id = '${runId}'::uuid
  ),
  'profitability_stage_count', (
    select count(*)
    from public.qrm_intellidealer_customer_profitability_stage
    where run_id = '${runId}'::uuid
  ),
  'mapped_master', (
    select count(*)
    from public.qrm_intellidealer_customer_master_stage
    where run_id = '${runId}'::uuid
      and canonical_company_id is not null
  ),
  'mapped_contacts', (
    select count(*)
    from public.qrm_intellidealer_customer_contacts_stage
    where run_id = '${runId}'::uuid
      and canonical_contact_id is not null
  ),
  'mapped_ar_agency', (
    select count(*)
    from public.qrm_intellidealer_customer_ar_agency_stage
    where run_id = '${runId}'::uuid
      and canonical_company_id is not null
      and canonical_agency_id is not null
  ),
  'mapped_profitability', (
    select count(*)
    from public.qrm_intellidealer_customer_profitability_stage
    where run_id = '${runId}'::uuid
      and canonical_company_id is not null
  ),
  'nonblank_memos', (
    select count(*)
    from public.qrm_intellidealer_customer_contact_memos_stage
    where run_id = '${runId}'::uuid
      and nullif(memo, '') is not null
  ),
  'canonical_memos_matching_stage', (
    select count(*)
    from public.qrm_company_memos memo
    where memo.deleted_at is null
      and exists (
        select 1
        from public.qrm_intellidealer_customer_contact_memos_stage s
        join public.qrm_intellidealer_customer_master_stage m
          on m.run_id = s.run_id
         and m.company_code = s.company_code
         and m.division_code = s.division_code
         and m.customer_number = s.customer_number
        where s.run_id = '${runId}'::uuid
          and m.canonical_company_id = memo.company_id
          and s.memo = memo.body
      )
  ),
  'canonical_ar_agencies_matching_stage', (
    select count(*)
    from public.qrm_customer_ar_agencies agency
    where agency.deleted_at is null
      and exists (
        select 1
        from public.qrm_intellidealer_customer_ar_agency_stage s
        join public.qrm_intellidealer_customer_master_stage m
          on m.run_id = s.run_id
         and m.company_code = s.company_code
         and m.division_code = s.division_code
         and m.customer_number = s.customer_number
        where s.run_id = '${runId}'::uuid
          and m.canonical_company_id = agency.company_id
          and s.agency_code = agency.agency_code
      )
  ),
  'canonical_profitability_matching_stage', (
    select count(*)
    from public.qrm_customer_profitability_import_facts fact
    where fact.deleted_at is null
      and exists (
        select 1
        from public.qrm_intellidealer_customer_profitability_stage s
        join public.qrm_intellidealer_customer_master_stage m
          on m.run_id = s.run_id
         and m.company_code = s.company_code
         and m.division_code = s.division_code
         and m.customer_number = s.customer_number
        where s.run_id = '${runId}'::uuid
          and m.canonical_company_id = fact.company_id
          and s.area_code = fact.area_code
      )
  ),
  'raw_card_rows_matching_stage', (
    select count(*)
    from public.qrm_customer_ar_agencies agency
    where agency.deleted_at is null
      and agency.card_number is not null
      and agency.card_number !~* '^REDACTED:'
      and agency.card_number !~ '^[*?xX-]+$'
      and exists (
        select 1
        from public.qrm_intellidealer_customer_ar_agency_stage s
        join public.qrm_intellidealer_customer_master_stage m
          on m.run_id = s.run_id
         and m.company_code = s.company_code
         and m.division_code = s.division_code
         and m.customer_number = s.customer_number
        where s.run_id = '${runId}'::uuid
          and m.canonical_company_id = agency.company_id
          and s.agency_code = agency.agency_code
      )
  ),
  'redacted_card_rows_matching_stage', (
    select count(*)
    from public.qrm_customer_ar_agencies agency
    where agency.deleted_at is null
      and agency.card_number ~* '^REDACTED:'
      and exists (
        select 1
        from public.qrm_intellidealer_customer_ar_agency_stage s
        join public.qrm_intellidealer_customer_master_stage m
          on m.run_id = s.run_id
         and m.company_code = s.company_code
         and m.division_code = s.division_code
         and m.customer_number = s.customer_number
        where s.run_id = '${runId}'::uuid
          and m.canonical_company_id = agency.company_id
          and s.agency_code = agency.agency_code
      )
  ),
  'import_errors', (
    select count(*)
    from public.qrm_intellidealer_customer_import_errors
    where run_id = '${runId}'::uuid
  )
) as verification;
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
    throw new Error(`verification query failed: HTTP ${response.status} ${text}`);
  }
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.message) {
    throw new Error(parsed.message);
  }
  const verification = Array.isArray(parsed) ? parsed[0]?.verification : null;
  if (!verification || typeof verification !== "object") {
    throw new Error(`verification query returned unexpected payload: ${text.slice(0, 1000)}`);
  }
  return verification;
}

function buildChecks(v, workbookName) {
  return [
    check("run committed", v.run_status === "committed", String(v.run_status)),
    check("source file name matches workbook", v.source_file_name === workbookName, `${v.source_file_name} vs ${workbookName}`),
    check("customer master staged count matches source", Number(v.master_stage_count) === Number(v.master_rows), `${v.master_stage_count} vs ${v.master_rows}`),
    check("contacts staged count matches source", Number(v.contacts_stage_count) === Number(v.contact_rows), `${v.contacts_stage_count} vs ${v.contact_rows}`),
    check("contact memos staged count matches source", Number(v.contact_memos_stage_count) === Number(v.contact_memo_rows), `${v.contact_memos_stage_count} vs ${v.contact_memo_rows}`),
    check("A/R agencies staged count matches source", Number(v.ar_agency_stage_count) === Number(v.ar_agency_rows), `${v.ar_agency_stage_count} vs ${v.ar_agency_rows}`),
    check("profitability staged count matches source", Number(v.profitability_stage_count) === Number(v.profitability_rows), `${v.profitability_stage_count} vs ${v.profitability_rows}`),
    check("customer master mapped", Number(v.mapped_master) === Number(v.master_rows), `${v.mapped_master} vs ${v.master_rows}`),
    check("contacts mapped", Number(v.mapped_contacts) === Number(v.contact_rows), `${v.mapped_contacts} vs ${v.contact_rows}`),
    check("A/R agencies mapped", Number(v.mapped_ar_agency) === Number(v.ar_agency_rows), `${v.mapped_ar_agency} vs ${v.ar_agency_rows}`),
    check("profitability mapped", Number(v.mapped_profitability) === Number(v.profitability_rows), `${v.mapped_profitability} vs ${v.profitability_rows}`),
    check("nonblank memos reconciled", Number(v.canonical_memos_matching_stage) === Number(v.nonblank_memos), `${v.canonical_memos_matching_stage} vs ${v.nonblank_memos}`),
    check("canonical A/R rows match stage", Number(v.canonical_ar_agencies_matching_stage) === Number(v.ar_agency_rows), `${v.canonical_ar_agencies_matching_stage} vs ${v.ar_agency_rows}`),
    check("canonical profitability rows match stage", Number(v.canonical_profitability_matching_stage) === Number(v.profitability_rows), `${v.canonical_profitability_matching_stage} vs ${v.profitability_rows}`),
    check("raw card rows redacted", Number(v.raw_card_rows_matching_stage) === 0, String(v.raw_card_rows_matching_stage)),
    check("redacted card count matches source non-placeholder cards", Number(v.redacted_card_rows_matching_stage) === EXPECTED_REDACTED_CARD_ROWS, `${v.redacted_card_rows_matching_stage} vs ${EXPECTED_REDACTED_CARD_ROWS}`),
    check("no import errors", Number(v.import_errors) === 0, String(v.import_errors)),
  ];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--allow-production") parsed.allowProduction = true;
    else if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--batch-size") parsed.batchSize = argv[++index];
    else if (!parsed.workbook) parsed.workbook = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function resolveProjectRef(supabaseUrl) {
  const explicit = process.env.SUPABASE_PROJECT_REF?.trim();
  if (explicit) return explicit;
  if (!supabaseUrl) return null;
  return new URL(supabaseUrl).hostname.split(".")[0] || null;
}

function isProductionTarget(projectRef, supabaseUrl) {
  return projectRef === PRODUCTION_PROJECT_REF || supabaseUrl?.includes(`${PRODUCTION_PROJECT_REF}.supabase.co`);
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function printUsage() {
  console.log(`Usage: bun scripts/verify/intellidealer-canonical-commit-rehearsal.mjs [workbook] [options]

Stages and canonically commits the IntelliDealer customer workbook in a non-production Supabase target, then verifies exact mapping/redaction.

Options:
  --workspace <id>       Workspace id to stage into. Default: default
  --batch-size <n>       Stage insert batch size. Default: 100
  --allow-production     Allow running against the production project. Prefer a non-production clone instead.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_ACCESS_TOKEN
  SUPABASE_PROJECT_REF   Optional when SUPABASE_URL contains the project ref
`);
}
