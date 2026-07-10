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
 * The durable-batch runner can now be drained directly with the service-role
 * credential already required by this acceptance script. `drain` uses two
 * bounded HTTP workers by default, verifies a >500 cohort reaches terminal
 * checkpoints, immediately replays the completed run (zero new invoices), and
 * prints before/after throughput evidence. The legacy baseline is the measured
 * ~250 ms/contract finding that motivated RB-BILLING-RUNNER-SCALE.
 *
 *   bun scripts/rental/rental-billing-load-test.mjs seed      [count=625]
 *   bun scripts/rental/rental-billing-load-test.mjs drain     RUN_ID [workers=2] [batch=25]
 *   bun scripts/rental/rental-billing-load-test.mjs assert    RUN_ID
 *   bun scripts/rental/rental-billing-load-test.mjs idempotent RUN_ID
 *   bun scripts/rental/rental-billing-load-test.mjs cleanup   RUN_ID
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/rental/rental-billing-load-test.mjs <phase> [...]
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error(
    "rental-billing-load-test: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const DAILY_RATE = 250; // dollars → 28-day first cycle = $7,000
const EXPECTED_FIRST_CYCLE_CENTS = 28 * DAILY_RATE * 100;
const LEGACY_BASELINE_MS_PER_CONTRACT = 250;
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
  if (companyError || !company) {
    console.error("no anchor company available:", companyError?.message);
    process.exit(1);
  }

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
    if (error) {
      console.error("seed insert failed:", error.message);
      process.exit(1);
    }
    inserted.push(...data);
  }
  console.log(
    `seeded ${inserted.length} on-rent contracts in ${Date.now() - t0}ms`,
  );
  console.log(`RUN_ID=${runId}`);
}

async function cohort(runId) {
  const { data, error } = await admin
    .from("rental_contracts")
    .select("id")
    .eq("workspace_id", "default")
    .like("dealer_notes", `LOADTEST:${runId}:%`);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  return (data ?? []).map((r) => r.id);
}

async function invoicesFor(ids) {
  const all = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from("rental_invoices")
      .select(
        "id, rental_contract_id, invoice_number, total_cents, status, metadata",
      )
      .in("rental_contract_id", ids.slice(i, i + 100))
      .is("deleted_at", null);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    all.push(...(data ?? []));
  }
  return all;
}

async function runItemsFor(ids, billingRunId) {
  const all = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from("rental_billing_run_items")
      .select(
        "rental_contract_id, status, attempt_count, rental_invoice_id, error_detail",
      )
      .eq("rental_billing_run_id", billingRunId)
      .in("rental_contract_id", ids.slice(i, i + 100));
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    all.push(...(data ?? []));
  }
  return all;
}

async function callRunner(body) {
  const started = performance.now();
  const response = await fetch(`${url}/functions/v1/rental-billing-runner`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `runner ${response.status}: ${payload?.error ?? JSON.stringify(payload)}`,
    );
  }
  return { payload, durationMs: performance.now() - started };
}

async function tagBillingRunForCleanup(billingRunId, cohortRunId) {
  const { data: run, error: lookupError } = await admin
    .from("rental_billing_runs")
    .select("metadata")
    .eq("workspace_id", "default")
    .eq("id", billingRunId)
    .single();
  if (lookupError || !run) {
    throw new Error(
      `load run cleanup-tag lookup failed: ${lookupError?.message ?? "run missing"}`,
    );
  }
  const { error: updateError } = await admin
    .from("rental_billing_runs")
    .update({
      metadata: { ...(run.metadata ?? {}), load_test_cohort_id: cohortRunId },
    })
    .eq("workspace_id", "default")
    .eq("id", billingRunId);
  if (updateError) {
    throw new Error(`load run cleanup-tag update failed: ${updateError.message}`);
  }
}

async function drain(runId, workerCount, batchSize) {
  const ids = await cohort(runId);
  if (ids.length <= 500) {
    console.error(
      `drain acceptance requires >500 contracts; cohort has ${ids.length}`,
    );
    process.exit(1);
  }

  const workers = Math.max(1, Math.min(8, Math.trunc(workerCount || 2)));
  const batch = Math.max(1, Math.min(100, Math.trunc(batchSize || 25)));
  const wallStarted = performance.now();
  const samples = [];

  // First request creates an explicit acceptance run. auto_continue=false
  // keeps worker count controlled by this harness for reproducible evidence.
  const first = await callRunner({
    workspace_id: "default",
    force_new: true,
    contract_ids: ids,
    batch_size: batch,
    concurrency: 4,
    auto_continue: false,
  });
  samples.push(first);
  const billingRunId = first.payload.run_id;
  if (!billingRunId) throw new Error("runner did not return run_id");
  await tagBillingRunForCleanup(billingRunId, runId);

  let status = first.payload.status;
  let round = 0;
  while (["running", "resumed", "partial"].includes(status)) {
    round++;
    if (round > 200) throw new Error("drain exceeded 200 bounded rounds");

    const roundSamples = await Promise.all(
      Array.from({ length: workers }, () =>
        callRunner({
          run_id: billingRunId,
          workspace_id: "default",
          batch_size: batch,
          concurrency: 4,
          auto_continue: false,
        }),
      ),
    );
    samples.push(...roundSamples);

    const { data: run, error } = await admin
      .from("rental_billing_runs")
      .select(
        "status, examined_count, invoice_count, skipped_count, failed_count, batch_count, resume_count, total_billed_cents, total_tax_cents",
      )
      .eq("id", billingRunId)
      .single();
    if (error || !run) {
      throw new Error(error?.message ?? "billing run disappeared");
    }
    status = run.status;
    if (!["running", "resumed", "partial"].includes(status)) break;
  }

  const wallMs = performance.now() - wallStarted;
  const items = await runItemsFor(ids, billingRunId);
  const nonTerminal = items.filter(
    (item) => !["invoiced", "skipped", "failed"].includes(item.status),
  );
  const failedItems = items.filter((item) => item.status === "failed");
  const invoicesBeforeReplay = await invoicesFor(ids);

  // Replay the same terminal run: claim count must be zero and invoice count
  // must remain unchanged even with the concurrent-worker path enabled.
  const replay = await callRunner({
    run_id: billingRunId,
    workspace_id: "default",
    batch_size: batch,
    concurrency: 4,
    auto_continue: false,
  });
  const invoicesAfterReplay = await invoicesFor(ids);

  const measuredExamined = items.length;
  const measuredPerSecond = measuredExamined / (wallMs / 1000);
  const evidence = {
    cohort_id: runId,
    billing_run_id: billingRunId,
    cohort_contracts: ids.length,
    checkpoint_items: items.length,
    terminal_status: status,
    bounded_http_requests: samples.length,
    http_workers: workers,
    batch_size: batch,
    contract_concurrency_per_request: 4,
    wall_ms: Math.round(wallMs),
    legacy_before: {
      source: "verified handoff measurement",
      ms_per_contract: LEGACY_BASELINE_MS_PER_CONTRACT,
      contracts_per_second: 1000 / LEGACY_BASELINE_MS_PER_CONTRACT,
      silent_ceiling: 500,
    },
    durable_after: {
      contracts_per_second: Number(measuredPerSecond.toFixed(2)),
      ms_per_contract: Number(
        (wallMs / Math.max(measuredExamined, 1)).toFixed(2),
      ),
      speedup_vs_legacy: Number(
        (measuredPerSecond / (1000 / LEGACY_BASELINE_MS_PER_CONTRACT)).toFixed(
          2,
        ),
      ),
      request_p50_ms: percentile(
        samples.map((sample) => sample.durationMs),
        0.5,
      ),
      request_p95_ms: percentile(
        samples.map((sample) => sample.durationMs),
        0.95,
      ),
    },
    failed_items: failedItems.map((item) => ({
      contract_id: item.rental_contract_id,
      error: item.error_detail,
    })),
    replay: {
      claimed: replay.payload.batch?.claimed,
      invoices_before: invoicesBeforeReplay.length,
      invoices_after: invoicesAfterReplay.length,
      status: replay.payload.status,
    },
  };
  console.log(JSON.stringify(evidence, null, 2));

  const ok =
    items.length === ids.length &&
    nonTerminal.length === 0 &&
    failedItems.length === 0 &&
    replay.payload.batch?.claimed === 0 &&
    invoicesBeforeReplay.length === invoicesAfterReplay.length;
  console.log(ok ? "\nBILLING_DRAIN_COMPLETE" : "\nBILLING_DRAIN_FAILED");
  process.exit(ok ? 0 : 1);
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))],
  );
}

async function assertCorrect(runId) {
  const ids = await cohort(runId);
  const invoices = await invoicesFor(ids);
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(
      `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
  };

  check("cohort seeded", ids.length > 0, `${ids.length} contracts`);
  check(
    "one invoice per contract",
    invoices.length === ids.length,
    `${invoices.length} invoices / ${ids.length} contracts`,
  );

  const byContract = new Map();
  for (const inv of invoices) {
    byContract.set(
      inv.rental_contract_id,
      (byContract.get(inv.rental_contract_id) ?? 0) + 1,
    );
  }
  check(
    "no double-invoiced contract",
    [...byContract.values()].every((n) => n === 1),
    `max ${Math.max(0, ...byContract.values())}`,
  );

  const wrongAmount = invoices.filter(
    (inv) => inv.total_cents !== EXPECTED_FIRST_CYCLE_CENTS,
  );
  check(
    "all invoices at optimizer amount",
    wrongAmount.length === 0,
    wrongAmount.length
      ? `${wrongAmount.length} off (expected ${EXPECTED_FIRST_CYCLE_CENTS})`
      : `$${EXPECTED_FIRST_CYCLE_CENTS / 100} each`,
  );

  const numbers = invoices.map((i) => i.invoice_number);
  check(
    "invoice numbers unique (no race)",
    new Set(numbers).size === numbers.length,
    `${numbers.length} numbers, ${new Set(numbers).size} distinct`,
  );

  const posted = invoices.filter((i) => i.status === "posted");
  check(
    "all invoices posted",
    posted.length === invoices.length,
    `${posted.length}/${invoices.length}`,
  );

  const interim = invoices.filter((i) => i.metadata?.kind === "interim");
  check(
    "all invoices interim kind",
    interim.length === invoices.length,
    `${interim.length}/${invoices.length}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? "\nLOAD_TEST_CORRECT"
      : `\n${failed.length} CHECK(S) FAILED`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

async function assertIdempotent(runId) {
  const ids = await cohort(runId);
  const invoices = await invoicesFor(ids);
  const byContract = new Map();
  for (const inv of invoices) {
    byContract.set(
      inv.rental_contract_id,
      (byContract.get(inv.rental_contract_id) ?? 0) + 1,
    );
  }
  const doubled = [...byContract.values()].filter((n) => n > 1).length;
  const ok = invoices.length === ids.length && doubled === 0;
  console.log(
    `${
      ok ? "PASS" : "FAIL"
    } idempotent: ${invoices.length} invoices across ${ids.length} contracts, ${doubled} double-billed`,
  );
  console.log(ok ? "\nLOAD_TEST_IDEMPOTENT" : "\nIDEMPOTENCY FAILED");
  process.exit(ok ? 0 : 1);
}

async function cleanup(runId) {
  const ids = await cohort(runId);
  const now = new Date().toISOString();
  const billingRunIds = new Set();
  const rentalInvoiceIds = new Set();
  const rentalInvoiceNumbers = new Set();
  const customerInvoiceIds = new Set();

  const requireSuccess = (label, result) => {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data ?? [];
  };

  const taggedRuns = requireSuccess(
    "load cleanup tagged-run lookup",
    await admin
      .from("rental_billing_runs")
      .select("id")
      .eq("workspace_id", "default")
      .contains("metadata", { load_test_cohort_id: runId }),
  );
  for (const run of taggedRuns) billingRunIds.add(run.id);

  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const items = requireSuccess(
      "load cleanup billing-item lookup",
      await admin
        .from("rental_billing_run_items")
        .select("rental_billing_run_id")
        .in("rental_contract_id", slice),
    );
    for (const item of items) {
      billingRunIds.add(item.rental_billing_run_id);
    }

    const invoices = requireSuccess(
      "load cleanup rental-invoice lookup",
      await admin
        .from("rental_invoices")
        .select(
          "id, invoice_number, customer_invoice_id, rental_billing_run_id",
        )
        .in("rental_contract_id", slice),
    );
    for (const invoice of invoices) {
      rentalInvoiceIds.add(invoice.id);
      rentalInvoiceNumbers.add(invoice.invoice_number);
      if (invoice.customer_invoice_id) {
        customerInvoiceIds.add(invoice.customer_invoice_id);
      }
      if (invoice.rental_billing_run_id) {
        billingRunIds.add(invoice.rental_billing_run_id);
      }
    }
  }

  // A run header may only be removed when every durable item belongs to this
  // fixture cohort. Abort before mutating anything if a fixture was ever mixed
  // into a user run.
  const fixtureContractIds = new Set(ids);
  const runIds = [...billingRunIds];
  for (let i = 0; i < runIds.length; i += 100) {
    const runItems = requireSuccess(
      "load cleanup run ownership guard",
      await admin
        .from("rental_billing_run_items")
        .select("rental_billing_run_id, rental_contract_id")
        .in("rental_billing_run_id", runIds.slice(i, i + 100)),
    );
    const foreignItems = runItems.filter(
      (item) => !fixtureContractIds.has(item.rental_contract_id),
    );
    if (foreignItems.length > 0) {
      throw new Error(
        `load cleanup blocked: ${foreignItems.length} billing item(s) belong to non-fixture contracts`,
      );
    }
  }

  // Recover pre-m815 orphan AR headers whose backlink write failed. Invoice
  // numbers are workspace-unique for this synthetic cohort and invoice_type
  // keeps unrelated department documents out of cleanup scope.
  const numbers = [...rentalInvoiceNumbers];
  for (let i = 0; i < numbers.length; i += 100) {
    const mirrors = requireSuccess(
      "load cleanup AR mirror lookup",
      await admin
        .from("customer_invoices")
        .select("id, invoice_number, amount_paid")
        .eq("workspace_id", "default")
        .eq("invoice_type", "rental")
        .in("invoice_number", numbers.slice(i, i + 100)),
    );
    for (const mirror of mirrors) {
      if (Number(mirror.amount_paid ?? 0) !== 0) {
        throw new Error(
          `load cleanup blocked: customer invoice ${mirror.invoice_number} has payment activity`,
        );
      }
      customerInvoiceIds.add(mirror.id);
    }
  }

  const customerIds = [...customerInvoiceIds];
  for (let i = 0; i < customerIds.length; i += 100) {
    const slice = customerIds.slice(i, i + 100);
    const jobs = requireSuccess(
      "load cleanup GL lookup",
      await admin
        .from("quickbooks_gl_sync_jobs")
        .select("id, invoice_id, status, quickbooks_txn_id")
        .in("invoice_id", slice),
    );
    const externallyEscaped = jobs.filter(
      (job) =>
        job.status === "processing" ||
        job.status === "posted" ||
        Boolean(job.quickbooks_txn_id),
    );
    if (externallyEscaped.length > 0) {
      throw new Error(
        `load cleanup blocked: ${externallyEscaped.length} fixture GL job(s) reached QuickBooks; reverse them before retrying cleanup`,
      );
    }

    requireSuccess(
      "load cleanup GL delete",
      await admin
        .from("quickbooks_gl_sync_jobs")
        .delete()
        .in("invoice_id", slice),
    );
    requireSuccess(
      "load cleanup AR line delete",
      await admin
        .from("customer_invoice_line_items")
        .delete()
        .in("invoice_id", slice),
    );
    requireSuccess(
      "load cleanup AR header delete",
      await admin.from("customer_invoices").delete().in("id", slice),
    );
  }

  const invoiceIds = [...rentalInvoiceIds];
  for (let i = 0; i < invoiceIds.length; i += 100) {
    requireSuccess(
      "load cleanup exception delete",
      await admin
        .from("exception_queue")
        .delete()
        .eq("entity_table", "rental_invoices")
        .in("entity_id", invoiceIds.slice(i, i + 100)),
    );
  }

  for (let i = 0; i < ids.length; i += 100) {
    requireSuccess(
      "load cleanup contract exception delete",
      await admin
        .from("exception_queue")
        .delete()
        .eq("entity_table", "rental_contracts")
        .in("entity_id", ids.slice(i, i + 100)),
    );
  }

  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    requireSuccess(
      "load cleanup rental-invoice soft delete",
      await admin
        .from("rental_invoices")
        .update({ deleted_at: now })
        .in("rental_contract_id", slice),
    );
    requireSuccess(
      "load cleanup contract soft delete",
      await admin
        .from("rental_contracts")
        .update({ deleted_at: now })
        .in("id", slice),
    );
  }
  for (let i = 0; i < ids.length; i += 100) {
    requireSuccess(
      "load cleanup billing-item delete",
      await admin
        .from("rental_billing_run_items")
        .delete()
        .in("rental_contract_id", ids.slice(i, i + 100)),
    );
  }
  for (let i = 0; i < runIds.length; i += 100) {
    requireSuccess(
      "load cleanup billing-run delete",
      await admin
        .from("rental_billing_runs")
        .delete()
        .in("id", runIds.slice(i, i + 100)),
    );
  }

  for (let i = 0; i < customerIds.length; i += 100) {
    const slice = customerIds.slice(i, i + 100);
    const [headers, lines, jobs] = await Promise.all([
      admin.from("customer_invoices").select("id").in("id", slice),
      admin
        .from("customer_invoice_line_items")
        .select("id")
        .in("invoice_id", slice),
      admin
        .from("quickbooks_gl_sync_jobs")
        .select("id")
        .in("invoice_id", slice),
    ]);
    if (
      requireSuccess("load cleanup AR verification", headers).length > 0 ||
      requireSuccess("load cleanup line verification", lines).length > 0 ||
      requireSuccess("load cleanup GL verification", jobs).length > 0
    ) {
      throw new Error("load cleanup verification found residual AR/GL rows");
    }
  }

  let activeContracts = 0;
  let activeRentalInvoices = 0;
  let residualBillingItems = 0;
  let residualExceptions = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const [contracts, invoices, billingItems, contractExceptions] =
      await Promise.all([
        admin
          .from("rental_contracts")
          .select("id")
          .in("id", slice)
          .is("deleted_at", null),
        admin
          .from("rental_invoices")
          .select("id")
          .in("rental_contract_id", slice)
          .is("deleted_at", null),
        admin
          .from("rental_billing_run_items")
          .select("id")
          .in("rental_contract_id", slice),
        admin
          .from("exception_queue")
          .select("id")
          .eq("entity_table", "rental_contracts")
          .in("entity_id", slice),
      ]);
    activeContracts += requireSuccess(
      "load cleanup contract verification",
      contracts,
    ).length;
    activeRentalInvoices += requireSuccess(
      "load cleanup rental-invoice verification",
      invoices,
    ).length;
    residualBillingItems += requireSuccess(
      "load cleanup billing-item verification",
      billingItems,
    ).length;
    residualExceptions += requireSuccess(
      "load cleanup contract exception verification",
      contractExceptions,
    ).length;
  }
  for (let i = 0; i < invoiceIds.length; i += 100) {
    residualExceptions += requireSuccess(
      "load cleanup invoice exception verification",
      await admin
        .from("exception_queue")
        .select("id")
        .eq("entity_table", "rental_invoices")
        .in("entity_id", invoiceIds.slice(i, i + 100)),
    ).length;
  }

  let residualBillingRuns = 0;
  for (let i = 0; i < runIds.length; i += 100) {
    residualBillingRuns += requireSuccess(
      "load cleanup billing-run verification",
      await admin
        .from("rental_billing_runs")
        .select("id")
        .in("id", runIds.slice(i, i + 100)),
    ).length;
  }
  if (
    activeContracts > 0 ||
    activeRentalInvoices > 0 ||
    residualBillingItems > 0 ||
    residualBillingRuns > 0 ||
    residualExceptions > 0
  ) {
    throw new Error(
      `load cleanup verification found ${activeContracts} active contracts, ${activeRentalInvoices} active rental invoices, ${residualBillingItems} billing items, ${residualBillingRuns} billing runs, and ${residualExceptions} exceptions`,
    );
  }

  console.log(
    `cleaned ${ids.length} contracts, ${rentalInvoiceIds.size} rental invoices, ${customerInvoiceIds.size} AR mirrors, and ${billingRunIds.size} billing runs`,
  );
}

switch (phase) {
  case "seed":
    await seed(Number(process.argv[3] ?? 625));
    break;
  case "drain":
    await drain(
      process.argv[3],
      Number(process.argv[4] ?? 2),
      Number(process.argv[5] ?? 25),
    );
    break;
  case "assert":
    await assertCorrect(process.argv[3]);
    break;
  case "idempotent":
    await assertIdempotent(process.argv[3]);
    break;
  case "cleanup":
    await cleanup(process.argv[3]);
    break;
  default:
    console.error(
      "phase must be one of: seed | drain | assert | idempotent | cleanup",
    );
    process.exit(1);
}
