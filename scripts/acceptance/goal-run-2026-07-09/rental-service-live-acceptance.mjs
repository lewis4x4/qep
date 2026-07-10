#!/usr/bin/env bun
/**
 * Live production acceptance for:
 *   - RB-MULTI-RETURN-MONEY-CORRECTNESS
 *   - RB-BILLING-RUNNER-SCALE
 *   - SP-REPLAN-PO-IDEMPOTENCY
 *
 * Safety contract:
 *   - Dry-run is the default and performs no network requests.
 *   - Mutations require BOTH --execute and
 *     QEP_PRODUCTION_ACCEPTANCE_CONFIRM=iciddijgonywtxoelous.
 *   - The URL/project ref must be the one pinned below.
 *   - Every row is UUID/tag scoped and cleanup runs in finally.
 *   - Secrets are never printed.
 *
 * Usage:
 *   bun scripts/acceptance/goal-run-2026-07-09/rental-service-live-acceptance.mjs
 *   QEP_PRODUCTION_ACCEPTANCE_CONFIRM=iciddijgonywtxoelous \
 *     bun scripts/acceptance/goal-run-2026-07-09/rental-service-live-acceptance.mjs \
 *       --execute --workspace=default --evidence=test-results/agent-gates/live-rental-service.json
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EXPECTED_PROJECT_REF = "iciddijgonywtxoelous";
const DEFAULT_RENTAL_SCALE_COUNT = 501;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_WORKERS = 3;
const MAX_DRAIN_ROUNDS = 100;
const ENV_FILES = [".env.local", ".env"];

function parseArgs(argv) {
  const options = {
    execute: false,
    keepFixtures: false,
    skipRental: false,
    skipService: false,
    workspace: process.env.QEP_ACCEPTANCE_WORKSPACE_ID ?? "default",
    rentalCount: DEFAULT_RENTAL_SCALE_COUNT,
    batchSize: DEFAULT_BATCH_SIZE,
    workers: DEFAULT_WORKERS,
    evidence: null,
  };
  for (const arg of argv) {
    if (arg === "--execute") options.execute = true;
    else if (arg === "--keep-fixtures") options.keepFixtures = true;
    else if (arg === "--skip-rental") options.skipRental = true;
    else if (arg === "--skip-service") options.skipService = true;
    else if (arg.startsWith("--workspace=")) options.workspace = arg.slice(12).trim();
    else if (arg.startsWith("--rental-count=")) options.rentalCount = Number(arg.slice(15));
    else if (arg.startsWith("--batch-size=")) options.batchSize = Number(arg.slice(13));
    else if (arg.startsWith("--workers=")) options.workers = Number(arg.slice(10));
    else if (arg.startsWith("--evidence=")) options.evidence = arg.slice(11).trim();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.workspace) throw new Error("workspace must not be empty");
  if (!Number.isInteger(options.rentalCount) || options.rentalCount <= 500) {
    throw new Error("--rental-count must be an integer greater than 500");
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) {
    throw new Error("--batch-size must be between 1 and 100");
  }
  if (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > 8) {
    throw new Error("--workers must be between 1 and 8");
  }
  if (options.skipRental && options.skipService) {
    throw new Error("--skip-rental and --skip-service cannot be combined");
  }
  return options;
}

function printHelp() {
  console.log(`rental-service-live-acceptance.mjs

Default: print the mutation/assertion plan without making a network request.

Options:
  --execute              Run live fixtures (also requires confirmation env)
  --workspace=ID         Target workspace (default: default)
  --rental-count=N       Clean scale cohort, must be >500 (default: 501)
  --batch-size=N         Durable runner batch, 1..100 (default: 25)
  --workers=N            Concurrent bounded HTTP workers, 1..8 (default: 3)
  --skip-rental          Run only service planner acceptance
  --skip-service         Run only rental acceptance
  --evidence=PATH        Write scrubbed JSON evidence
  --keep-fixtures        Debug only: skip cleanup (not for gate evidence)
`);
}

function loadLocalEnv() {
  for (const filename of ENV_FILES) {
    const path = resolve(process.cwd(), filename);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue;
      let value = line.slice(separator + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

function projectRefFromUrl(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }
  const match = host.match(/^([a-z0-9]+)\.supabase\.(?:co|in)$/i);
  if (!match) throw new Error(`SUPABASE_URL host is not a hosted Supabase project: ${host}`);
  return match[1];
}

function requireLiveConfig(options) {
  loadLocalEnv();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !serviceKey || !anonKey) {
    throw new Error(
      "live execution requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY (or VITE/NEXT_PUBLIC equivalent)",
    );
  }
  const ref = projectRefFromUrl(url);
  if (ref !== EXPECTED_PROJECT_REF) {
    throw new Error(`refusing mutation: URL project ref ${ref} is not ${EXPECTED_PROJECT_REF}`);
  }
  const configuredRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (configuredRef && configuredRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`refusing mutation: SUPABASE_PROJECT_REF is ${configuredRef}`);
  }
  if (process.env.QEP_PRODUCTION_ACCEPTANCE_CONFIRM !== EXPECTED_PROJECT_REF) {
    throw new Error(
      `--execute also requires QEP_PRODUCTION_ACCEPTANCE_CONFIRM=${EXPECTED_PROJECT_REF}`,
    );
  }
  if (options.keepFixtures && process.env.QEP_ACCEPTANCE_ALLOW_KEEP !== "true") {
    throw new Error("--keep-fixtures also requires QEP_ACCEPTANCE_ALLOW_KEEP=true");
  }
  return { url, serviceKey, anonKey, ref };
}

function dryRunPlan(options) {
  return {
    mode: "dry-run",
    network_requests: 0,
    project_ref_required: EXPECTED_PROJECT_REF,
    workspace: options.workspace,
    cleanup_in_finally: !options.keepFixtures,
    rental: options.skipRental
      ? "skipped"
      : {
        exact_money_run: "multi-unit + corrected assessment + pending damage + legacy null-equipment bucket",
        clean_scale_run: `${options.rentalCount} due contracts, ${options.workers} bounded workers, replay adds zero`,
        poison_run: "one end-before-start temporal fixture fails/dead-letters; two later contracts still invoice",
        batch_size: options.batchSize,
      },
    service: options.skipService
      ? "skipped"
      : {
        auth: "ephemeral manager JWT; service-role invocation must remain rejected by the function",
        first_plan: "two concurrent calls create one submitted vendor commitment",
        replay: "unchanged plan reuses the active action/PO line",
        changed_plan: "quantity + vendor replacement supersedes old demand, one active commitment remains",
      },
    external_side_effect_guard:
      "generated QuickBooks GL queue rows are deleted after every rental HTTP batch and asserted never synced",
  };
}

function assert(condition, message, details = undefined) {
  if (!condition) {
    const suffix = details === undefined ? "" : `: ${JSON.stringify(details)}`;
    throw new Error(`ASSERTION FAILED — ${message}${suffix}`);
  }
}

function safeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function must(label, promise) {
  const result = await promise;
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function insertChunked(admin, table, rows, select = "id") {
  const inserted = [];
  for (const batch of chunks(rows)) {
    const data = await must(
      `${table} fixture insert`,
      admin.from(table).insert(batch).select(select),
    );
    inserted.push(...(data ?? []));
  }
  return inserted;
}

async function selectByIds(admin, table, columns, field, ids) {
  const rows = [];
  for (const batch of chunks([...new Set(ids)].filter(Boolean))) {
    if (batch.length === 0) continue;
    const data = await must(
      `${table} fixture select`,
      admin.from(table).select(columns).in(field, batch),
    );
    rows.push(...(data ?? []));
  }
  return rows;
}

async function deleteByIds(admin, table, field, ids, { bestEffort = false } = {}) {
  for (const batch of chunks([...new Set(ids)].filter(Boolean))) {
    if (batch.length === 0) continue;
    const result = await admin.from(table).delete().in(field, batch);
    if (result.error && !bestEffort) throw new Error(`${table} cleanup: ${result.error.message}`);
  }
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function dateDaysFromNow(days) {
  return isoDaysFromNow(days).slice(0, 10);
}

function fixtureUuid(base, suffix) {
  return `${base.slice(0, 24)}${String(suffix).padStart(12, "0")}`;
}

async function invokeFunction(url, key, functionName, body, bearer = key) {
  const started = performance.now();
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${functionName} ${response.status}: ${payload?.error ?? JSON.stringify(payload)}`,
    );
  }
  return { payload, duration_ms: Math.round(performance.now() - started) };
}

function newState(tag, workspace) {
  return {
    tag,
    workspace,
    companyId: null,
    equipmentIds: [],
    rentalContractIds: [],
    rentalLineIds: [],
    rentalReturnIds: [],
    rentalRunIds: [],
    rentalInvoiceIds: [],
    customerInvoiceIds: [],
    serviceJobId: null,
    serviceRequirementId: null,
    serviceVendorIds: [],
    servicePoIds: [],
    authUserId: null,
  };
}

async function seedFixtureCompany(admin, state) {
  const id = crypto.randomUUID();
  const [company] = await insertChunked(admin, "qrm_companies", [{
    id,
    workspace_id: state.workspace,
    name: `QEP acceptance ${state.tag}`,
    legal_name: `QEP acceptance fixture ${state.tag}`,
    metadata: { acceptance_tag: state.tag, expires_after_test: true },
  }]);
  state.companyId = company.id;
}

async function quarantineRentalSideEffects(admin, state, contractIds) {
  const invoices = await selectByIds(
    admin,
    "rental_invoices",
    "id, customer_invoice_id",
    "rental_contract_id",
    contractIds,
  );
  for (const invoice of invoices) {
    state.rentalInvoiceIds.push(invoice.id);
    if (invoice.customer_invoice_id) state.customerInvoiceIds.push(invoice.customer_invoice_id);
  }
  const customerIds = [...new Set(state.customerInvoiceIds)];
  if (customerIds.length === 0) return;
  const jobs = await selectByIds(
    admin,
    "quickbooks_gl_sync_jobs",
    "id, invoice_id, status, quickbooks_txn_id",
    "invoice_id",
    customerIds,
  );
  const escaped = jobs.filter((job) =>
    job.status === "processing" || job.status === "synced" || job.quickbooks_txn_id
  );
  assert(escaped.length === 0, "fixture GL queue must not reach an external sync", escaped);
  await deleteByIds(admin, "quickbooks_gl_sync_jobs", "id", jobs.map((job) => job.id));
}

async function callRentalRunner(config, body) {
  return await invokeFunction(
    config.url,
    config.serviceKey,
    "rental-billing-runner",
    { auto_continue: false, ...body },
  );
}

async function drainRentalRun(config, admin, state, contractIds, options) {
  const samples = [];
  const first = await callRentalRunner(config, {
    workspace_id: state.workspace,
    force_new: true,
    contract_ids: contractIds,
    batch_size: options.batchSize,
    concurrency: 4,
  });
  samples.push(first);
  const runId = first.payload.run_id;
  assert(typeof runId === "string", "rental runner returns run_id", first.payload);
  state.rentalRunIds.push(runId);
  await quarantineRentalSideEffects(admin, state, contractIds);

  let status = first.payload.status;
  let hasMore = first.payload.has_more === true;
  let rounds = 0;
  while (hasMore) {
    rounds++;
    assert(rounds <= MAX_DRAIN_ROUNDS, "rental drain stays bounded", { rounds, runId });
    const roundSamples = await Promise.all(
      Array.from({ length: options.workers }, () => callRentalRunner(config, {
        workspace_id: state.workspace,
        run_id: runId,
        batch_size: options.batchSize,
        concurrency: 4,
      })),
    );
    samples.push(...roundSamples);
    await quarantineRentalSideEffects(admin, state, contractIds);
    const run = await must(
      "rental run checkpoint",
      admin.from("rental_billing_runs")
        .select("status, examined_count, invoice_count, skipped_count, failed_count, batch_count, resume_count, total_billed_cents, total_tax_cents")
        .eq("id", runId)
        .single(),
    );
    status = run.status;
    hasMore = ["running", "partial", "resumed"].includes(status) &&
      roundSamples.some((sample) => sample.payload.has_more === true);
  }

  const run = await must(
    "rental terminal checkpoint",
    admin.from("rental_billing_runs")
      .select("status, examined_count, invoice_count, skipped_count, failed_count, batch_count, resume_count, total_billed_cents, total_tax_cents")
      .eq("id", runId)
      .single(),
  );
  const items = await must(
    "rental run items",
    admin.from("rental_billing_run_items")
      .select("rental_contract_id, status, attempt_count, rental_invoice_id, error_detail")
      .eq("rental_billing_run_id", runId)
      .order("rental_contract_id"),
  );
  return { runId, run, items: items ?? [], samples };
}

async function replayRentalRun(config, admin, state, runId, contractIds, options) {
  const before = await selectByIds(
    admin,
    "rental_invoices",
    "id",
    "rental_contract_id",
    contractIds,
  );
  const replay = await callRentalRunner(config, {
    workspace_id: state.workspace,
    run_id: runId,
    batch_size: options.batchSize,
    concurrency: 4,
  });
  await quarantineRentalSideEffects(admin, state, contractIds);
  const after = await selectByIds(
    admin,
    "rental_invoices",
    "id",
    "rental_contract_id",
    contractIds,
  );
  assert(replay.payload.batch?.claimed === 0, "terminal rental replay claims zero", replay.payload);
  assert(after.length === before.length, "terminal rental replay adds zero invoices", {
    before: before.length,
    after: after.length,
  });
  return {
    claimed: replay.payload.batch?.claimed,
    invoices_before: before.length,
    invoices_after: after.length,
    status: replay.payload.status,
  };
}

async function runRentalMoneyAcceptance(config, admin, state) {
  const equipmentRows = await insertChunked(admin, "qrm_equipment", [1, 2].map((number) => ({
    id: crypto.randomUUID(),
    workspace_id: state.workspace,
    company_id: state.companyId,
    name: `Acceptance return unit ${number}`,
    serial_number: `${state.tag}-RETURN-${number}`,
    asset_tag: `${state.tag}-RETURN-${number}`,
    metadata: { acceptance_tag: state.tag },
  })));
  const equipmentIds = equipmentRows.map((row) => row.id);
  state.equipmentIds.push(...equipmentIds);

  const contractId = crypto.randomUUID();
  const [contract] = await insertChunked(admin, "rental_contracts", [{
    id: contractId,
    workspace_id: state.workspace,
    qrm_company_id: state.companyId,
    portal_customer_id: null,
    contract_type: "loaner",
    lifecycle_state: "returned",
    status: "returned",
    origination_channel: "counter",
    requested_start_date: dateDaysFromNow(-8),
    requested_end_date: dateDaysFromNow(-2),
    on_rent_at: isoDaysFromNow(-8),
    off_rent_at: isoDaysFromNow(-2),
    returned_at: isoDaysFromNow(-1),
    agreed_daily_rate: null,
    agreed_weekly_rate: null,
    agreed_monthly_rate: null,
    damage_waiver_accepted: false,
    delivery_fee_cents: 0,
    pickup_fee_cents: 0,
    deposit_status: "not_required",
    tax_sourcing_method: "manual_override",
    assignment_status: "pending_assignment",
    dealer_notes: `${state.tag}:MONEY`,
  }]);
  state.rentalContractIds.push(contract.id);

  const baseTime = Date.now() - 86_400_000;
  const returnRows = [
    {
      id: crypto.randomUUID(), equipment_id: equipmentIds[0],
      fuel_charge_cents: 9_000, cleaning_charge_cents: 5_000,
      damage_charge_cents: 40_000, environmental_fee_cents: 900,
      damage_disposition: "customer_billable", offset: 1,
    },
    {
      id: crypto.randomUUID(), equipment_id: equipmentIds[0],
      fuel_charge_cents: 6_000, cleaning_charge_cents: 2_000,
      damage_charge_cents: 15_000, environmental_fee_cents: 500,
      damage_disposition: "customer_billable", offset: 2,
    },
    {
      id: crypto.randomUUID(), equipment_id: equipmentIds[1],
      fuel_charge_cents: 3_000, cleaning_charge_cents: 1_000,
      damage_charge_cents: 40_000, environmental_fee_cents: 700,
      damage_disposition: "pending", offset: 3,
    },
    {
      id: crypto.randomUUID(), equipment_id: null,
      fuel_charge_cents: 8_000, cleaning_charge_cents: 0,
      damage_charge_cents: 0, environmental_fee_cents: 0,
      damage_disposition: "pending", offset: 4,
    },
    {
      id: crypto.randomUUID(), equipment_id: null,
      fuel_charge_cents: 2_000, cleaning_charge_cents: 300,
      damage_charge_cents: 0, environmental_fee_cents: 0,
      damage_disposition: "pending", offset: 5,
    },
  ].map(({ offset, ...row }) => ({
    ...row,
    workspace_id: state.workspace,
    rental_contract_id: contract.id,
    has_charges: true,
    status: "completed",
    charge_breakdown: { acceptance_tag: state.tag },
    created_at: new Date(baseTime + offset * 1_000).toISOString(),
    updated_at: new Date(baseTime + offset * 1_000).toISOString(),
  }));
  const insertedReturns = await insertChunked(admin, "rental_returns", returnRows);
  state.rentalReturnIds.push(...insertedReturns.map((row) => row.id));

  const drained = await drainRentalRun(config, admin, state, [contract.id], {
    batchSize: 1,
    workers: 1,
  });
  assert(drained.run.status === "completed", "money run completes", drained.run);
  assert(drained.items.length === 1 && drained.items[0].status === "invoiced", "money item invoices once", drained.items);
  const invoice = await must(
    "money invoice",
    admin.from("rental_invoices")
      .select("id, rental_charge_cents, fuel_charge_cents, cleaning_charge_cents, damage_charge_cents, other_charge_cents, taxable_amount_cents, tax_cents, total_cents, metadata")
      .eq("rental_contract_id", contract.id)
      .single(),
  );
  const expected = {
    rental_charge_cents: 0,
    fuel_charge_cents: 11_000,
    cleaning_charge_cents: 3_300,
    damage_charge_cents: 15_000,
    other_charge_cents: 1_200,
    taxable_amount_cents: 30_500,
    tax_cents: 0,
    total_cents: 30_500,
  };
  for (const [field, value] of Object.entries(expected)) {
    assert(Number(invoice[field]) === value, `money invoice ${field} is exact`, {
      actual: invoice[field], expected: value,
    });
  }
  const audit = invoice.metadata?.return_charge_audit ?? {};
  assert(audit.selected_return_ids?.length === 3, "three canonical return buckets selected", audit);
  assert(audit.superseded_return_ids?.length === 2, "two corrected return rows superseded", audit);
  const pending = audit.sources?.find((source) => source.equipment_id === equipmentIds[1]);
  assert(pending?.damage_disposition === "pending" && pending?.damage_charge_cents === 0,
    "pending damage is excluded while its other charges remain", pending);
  assert(audit.legacy_null_equipment_return_id === returnRows[4].id,
    "latest legacy null-equipment assessment wins", audit);
  const replay = await replayRentalRun(config, admin, state, drained.runId, [contract.id], {
    batchSize: 1,
  });
  return { run_id: drained.runId, contract_id: contract.id, invoice_id: invoice.id, expected, replay };
}

async function runRentalScaleAcceptance(config, admin, state, options) {
  const contracts = Array.from({ length: options.rentalCount }, (_, index) => ({
    id: crypto.randomUUID(),
    workspace_id: state.workspace,
    qrm_company_id: state.companyId,
    portal_customer_id: null,
    contract_type: "rental",
    lifecycle_state: "on_rent",
    status: "on_rent",
    origination_channel: "counter",
    requested_start_date: dateDaysFromNow(-40),
    requested_end_date: dateDaysFromNow(30),
    on_rent_at: isoDaysFromNow(-40),
    agreed_daily_rate: 10,
    agreed_weekly_rate: null,
    agreed_monthly_rate: null,
    damage_waiver_accepted: false,
    deposit_status: "not_required",
    tax_sourcing_method: "manual_override",
    assignment_status: "pending_assignment",
    dealer_notes: `${state.tag}:SCALE:${index}`,
  }));
  const inserted = await insertChunked(admin, "rental_contracts", contracts);
  const ids = inserted.map((row) => row.id);
  state.rentalContractIds.push(...ids);
  const started = performance.now();
  const drained = await drainRentalRun(config, admin, state, ids, options);
  const wallMs = Math.round(performance.now() - started);
  assert(drained.run.status === "completed", "clean scale run completes", drained.run);
  assert(drained.items.length === options.rentalCount, "scale run examines every contract beyond 500", {
    expected: options.rentalCount,
    actual: drained.items.length,
  });
  assert(drained.items.every((item) => item.status === "invoiced"), "every clean scale item invoices", {
    statuses: drained.items.reduce((counts, item) => ({
      ...counts,
      [item.status]: (counts[item.status] ?? 0) + 1,
    }), {}),
  });
  assert(drained.run.batch_count > 1 && drained.run.resume_count > 0,
    "scale run proves bounded resumption", drained.run);
  const invoices = await selectByIds(
    admin,
    "rental_invoices",
    "id, rental_contract_id, invoice_number, rental_charge_cents, tax_cents, total_cents, status, metadata",
    "rental_contract_id",
    ids,
  );
  assert(invoices.length === options.rentalCount, "one scale invoice per contract", {
    invoices: invoices.length, contracts: options.rentalCount,
  });
  assert(new Set(invoices.map((invoice) => invoice.rental_contract_id)).size === options.rentalCount,
    "no duplicate contract-period invoices", invoices.length);
  assert(new Set(invoices.map((invoice) => invoice.invoice_number)).size === invoices.length,
    "concurrent workers mint unique invoice numbers", invoices.length);
  const badMoney = invoices.filter((invoice) =>
    Number(invoice.rental_charge_cents) !== 28_000 ||
    Number(invoice.tax_cents) !== 0 ||
    Number(invoice.total_cents) !== 28_000 ||
    invoice.metadata?.kind !== "interim"
  );
  assert(badMoney.length === 0, "scale invoices carry exact 28-day daily money", badMoney.slice(0, 3));
  const replay = await replayRentalRun(config, admin, state, drained.runId, ids, options);
  return {
    run_id: drained.runId,
    cohort: options.rentalCount,
    status: drained.run.status,
    batch_count: drained.run.batch_count,
    resume_count: drained.run.resume_count,
    bounded_http_requests: drained.samples.length,
    workers: options.workers,
    batch_size: options.batchSize,
    wall_ms: wallMs,
    contracts_per_second: Number((options.rentalCount / (wallMs / 1_000)).toFixed(2)),
    request_p95_ms: percentile(drained.samples.map((sample) => sample.duration_ms), 0.95),
    replay,
  };
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

async function runRentalPoisonAcceptance(config, admin, state) {
  const orderedUuidBase = crypto.randomUUID();
  const poisonId = fixtureUuid(orderedUuidBase, 1);
  const laterIds = [
    fixtureUuid(orderedUuidBase, 2),
    fixtureUuid(orderedUuidBase, 3),
  ];
  const common = {
    workspace_id: state.workspace,
    qrm_company_id: state.companyId,
    portal_customer_id: null,
    contract_type: "rental",
    lifecycle_state: "on_rent",
    status: "on_rent",
    origination_channel: "counter",
    requested_start_date: dateDaysFromNow(-40),
    requested_end_date: dateDaysFromNow(30),
    on_rent_at: isoDaysFromNow(-40),
    agreed_daily_rate: 10,
    damage_waiver_accepted: false,
    deposit_status: "not_required",
    tax_sourcing_method: "manual_override",
    assignment_status: "pending_assignment",
  };
  const inserted = await insertChunked(admin, "rental_contracts", [
    {
      ...common,
      id: poisonId,
      lifecycle_state: "returned",
      status: "returned",
      on_rent_at: isoDaysFromNow(-1),
      returned_at: isoDaysFromNow(-2),
      dealer_notes: `${state.tag}:INTENTIONAL-POISON-END-BEFORE-START`,
    },
    ...laterIds.map((id, index) => ({ ...common, id, dealer_notes: `${state.tag}:AFTER-POISON:${index}` })),
  ]);
  state.rentalContractIds.push(...inserted.map((row) => row.id));
  const allIds = [poisonId, ...laterIds];
  const drained = await drainRentalRun(config, admin, state, allIds, {
    batchSize: 1,
    workers: 1,
  });
  const byContract = new Map(drained.items.map((item) => [item.rental_contract_id, item]));
  assert(drained.run.status === "failed" && drained.run.failed_count === 1,
    "drained poison run is truthfully failed with one item", drained.run);
  assert(byContract.get(poisonId)?.status === "failed", "poison item is isolated as failed", byContract.get(poisonId));
  assert(byContract.get(poisonId)?.error_detail?.includes("clock_end_at precedes start_at"),
    "poison failure is the intended temporal invariant", byContract.get(poisonId));
  assert(laterIds.every((id) => byContract.get(id)?.status === "invoiced"),
    "contracts ordered after poison still invoice", drained.items);
  const invoices = await selectByIds(
    admin,
    "rental_invoices",
    "id, rental_contract_id",
    "rental_contract_id",
    allIds,
  );
  assert(invoices.length === 2 && invoices.every((invoice) => laterIds.includes(invoice.rental_contract_id)),
    "poison creates no invoice while later work creates exactly two", invoices);
  const exceptions = await must(
    "poison dead letter",
    admin.from("exception_queue")
      .select("id, source, entity_id, detail, payload")
      .eq("source", "rental_billing_failed")
      .eq("entity_id", poisonId),
  );
  assert((exceptions ?? []).length >= 1, "poison failure is dead-lettered", exceptions);
  const replay = await replayRentalRun(config, admin, state, drained.runId, allIds, {
    batchSize: 1,
  });
  return {
    run_id: drained.runId,
    status: drained.run.status,
    failed_contract_id: poisonId,
    later_invoiced_contract_ids: laterIds,
    failed_detail: byContract.get(poisonId)?.error_detail,
    dead_letter_count: exceptions.length,
    replay,
  };
}

async function createEphemeralServiceUser(config, admin, state) {
  const email = `qep-acceptance-${state.tag.toLowerCase()}@example.invalid`;
  const password = `Qep!${crypto.randomUUID()}aA9`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `QEP acceptance ${state.tag}` },
  });
  if (error || !data.user) throw new Error(`acceptance auth user: ${error?.message ?? "no user"}`);
  state.authUserId = data.user.id;
  let profile = await must(
    "acceptance profile bootstrap",
    admin.from("profiles").select("id").eq("id", data.user.id).maybeSingle(),
  );
  if (!profile) {
    await must(
      "acceptance profile backfill",
      admin.rpc("backfill_profile", {
        p_id: data.user.id,
        p_email: email,
        p_full_name: `QEP acceptance ${state.tag}`,
        p_role: "manager",
        p_iron_role: "iron_manager",
        p_workspace: state.workspace,
      }),
    );
    profile = await must(
      "acceptance profile verification",
      admin.from("profiles").select("id").eq("id", data.user.id).maybeSingle(),
    );
  }
  assert(profile?.id === data.user.id, "acceptance profile exists after bootstrap/backfill");
  await must(
    "acceptance workspace membership",
    admin.from("profile_workspaces").upsert({
      profile_id: data.user.id,
      workspace_id: state.workspace,
    }, { onConflict: "profile_id,workspace_id" }),
  );
  await must(
    "acceptance manager profile",
    admin.from("profiles").update({
      active_workspace_id: state.workspace,
      role: "manager",
      full_name: `QEP acceptance ${state.tag}`,
      is_active: true,
    }).eq("id", data.user.id),
  );
  const authClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session?.access_token) {
    throw new Error(`acceptance user sign-in: ${signInError?.message ?? "no access token"}`);
  }
  return session.session.access_token;
}

async function callServicePlanner(config, token, jobId) {
  return await invokeFunction(
    config.url,
    config.anonKey,
    "service-parts-planner",
    { job_id: jobId },
    token,
  );
}

async function activeServiceDemand(admin, state) {
  const actions = await must(
    "service actions",
    admin.from("service_parts_actions")
      .select("id, action_type, service_demand_key, demand_fingerprint, demand_version, purchase_order_id, purchase_order_line_id, po_reference, superseded_at")
      .eq("requirement_id", state.serviceRequirementId)
      .order("demand_version"),
  );
  const lines = await must(
    "service PO lines",
    admin.from("purchase_order_lines")
      .select("id, purchase_order_id, qty_ordered, unit_cost_cents, status, service_demand_key, demand_fingerprint, demand_version, superseded_at")
      .eq("service_parts_requirement_id", state.serviceRequirementId)
      .order("demand_version"),
  );
  const poIds = [...new Set((lines ?? []).map((line) => line.purchase_order_id))];
  state.servicePoIds.push(...poIds);
  const orders = await selectByIds(
    admin,
    "purchase_orders",
    "id, po_number, vendor_id, status, subtotal_cents, total_cents, deleted_at, metadata",
    "id",
    poIds,
  );
  const activeActions = (actions ?? []).filter((action) => action.superseded_at == null);
  const activeLines = (lines ?? []).filter((line) =>
    line.superseded_at == null && ["open", "partial", "backordered"].includes(line.status)
  );
  const activeOrders = orders.filter((order) =>
    order.deleted_at == null && ["submitted", "acknowledged", "partial_received", "backordered"].includes(order.status)
  );
  return { actions: actions ?? [], lines: lines ?? [], orders, activeActions, activeLines, activeOrders };
}

async function runServiceAcceptance(config, admin, state) {
  const token = await createEphemeralServiceUser(config, admin, state);
  const vendors = await insertChunked(admin, "vendor_profiles", [1, 2].map((number) => ({
    id: crypto.randomUUID(),
    workspace_id: state.workspace,
    name: `QEP acceptance vendor ${number} ${state.tag}`,
    supplier_type: "general",
    avg_lead_time_hours: 24 + number,
    notes: `${state.tag}:VENDOR:${number}`,
  })));
  state.serviceVendorIds.push(...vendors.map((vendor) => vendor.id));
  const partNumber = `ACC-${state.tag.slice(-12)}`.toUpperCase();
  const [job] = await insertChunked(admin, "service_jobs", [{
    id: crypto.randomUUID(),
    workspace_id: state.workspace,
    customer_id: state.companyId,
    source_type: "walk_in",
    request_type: "repair",
    priority: "normal",
    current_stage: "parts_pending",
    status_flags: ["shop_job"],
    branch_id: `acceptance-${state.tag.slice(-10).toLowerCase()}`,
    haul_required: false,
    shop_or_field: "shop",
    scheduled_start_at: isoDaysFromNow(7),
    customer_problem_summary: `${state.tag}:SERVICE-REPLAN`,
  }]);
  state.serviceJobId = job.id;
  const [requirement] = await insertChunked(admin, "service_parts_requirements", [{
    id: crypto.randomUUID(),
    workspace_id: state.workspace,
    job_id: job.id,
    part_number: partNumber,
    description: `Acceptance order-only part ${state.tag}`,
    quantity: 2,
    unit_cost: 12.34,
    vendor_id: vendors[0].id,
    source: "manual",
    status: "pending",
    intake_line_status: "accepted",
    notes: `${state.tag}:REQUIREMENT`,
  }]);
  state.serviceRequirementId = requirement.id;

  const firstConcurrent = await Promise.all([
    callServicePlanner(config, token, job.id),
    callServicePlanner(config, token, job.id),
  ]);
  const firstPayloads = firstConcurrent.map((sample) => sample.payload);
  assert(firstPayloads.reduce((sum, payload) => sum + Number(payload.actions_created ?? 0), 0) === 1,
    "concurrent initial plans create one action", firstPayloads);
  assert(firstPayloads.reduce((sum, payload) => sum + Number(payload.purchase_order_lines_created ?? 0), 0) === 1,
    "concurrent initial plans create one PO line", firstPayloads);
  assert(firstPayloads.reduce((sum, payload) => sum + Number(payload.purchase_orders_created ?? 0), 0) === 1,
    "concurrent initial plans create one submitted PO header", firstPayloads);
  let demand = await activeServiceDemand(admin, state);
  assert(demand.activeActions.length === 1 && demand.activeLines.length === 1 && demand.activeOrders.length === 1,
    "one active demand survives concurrent first plan", demand);
  const firstAction = demand.activeActions[0];
  const firstLine = demand.activeLines[0];
  const firstOrder = demand.activeOrders[0];
  assert(firstAction.purchase_order_line_id === firstLine.id && firstAction.purchase_order_id === firstOrder.id,
    "action links the surviving PO line/header", { firstAction, firstLine, firstOrder });
  assert(firstAction.po_reference === firstOrder.po_number, "legacy PO reference matches surviving header");
  assert(Number(firstLine.qty_ordered) === 2 && Number(firstLine.unit_cost_cents) === 1_234,
    "initial PO line money and quantity are exact", firstLine);

  const replay = await callServicePlanner(config, token, job.id);
  assert(replay.payload.idempotent_replay === true && replay.payload.actions_created === 0 &&
    replay.payload.actions_reused === 1 && replay.payload.actions_superseded === 0,
  "unchanged service plan is an idempotent replay", replay.payload);
  demand = await activeServiceDemand(admin, state);
  assert(demand.activeLines.length === 1 && demand.activeLines[0].id === firstLine.id,
    "unchanged replay reuses the same PO line", demand);

  await must(
    "change service requirement",
    admin.from("service_parts_requirements").update({
      quantity: 3,
      vendor_id: vendors[1].id,
      status: "ordering",
    }).eq("id", requirement.id),
  );
  const changedConcurrent = await Promise.all([
    callServicePlanner(config, token, job.id),
    callServicePlanner(config, token, job.id),
  ]);
  const changedPayloads = changedConcurrent.map((sample) => sample.payload);
  assert(changedPayloads.reduce((sum, payload) => sum + Number(payload.actions_created ?? 0), 0) === 1,
    "concurrent changed plans create one replacement action", changedPayloads);
  assert(changedPayloads.reduce((sum, payload) => sum + Number(payload.actions_superseded ?? 0), 0) === 1,
    "changed demand supersedes exactly one old action", changedPayloads);
  demand = await activeServiceDemand(admin, state);
  assert(demand.activeActions.length === 1 && demand.activeLines.length === 1 && demand.activeOrders.length === 1,
    "one active replacement demand survives", demand);
  const replacementAction = demand.activeActions[0];
  const replacementLine = demand.activeLines[0];
  const replacementOrder = demand.activeOrders[0];
  assert(replacementLine.id !== firstLine.id && Number(replacementLine.qty_ordered) === 3,
    "quantity change creates the intended replacement line", replacementLine);
  assert(replacementOrder.vendor_id === vendors[1].id && replacementOrder.status === "submitted",
    "vendor change moves the active commitment to the intended vendor", replacementOrder);
  assert(replacementAction.purchase_order_line_id === replacementLine.id &&
    replacementAction.purchase_order_id === replacementOrder.id &&
    replacementAction.po_reference === replacementOrder.po_number,
  "replacement action links the surviving PO exactly", replacementAction);
  const retiredLine = demand.lines.find((line) => line.id === firstLine.id);
  const retiredOrder = demand.orders.find((order) => order.id === firstOrder.id);
  assert(retiredLine?.status === "cancelled" && retiredLine?.superseded_at,
    "old PO line remains auditable and inactive", retiredLine);
  assert(retiredOrder?.status === "cancelled", "old vendor header with no active demand is cancelled", retiredOrder);

  return {
    job_id: job.id,
    requirement_id: requirement.id,
    first_concurrent: firstPayloads,
    replay: replay.payload,
    changed_concurrent: changedPayloads,
    surviving: {
      action_id: replacementAction.id,
      po_id: replacementOrder.id,
      po_line_id: replacementLine.id,
      vendor_id: replacementOrder.vendor_id,
      quantity: replacementLine.qty_ordered,
      demand_version: replacementLine.demand_version,
    },
    retired: { po_id: firstOrder.id, po_line_id: firstLine.id },
  };
}

async function cleanup(admin, state) {
  const cleanup = { attempted: true, completed: false, warnings: [] };
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      cleanup.warnings.push(`${label}: ${safeError(error)}`);
    }
  };

  await step("discover rental invoice side effects", async () => {
    const invoices = await selectByIds(
      admin,
      "rental_invoices",
      "id, customer_invoice_id",
      "rental_contract_id",
      state.rentalContractIds,
    );
    state.rentalInvoiceIds.push(...invoices.map((invoice) => invoice.id));
    state.customerInvoiceIds.push(...invoices.map((invoice) => invoice.customer_invoice_id).filter(Boolean));
  });
  await step("quickbooks queue", () =>
    deleteByIds(admin, "quickbooks_gl_sync_jobs", "invoice_id", state.customerInvoiceIds));
  await step("customer invoice lines", () =>
    deleteByIds(admin, "customer_invoice_line_items", "invoice_id", state.customerInvoiceIds));
  await step("fixture analytics events", () =>
    deleteByIds(
      admin,
      "analytics_events",
      "entity_id",
      [...state.rentalInvoiceIds, ...state.customerInvoiceIds],
      { bestEffort: true },
    ));
  await step("rental invoices", () =>
    deleteByIds(admin, "rental_invoices", "id", state.rentalInvoiceIds));
  await step("customer invoices", () =>
    deleteByIds(admin, "customer_invoices", "id", state.customerInvoiceIds));
  await step("rental exceptions", () =>
    deleteByIds(admin, "exception_queue", "entity_id", state.rentalContractIds));
  await step("rental runs", () =>
    deleteByIds(admin, "rental_billing_runs", "id", state.rentalRunIds));
  await step("rental returns", () =>
    deleteByIds(admin, "rental_returns", "id", state.rentalReturnIds));
  await step("rental lines", () =>
    deleteByIds(admin, "rental_contract_lines", "id", state.rentalLineIds));
  await step("rental contracts", () =>
    deleteByIds(admin, "rental_contracts", "id", state.rentalContractIds));

  await step("discover service POs", async () => {
    if (!state.serviceRequirementId) return;
    const lines = await must(
      "service cleanup PO discovery",
      admin.from("purchase_order_lines")
        .select("id, purchase_order_id")
        .eq("service_parts_requirement_id", state.serviceRequirementId),
    );
    state.servicePoIds.push(...(lines ?? []).map((line) => line.purchase_order_id));
    await deleteByIds(admin, "purchase_order_lines", "id", (lines ?? []).map((line) => line.id));
  });
  await step("service purchase orders", () =>
    deleteByIds(admin, "purchase_orders", "id", state.servicePoIds));
  await step("service job", () =>
    deleteByIds(admin, "service_jobs", "id", [state.serviceJobId]));
  await step("service vendors", () =>
    deleteByIds(admin, "vendor_profiles", "id", state.serviceVendorIds));
  await step("fixture equipment", () =>
    deleteByIds(admin, "qrm_equipment", "id", state.equipmentIds));
  await step("fixture company", () =>
    deleteByIds(admin, "qrm_companies", "id", [state.companyId]));
  await step("ephemeral auth user", async () => {
    if (!state.authUserId) return;
    const result = await admin.auth.admin.deleteUser(state.authUserId);
    if (result.error) throw result.error;
  });

  // Generic audit tables deliberately have no FKs. Delete only exact fixture
  // record IDs; absence/schema differences are non-blocking cleanup warnings.
  const genericIds = [
    ...state.rentalContractIds,
    ...state.rentalInvoiceIds,
    ...state.customerInvoiceIds,
    state.serviceJobId,
    state.serviceRequirementId,
    ...state.servicePoIds,
  ].filter(Boolean);
  await step("generic change history", () =>
    deleteByIds(admin, "record_change_history", "record_id", genericIds, { bestEffort: true }));

  cleanup.completed = cleanup.warnings.length === 0;
  return cleanup;
}

function writeEvidence(path, evidence) {
  if (!path) return;
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`evidence: ${absolute}`);
}

async function main() {
  // Parse values from local env files without executing shell syntax. Doing
  // this before argument parsing also lets QEP_ACCEPTANCE_WORKSPACE_ID provide
  // the dry-run/live default while CLI flags remain authoritative.
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.execute) {
    const evidence = dryRunPlan(options);
    console.log(JSON.stringify(evidence, null, 2));
    writeEvidence(options.evidence, evidence);
    return;
  }

  const config = requireLiveConfig(options);
  const tag = `GOALRUN-20260709-${crypto.randomUUID()}`;
  const state = newState(tag, options.workspace);
  const evidence = {
    schema_version: 1,
    acceptance_id: tag,
    project_ref: config.ref,
    workspace_id: options.workspace,
    started_at: new Date().toISOString(),
    mission_alignment: {
      verdict: "pending",
      evidence:
        "Exercises exact rental money, resumable fleet billing, and single-commitment service purchasing that protect rental revenue and service parts availability.",
    },
    rental: null,
    service: null,
    cleanup: null,
    status: "running",
  };
  let failure = null;
  const admin = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(`LIVE acceptance ${tag} on ${config.ref}/${options.workspace}`);
  console.log("credentials loaded locally and intentionally not printed");
  try {
    const workspaceMemberships = await admin.from("profile_workspaces")
      .select("profile_id", { count: "exact", head: true })
      .eq("workspace_id", options.workspace);
    if (workspaceMemberships.error) {
      throw new Error(`workspace verification: ${workspaceMemberships.error.message}`);
    }
    assert((workspaceMemberships.count ?? 0) > 0,
      "target workspace has at least one staff membership", options.workspace);
    await seedFixtureCompany(admin, state);
    if (!options.skipRental) {
      evidence.rental = {
        money: await runRentalMoneyAcceptance(config, admin, state),
        scale: await runRentalScaleAcceptance(config, admin, state, options),
        poison: await runRentalPoisonAcceptance(config, admin, state),
      };
    }
    if (!options.skipService) {
      evidence.service = await runServiceAcceptance(config, admin, state);
    }
    evidence.status = "passed";
    evidence.mission_alignment.verdict = "pass";
  } catch (error) {
    failure = error;
    evidence.status = "failed";
    evidence.error = safeError(error);
    evidence.mission_alignment.verdict = "fail";
  } finally {
    if (options.keepFixtures) {
      evidence.cleanup = {
        attempted: false,
        completed: false,
        warnings: ["fixtures intentionally retained under explicit debug override"],
      };
    } else {
      evidence.cleanup = await cleanup(admin, state);
      if (!evidence.cleanup.completed && evidence.status === "passed") {
        evidence.status = "failed";
        evidence.mission_alignment.verdict = "fail";
        failure = new Error(`fixture cleanup incomplete: ${evidence.cleanup.warnings.join("; ")}`);
      }
    }
    evidence.completed_at = new Date().toISOString();
    writeEvidence(options.evidence, evidence);
    console.log(JSON.stringify(evidence, null, 2));
  }
  if (failure) throw failure;
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
