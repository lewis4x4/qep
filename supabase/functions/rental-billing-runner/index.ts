/**
 * rental-billing-runner (Stream L / L5, blueprint §3).
 *
 * Thin I/O wrapper around the PURE planner in shared/rental-billing-core.ts —
 * the TS rate math stays the single canon. Nightly pg_cron (03:40 UTC) +
 * manual invocation with the internal service secret. Each request claims a
 * bounded durable batch; continuation requests drain the stable run cohort
 * without holding one HTTP request open for the whole fleet.
 *
 * Per contract: plan → write rental_invoices (per-workspace RENT- number,
 * posted) → mirror an AR-facing customer_invoices row when a portal identity
 * exists (counter-only contracts record a mirror-skip note until the AR
 * id-space unification) → final invoices settle the deposit in metadata.
 * Idempotent: an active (contract, period_start, period_end) unique index
 * arbitrates concurrent workers after the read-before-write fast path.
 * Per-contract failures dead-letter to
 * exception_queue('rental_billing_failed') without aborting the run;
 * rental_billing_runs + rental_billing_run_items are the audit/checkpoint spine.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  aggregateReturnCharges,
  type BillingContractSnapshot,
  type BillingLineSnapshot,
  planNextInvoice,
  type PriorInvoicesSummary,
  type RentalReturnAssessmentSnapshot,
} from "../../../shared/rental-billing-core.ts";
import {
  mintRentalInvoiceNumber,
  mirrorRentalInvoiceToAR,
  resolveNumberingBranch,
  resolveRentalTax,
} from "../_shared/rental-finance.ts";
import { clampInteger, mapWithConcurrency } from "./batch-core.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

type RentalContractRow = BillingContractSnapshot & {
  workspace_id: string;
  deposit_status: string | null;
  deposit_amount: number | null;
  portal_customer_id: string | null;
  qrm_company_id: string | null;
  branch_id: string | null;
  ship_to_address_id: string | null;
  tax_sourcing_method: string | null;
};

type ClaimedItem = {
  item_id: string;
  rental_contract_id: string;
  claim_attempt_count: number;
};

type ItemOutcome =
  | { status: "skipped"; reason: string }
  | {
    status: "invoiced";
    invoice_id: string;
    billed_cents: number;
    tax_cents: number;
    mirror_skipped: boolean;
  };

type RunTotals = {
  billing_run_id: string;
  run_status: "partial" | "completed" | "failed" | "running" | "resumed";
  total_items: number;
  examined_count: number;
  invoiced_count: number;
  skipped_count: number;
  failed_count: number;
  processing_count: number;
  pending_count: number;
  claimable_count: number;
  mirror_skipped_count: number;
  total_billed_cents: number;
  total_tax_cents: number;
  batch_count: number;
  resume_count: number;
};

function firstRow<T>(data: T[] | T | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function completeItem(
  admin: AdminClient,
  itemId: string,
  workerToken: string,
  outcome: ItemOutcome | { status: "failed"; reason: string },
): Promise<boolean> {
  const { data, error } = await admin.rpc("complete_rental_billing_item", {
    p_item_id: itemId,
    p_worker_token: workerToken,
    p_status: outcome.status,
    p_invoice_id: outcome.status === "invoiced" ? outcome.invoice_id : null,
    p_billed_cents: outcome.status === "invoiced" ? outcome.billed_cents : 0,
    p_tax_cents: outcome.status === "invoiced" ? outcome.tax_cents : 0,
    p_mirror_skipped: outcome.status === "invoiced"
      ? outcome.mirror_skipped
      : false,
    p_error_detail: outcome.status === "invoiced" ? null : outcome.reason,
  });
  if (error) throw new Error(`billing checkpoint failed: ${error.message}`);
  return data === true;
}

async function processContract(
  admin: AdminClient,
  contract: RentalContractRow,
  runId: string,
  itemId: string,
  workerToken: string,
  today: string,
): Promise<ItemOutcome> {
  const { data: priorRows, error: priorError } = await admin
    .from("rental_invoices")
    .select("period_end, rental_charge_cents, status, metadata")
    .eq("workspace_id", contract.workspace_id)
    .eq("rental_contract_id", contract.id)
    .is("deleted_at", null)
    .not("status", "in", "(void,reversed)");
  if (priorError) {
    throw new Error(`prior invoice lookup failed: ${priorError.message}`);
  }

  const prior: PriorInvoicesSummary = {
    count: (priorRows ?? []).length,
    last_period_end: (priorRows ?? []).reduce(
      (max: string | null, row: { period_end: string }) =>
        max == null || row.period_end > max ? row.period_end : max,
      null,
    ),
    rental_charge_cents_total: (priorRows ?? []).reduce(
      (sum: number, row: { rental_charge_cents: number | null }) =>
        sum + (row.rental_charge_cents ?? 0),
      0,
    ),
    has_final_invoice: (priorRows ?? []).some(
      (row: { metadata: { kind?: string } | null }) =>
        row.metadata?.kind === "final",
    ),
  };

  const { data: lines, error: linesError } = await admin
    .from("rental_contract_lines")
    .select(
      "included_hours, outbound_meter_hours, return_meter_hours, overage_hourly_rate_cents",
    )
    .eq("workspace_id", contract.workspace_id)
    .eq("rental_contract_id", contract.id)
    .is("deleted_at", null);
  if (linesError) {
    throw new Error(`contract line lookup failed: ${linesError.message}`);
  }

  // Every physical unit can carry its own return assessment. Query all
  // contract/workspace rows and let the pure core select the latest assessment
  // per equipment (plus one explicit legacy NULL-equipment bucket).
  const { data: returnRows, error: returnRowsError } = await admin
    .from("rental_returns")
    .select(
      "id, workspace_id, rental_contract_id, equipment_id, created_at, updated_at, deleted_at, fuel_charge_cents, cleaning_charge_cents, damage_charge_cents, environmental_fee_cents, damage_disposition",
    )
    .eq("rental_contract_id", contract.id)
    .eq("workspace_id", contract.workspace_id)
    .is("deleted_at", null);
  if (returnRowsError) {
    throw new Error(`return charge lookup failed: ${returnRowsError.message}`);
  }

  const returnAggregation = aggregateReturnCharges(
    (returnRows ?? []) as RentalReturnAssessmentSnapshot[],
    { contract_id: contract.id, workspace_id: contract.workspace_id },
  );
  const plan = planNextInvoice(
    contract,
    (lines ?? []) as BillingLineSnapshot[],
    prior,
    returnAggregation.charges,
    today,
  );
  if (!plan) return { status: "skipped", reason: "nothing due" };

  // Read-before-write avoids wasting an invoice number on normal replays. The
  // migration-811 unique index remains the final concurrent-worker arbiter.
  const { data: existing, error: existingError } = await admin
    .from("rental_invoices")
    .select(
      "id, rental_billing_run_id, taxable_amount_cents, tax_cents, total_cents, customer_invoice_id",
    )
    .eq("workspace_id", contract.workspace_id)
    .eq("rental_contract_id", contract.id)
    .eq("period_start", plan.period_start)
    .eq("period_end", plan.period_end)
    .is("deleted_at", null)
    .not("status", "in", "(void,reversed)")
    .maybeSingle();
  if (existingError) {
    throw new Error(
      `invoice idempotency lookup failed: ${existingError.message}`,
    );
  }
  if (existing) {
    // A worker can crash after the invoice commits but before its durable item
    // checkpoint commits. When the same run reclaims that lease, recover the
    // real invoice as `invoiced` so run totals remain money-truthful. An
    // invoice owned by another run remains an ordinary idempotent skip.
    if (existing.rental_billing_run_id === runId) {
      const taxCents = Math.max(0, Number(existing.tax_cents ?? 0));
      const billedCents = Math.max(
        0,
        Number(existing.taxable_amount_cents ?? existing.total_cents ?? 0) -
          (existing.taxable_amount_cents == null ? taxCents : 0),
      );
      return {
        status: "invoiced",
        invoice_id: String(existing.id),
        billed_cents: billedCents,
        tax_cents: taxCents,
        mirror_skipped: existing.customer_invoice_id == null,
      };
    }
    return { status: "skipped", reason: "contract period already invoiced" };
  }

  const branch = await resolveNumberingBranch(
    admin,
    contract.workspace_id,
    contract.branch_id,
  );
  const invoiceNumber = await mintRentalInvoiceNumber(
    admin,
    contract.workspace_id,
    branch,
  );
  const c = plan.charges;
  const periodLabel = `${plan.period_start} → ${plan.period_end}`;
  const tax = await resolveRentalTax(
    admin,
    contract.workspace_id,
    contract,
    c.subtotal_cents,
    branch,
    periodLabel,
  );
  const totalCents = c.subtotal_cents + tax.taxCents;
  const depositCents =
    plan.kind === "final" && contract.deposit_status === "paid"
      ? Math.round((contract.deposit_amount ?? 0) * 100)
      : 0;
  const depositApplied = Math.min(depositCents, totalCents);

  const { data: invoiceData, error: invoiceError } = await admin.rpc(
    "post_rental_invoice_for_billing_item",
    {
      p_item_id: itemId,
      p_worker_token: workerToken,
      p_invoice: {
        workspace_id: contract.workspace_id,
        rental_contract_id: contract.id,
        rental_billing_run_id: runId,
        invoice_number: invoiceNumber,
        period_start: plan.period_start,
        period_end: plan.period_end,
        billing_cycle: "cycle_28_day",
        rental_charge_cents: c.rental_charge_cents,
        overage_charge_cents: c.overage_charge_cents,
        delivery_charge_cents: c.delivery_charge_cents,
        pickup_charge_cents: c.pickup_charge_cents,
        damage_waiver_charge_cents: c.damage_waiver_charge_cents,
        fuel_charge_cents: c.fuel_charge_cents,
        cleaning_charge_cents: c.cleaning_charge_cents,
        damage_charge_cents: c.damage_charge_cents,
        other_charge_cents: c.other_charge_cents,
        discount_cents: c.discount_cents,
        taxable_amount_cents: c.subtotal_cents,
        tax_cents: tax.taxCents,
        total_cents: totalCents,
        amount_paid_cents: depositApplied,
        status: "posted",
        posted_at: new Date().toISOString(),
        due_date: today,
        ship_to_address_id: tax.shipToAddressId,
        tax_jurisdiction_id: tax.jurisdictionId,
        tax_breakdown: tax.breakdown,
        dr15_county_name: tax.county,
        dr15_reporting_period: plan.period_end,
        metadata: {
          kind: plan.kind,
          billable_days: plan.billable_days,
          billed_as: plan.base.segments,
          rate_optimizer_fired: plan.base.fired,
          beaten_alternative: plan.base.beaten_alternative,
          deposit_applied_cents: depositApplied,
          tax_profile: contract.tax_sourcing_method ?? "destination_ship_to",
          ...(plan.kind === "final"
            ? {
              source_return_ids: returnAggregation.billed_return_ids,
              return_charge_audit: {
                aggregation_strategy: "latest_assessment_per_equipment_v1",
                selected_return_ids: returnAggregation.selected_return_ids,
                superseded_return_ids: returnAggregation.superseded_return_ids,
                legacy_null_equipment_return_id:
                  returnAggregation.legacy_null_equipment_return_id,
                sources: returnAggregation.sources,
              },
            }
            : {}),
        },
      },
    },
  );
  const postedInvoice = firstRow<{ invoice_id: string }>(invoiceData);
  const invoice = postedInvoice ? { id: postedInvoice.invoice_id } : null;

  if (invoiceError || !invoice) {
    if (invoiceError?.code === "23505") {
      const { data: winner } = await admin
        .from("rental_invoices")
        .select(
          "id, rental_billing_run_id, taxable_amount_cents, tax_cents, total_cents, customer_invoice_id",
        )
        .eq("workspace_id", contract.workspace_id)
        .eq("rental_contract_id", contract.id)
        .eq("period_start", plan.period_start)
        .eq("period_end", plan.period_end)
        .is("deleted_at", null)
        .not("status", "in", "(void,reversed)")
        .maybeSingle();
      if (winner) {
        if (winner.rental_billing_run_id === runId) {
          const taxCents = Math.max(0, Number(winner.tax_cents ?? 0));
          const billedCents = Math.max(
            0,
            Number(winner.taxable_amount_cents ?? winner.total_cents ?? 0) -
              (winner.taxable_amount_cents == null ? taxCents : 0),
          );
          return {
            status: "invoiced",
            invoice_id: String(winner.id),
            billed_cents: billedCents,
            tax_cents: taxCents,
            mirror_skipped: winner.customer_invoice_id == null,
          };
        }
        return {
          status: "skipped",
          reason: "concurrent worker won contract period",
        };
      }
    }
    throw new Error(invoiceError?.message ?? "invoice insert failed");
  }

  if (tax.warning) {
    await admin.rpc("enqueue_exception", {
      p_source: "tax_failed",
      p_title: `Rental invoice ${invoiceNumber} tax degraded (${
        tax.warning.split(":")[0]
      })`,
      p_severity: "warn",
      p_detail: tax.warning,
      p_payload: {
        rental_invoice_id: invoice.id,
        rental_contract_id: contract.id,
        run_id: runId,
      },
      p_entity_table: "rental_invoices",
      p_entity_id: invoice.id,
    });
  }

  let portalCustomerId: string | null = null;
  let crmCompanyId: string | null = contract.qrm_company_id ?? null;
  if (contract.portal_customer_id) {
    const { data: pc } = await admin
      .from("portal_customers")
      .select("id, crm_company_id")
      .eq("id", contract.portal_customer_id)
      .maybeSingle();
    if (pc) {
      portalCustomerId = pc.id as string;
      crmCompanyId = crmCompanyId ??
        ((pc.crm_company_id as string | null) ?? null);
    }
  }

  let mirrorSkipped = false;
  if (!portalCustomerId && !crmCompanyId) {
    mirrorSkipped = true;
    await admin.rpc("enqueue_exception", {
      p_source: "rental_billing_failed",
      p_title:
        `Rental invoice ${invoiceNumber} has no AR anchor — not mirrored`,
      p_severity: "error",
      p_detail: `Contract ${
        contract.contract_number ?? contract.id
      } carries neither portal_customer_id nor qrm_company_id; the invoice posted in rental_invoices but is invisible to AR aging until an anchor is set and the mirror is backfilled.`,
      p_payload: {
        rental_invoice_id: invoice.id,
        rental_contract_id: contract.id,
        run_id: runId,
      },
      p_entity_table: "rental_invoices",
      p_entity_id: invoice.id,
    });
  } else {
    try {
      const mirror = await mirrorRentalInvoiceToAR(admin, {
        workspaceId: contract.workspace_id,
        rentalInvoiceId: invoice.id as string,
        invoiceNumber,
        description: `Rental ${plan.kind} invoice · ${
          contract.contract_number ?? contract.id
        } · ${periodLabel}`,
        portalCustomerId,
        crmCompanyId,
        amountDollars: c.subtotal_cents / 100,
        taxDollars: tax.taxCents / 100,
        amountPaidDollars: depositApplied / 100,
        dueDate: today,
        branchSlug: branch?.slug ?? null,
        tax,
        enqueueGl: true,
      });
      for (const warning of mirror.warnings) {
        console.error(`rental mirror warning (${invoiceNumber}):`, warning);
      }
    } catch (error) {
      // The rental invoice is already posted and remains the money truth. A
      // downstream AR mirror outage must be loud but cannot relabel that real
      // invoice as an unissued/failed item (or invite a duplicate retry).
      mirrorSkipped = true;
      const detail = `AR mirror failed after rental invoice posted: ${
        errorMessage(error)
      }`;
      console.error(`rental mirror failed (${invoiceNumber}):`, detail);
      await admin.rpc("enqueue_exception", {
        p_source: "rental_billing_failed",
        p_title: `Rental invoice ${invoiceNumber} AR mirror failed`,
        p_severity: "error",
        p_detail: detail,
        p_payload: {
          rental_invoice_id: invoice.id,
          rental_contract_id: contract.id,
          run_id: runId,
        },
        p_entity_table: "rental_invoices",
        p_entity_id: invoice.id,
      });
    }
  }

  return {
    status: "invoiced",
    invoice_id: invoice.id as string,
    billed_cents: c.subtotal_cents,
    tax_cents: tax.taxCents,
    mirror_skipped: mirrorSkipped,
  };
}

function scheduleContinuation(
  req: Request,
  input: {
    runId: string;
    workspaceId: string;
    batchSize: number;
    concurrency: number;
    leaseSeconds: number;
  },
): boolean {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["authorization", "apikey", "x-internal-service-secret"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const continuation = fetch(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      run_id: input.runId,
      workspace_id: input.workspaceId,
      batch_size: input.batchSize,
      concurrency: input.concurrency,
      lease_seconds: input.leaseSeconds,
      auto_continue: true,
    }),
  }).then(async (response) => {
    if (!response.ok) {
      console.error(
        "rental billing continuation failed:",
        response.status,
        await response.text(),
      );
    }
  }).catch((error) => {
    console.error(
      "rental billing continuation dispatch failed:",
      errorMessage(error),
    );
  });

  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(continuation);
    return true;
  }
  // Local Deno lacks EdgeRuntime; starting the promise still makes manual/local
  // smoke useful, while the response's has_more flag is the explicit fallback.
  void continuation;
  return false;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    // Canonical cron/service auth (matches the rest of the internal-secret
    // fleet): Bearer service_role_key OR apikey OR x-internal-service-secret.
    if (!isServiceRoleCaller(req)) {
      return safeJsonError(
        "service-role or internal-service-secret required",
        401,
        origin,
      );
    }

    if (req.method !== "POST") {
      return safeJsonError("POST required", 405, origin);
    }

    let body: Record<string, unknown> = {};
    const rawBody = await req.text();
    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return safeJsonError("JSON object required", 400, origin);
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return safeJsonError("Invalid JSON body", 400, origin);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError("Server misconfiguration", 500, origin);
    }
    const admin: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const today = new Date().toISOString().slice(0, 10);
    const workspaceId =
      typeof body.workspace_id === "string" && body.workspace_id.trim()
        ? body.workspace_id.trim()
        : "default";
    const requestedRunId = typeof body.run_id === "string" && body.run_id.trim()
      ? body.run_id.trim()
      : null;
    const batchSize = clampInteger(body.batch_size, 25, 1, 100);
    const concurrency = clampInteger(body.concurrency, 4, 1, 8);
    const leaseSeconds = clampInteger(body.lease_seconds, 120, 30, 600);
    const autoContinue = body.auto_continue !== false;
    const forceNew = requestedRunId == null && body.force_new === true;
    const contractIds = Array.isArray(body.contract_ids)
      ? body.contract_ids.filter((value): value is string =>
        typeof value === "string" && value.trim().length > 0
      ).map((value) => value.trim())
      : null;
    if (contractIds && contractIds.length > 2_000) {
      return safeJsonError("contract_ids is limited to 2000 rows", 400, origin);
    }

    const { data: startData, error: startError } = await admin.rpc(
      "start_or_resume_rental_billing_run",
      {
        p_workspace_id: workspaceId,
        p_batch_size: batchSize,
        p_run_id: requestedRunId,
        p_force_new: forceNew,
        p_contract_ids: contractIds,
      },
    );
    const run = firstRow<{
      billing_run_id: string;
      run_status: string;
      created_new: boolean;
      total_items: number;
    }>(startData);
    if (startError || !run) {
      return safeJsonError(
        startError?.message ?? "Failed to open billing run",
        500,
        origin,
      );
    }

    const runId = run.billing_run_id;
    const workerToken = crypto.randomUUID();
    const batchStartedAt = performance.now();
    const { data: claimData, error: claimError } = await admin.rpc(
      "claim_rental_billing_batch",
      {
        p_run_id: runId,
        p_worker_token: workerToken,
        p_batch_size: batchSize,
        p_lease_seconds: leaseSeconds,
      },
    );
    if (claimError) return safeJsonError(claimError.message, 500, origin);
    const claims = (claimData ?? []) as ClaimedItem[];

    let contracts: RentalContractRow[] = [];
    if (claims.length > 0) {
      const { data, error } = await admin
        .from("rental_contracts")
        .select(
          "id, workspace_id, contract_number, contract_type, lifecycle_state, on_rent_at, off_rent_at, returned_at, agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate, delivery_fee_cents, pickup_fee_cents, damage_waiver_accepted, damage_waiver_rate_pct, deposit_status, deposit_amount, portal_customer_id, qrm_company_id, branch_id, ship_to_address_id, tax_sourcing_method",
        )
        .eq("workspace_id", workspaceId)
        .in("id", claims.map((claim) => claim.rental_contract_id))
        .is("deleted_at", null);
      if (error) return safeJsonError(error.message, 500, origin);
      contracts = (data ?? []) as RentalContractRow[];
    }
    const contractsById = new Map(
      contracts.map((contract) => [contract.id, contract]),
    );

    const results = await mapWithConcurrency(
      claims,
      Math.min(concurrency, Math.max(claims.length, 1)),
      async (claim): Promise<ItemOutcome> => {
        const contract = contractsById.get(claim.rental_contract_id);
        if (!contract) {
          return {
            status: "skipped",
            reason:
              "contract removed or soft-deleted after run cohort creation",
          };
        }
        return await processContract(
          admin,
          contract,
          runId,
          claim.item_id,
          workerToken,
          today,
        );
      },
    );

    const batch = {
      examined: 0,
      invoiced: 0,
      skipped: 0,
      failed: 0,
      mirror_skipped: 0,
      total_billed_cents: 0,
      total_tax_cents: 0,
      stale_completions: 0,
      checkpoint_errors: 0,
    };

    for (let index = 0; index < claims.length; index++) {
      const claim = claims[index];
      const result = results[index];
      batch.examined++;
      if (result.status === "fulfilled") {
        const outcome = result.value;
        if (outcome.status === "invoiced") {
          batch.invoiced++;
          batch.total_billed_cents += outcome.billed_cents;
          batch.total_tax_cents += outcome.tax_cents;
          if (outcome.mirror_skipped) batch.mirror_skipped++;
        } else {
          batch.skipped++;
        }
        try {
          if (!await completeItem(admin, claim.item_id, workerToken, outcome)) {
            batch.stale_completions++;
          }
        } catch (error) {
          batch.checkpoint_errors++;
          console.error("rental billing item checkpoint:", errorMessage(error));
        }
        continue;
      }

      batch.failed++;
      const detail = errorMessage(result.reason);
      const contract = contractsById.get(claim.rental_contract_id);
      const { error: deadLetterError } = await admin.rpc("enqueue_exception", {
        p_source: "rental_billing_failed",
        p_title: `Rental billing failed for ${
          contract?.contract_number ?? claim.rental_contract_id
        }`,
        p_severity: "error",
        p_detail: detail,
        p_payload: {
          rental_contract_id: claim.rental_contract_id,
          run_id: runId,
          item_id: claim.item_id,
          attempt_count: claim.claim_attempt_count,
        },
        p_entity_table: "rental_contracts",
        p_entity_id: claim.rental_contract_id,
      });
      if (deadLetterError) {
        console.error(
          "rental billing dead-letter failed:",
          deadLetterError.message,
        );
      }
      try {
        if (
          !await completeItem(admin, claim.item_id, workerToken, {
            status: "failed",
            reason: detail,
          })
        ) {
          batch.stale_completions++;
        }
      } catch (error) {
        batch.checkpoint_errors++;
        console.error(
          "rental billing failed-item checkpoint:",
          errorMessage(error),
        );
      }
    }

    const { data: totalsData, error: totalsError } = await admin.rpc(
      "finalize_rental_billing_run",
      { p_run_id: runId },
    );
    const totals = firstRow<RunTotals>(totalsData);
    if (totalsError || !totals) {
      return safeJsonError(
        totalsError?.message ?? "Failed to checkpoint billing run",
        500,
        origin,
      );
    }

    const hasMore = totals.pending_count + totals.processing_count > 0;
    const continuationScheduled = autoContinue && totals.claimable_count > 0
      ? scheduleContinuation(req, {
        runId,
        workspaceId,
        batchSize,
        concurrency,
        leaseSeconds,
      })
      : false;

    return safeJsonOk({
      run_id: runId,
      protocol: "durable_batch_v1",
      created_new: run.created_new,
      status: totals.run_status,
      has_more: hasMore,
      continuation_scheduled: continuationScheduled,
      batch: {
        ...batch,
        claimed: claims.length,
        concurrency: claims.length === 0
          ? 0
          : Math.min(concurrency, claims.length),
        duration_ms: Math.round(performance.now() - batchStartedAt),
      },
      totals,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "rental-billing-runner", req });
    console.error("rental-billing-runner:", err);
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("Origin"),
    );
  }
});
