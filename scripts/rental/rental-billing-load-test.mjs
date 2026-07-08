#!/usr/bin/env bun
/**
 * L8 build gate: billing runner load test (blueprint §10 — "load test for the
 * billing runner, clone flow-load-test.mjs shape").
 *
 * Seeds N synthetic on-rent contracts one full 28-day cycle past their anchor
 * (so exactly one interim invoice is due each), then — after the runner has
 * been fired — asserts:
 *   • correctness: every seeded contract has exactly one posted interim
 *     invoice for its first cycle at the optimizer amount (28 × daily),
 *   • no invoice-number races: all RENT- numbers unique,
 *   • idempotency: a second run adds zero invoices for the cohort.
 *
 * The runner itself is triggered out-of-band via its cron command (the
 * internal secret stays server-side); this script does not hold the secret.
 * It is driven in three phases so the operator/CI can interleave the trigger:
 *
 *   bun scripts/rental/rental-billing-load-test.mjs seed   [count]  -> writes cohort, prints RUN_ID
 *   <trigger rental-billing-runner>
 *   bun scripts/rental/rental-billing-load-test.mjs assert RUN_ID   -> correctness + races
 *   <trigger rental-billing-runner again>
 *   bun scripts/rental/rental-billing-load-test.mjs idempotent RUN_ID -> zero-new
 *   bun scripts/rental/rental-billing-load-test.mjs cleanup RUN_ID   -> soft-delete cohort
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/rental/rental-billing-load-test.mjs <phase> [...]
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("rental-billing-load-test: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const DAILY_RATE = 250; // dollars → 28-day first cycle = $7,000
const EXPECTED_FIRST_CYCLE_CENTS = 28 * DAILY_RATE * 100;
const phase = process.argv[2];

const isoDaysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const dateDaysAgo = (n) => isoDaysAgo(n).slice(0, 10);

async function seed(count) {
  const runId = crypto.randomUUID();
  const { data: company, error: companyError } = await admin
    .from("qrm_companies")
    .select("id")
    .eq("workspace_id", "default")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (companyError || !company) { console.error("no anchor company available:", companyError?.message); process.exit(1); }

  const rows = Array.from({ length: count }, (_, i) => ({
    workspace_id: "default",
    contract_type: "rental",
    lifecycle_state: "on_rent",
    qrm_company_id: company.id, // customer anchor (L0 constraint)
    on_rent_at: isoDaysAgo(45), // 1 full 28-day cycle elapsed
    requested_start_date: dateDaysAgo(45),
    requested_end_date: dateDaysAgo(-30),
    agreed_daily_rate: DAILY_RATE,
    damage_waiver_accepted: false,
    deposit_status: "not_required",
    assignment_status: "pending_assignment", // no equipment attached in the load fixture
    dealer_notes: `LOADTEST:${runId}:${i}`,
  }));

  const t0 = Date.now();
  const inserted = [];
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await admin
      .from("rental_contracts")
      .insert(rows.slice(i, i + 100))
      .select("id");
    if (error) { console.error("seed insert failed:", error.message); process.exit(1); }
    inserted.push(...data);
  }
  console.log(`seeded ${inserted.length} on-rent contracts in ${Date.now() - t0}ms`);
  console.log(`RUN_ID=${runId}`);
}

async function cohort(runId) {
  const { data, error } = await admin
    .from("rental_contracts")
    .select("id")
    .like("dealer_notes", `LOADTEST:${runId}:%`)
    .is("deleted_at", null);
  if (error) { console.error(error.message); process.exit(1); }
  return (data ?? []).map((r) => r.id);
}

async function invoicesFor(ids) {
  const all = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from("rental_invoices")
      .select("id, rental_contract_id, invoice_number, total_cents, status, metadata")
      .in("rental_contract_id", ids.slice(i, i + 100))
      .is("deleted_at", null);
    if (error) { console.error(error.message); process.exit(1); }
    all.push(...(data ?? []));
  }
  return all;
}

async function assertCorrect(runId) {
  const ids = await cohort(runId);
  const invoices = await invoicesFor(ids);
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

  check("cohort seeded", ids.length > 0, `${ids.length} contracts`);
  check("one invoice per contract", invoices.length === ids.length, `${invoices.length} invoices / ${ids.length} contracts`);

  const byContract = new Map();
  for (const inv of invoices) byContract.set(inv.rental_contract_id, (byContract.get(inv.rental_contract_id) ?? 0) + 1);
  check("no double-invoiced contract", [...byContract.values()].every((n) => n === 1), `max ${Math.max(0, ...byContract.values())}`);

  const wrongAmount = invoices.filter((inv) => inv.total_cents !== EXPECTED_FIRST_CYCLE_CENTS);
  check("all invoices at optimizer amount", wrongAmount.length === 0, wrongAmount.length ? `${wrongAmount.length} off (expected ${EXPECTED_FIRST_CYCLE_CENTS})` : `$${EXPECTED_FIRST_CYCLE_CENTS / 100} each`);

  const numbers = invoices.map((i) => i.invoice_number);
  check("invoice numbers unique (no race)", new Set(numbers).size === numbers.length, `${numbers.length} numbers, ${new Set(numbers).size} distinct`);

  const posted = invoices.filter((i) => i.status === "posted");
  check("all invoices posted", posted.length === invoices.length, `${posted.length}/${invoices.length}`);

  const interim = invoices.filter((i) => i.metadata?.kind === "interim");
  check("all invoices interim kind", interim.length === invoices.length, `${interim.length}/${invoices.length}`);

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? "\nLOAD_TEST_CORRECT" : `\n${failed.length} CHECK(S) FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
}

async function assertIdempotent(runId) {
  const ids = await cohort(runId);
  const invoices = await invoicesFor(ids);
  const byContract = new Map();
  for (const inv of invoices) byContract.set(inv.rental_contract_id, (byContract.get(inv.rental_contract_id) ?? 0) + 1);
  const doubled = [...byContract.values()].filter((n) => n > 1).length;
  const ok = invoices.length === ids.length && doubled === 0;
  console.log(`${ok ? "PASS" : "FAIL"} idempotent: ${invoices.length} invoices across ${ids.length} contracts, ${doubled} double-billed`);
  console.log(ok ? "\nLOAD_TEST_IDEMPOTENT" : "\nIDEMPOTENCY FAILED");
  process.exit(ok ? 0 : 1);
}

async function cleanup(runId) {
  const ids = await cohort(runId);
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    await admin.from("rental_invoices").update({ deleted_at: now }).in("rental_contract_id", slice);
    await admin.from("rental_contracts").update({ deleted_at: now }).in("id", slice);
  }
  console.log(`soft-deleted ${ids.length} contracts + their invoices`);
}

switch (phase) {
  case "seed": await seed(Number(process.argv[3] ?? 200)); break;
  case "assert": await assertCorrect(process.argv[3]); break;
  case "idempotent": await assertIdempotent(process.argv[3]); break;
  case "cleanup": await cleanup(process.argv[3]); break;
  default:
    console.error("phase must be one of: seed | assert | idempotent | cleanup");
    process.exit(1);
}
