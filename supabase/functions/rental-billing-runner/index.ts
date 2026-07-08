/**
 * rental-billing-runner (Stream L / L5, blueprint §3).
 *
 * Thin I/O wrapper around the PURE planner in shared/rental-billing-core.ts —
 * the TS rate math stays the single canon. Nightly pg_cron (03:40 UTC) +
 * manual invocation with the internal service secret.
 *
 * Per contract: plan → write rental_invoices (per-workspace RENT- number,
 * posted) → mirror an AR-facing customer_invoices row when a portal identity
 * exists (counter-only contracts record a mirror-skip note until the AR
 * id-space unification) → final invoices settle the deposit in metadata.
 * Idempotent: the (contract, period_start, period_end) natural key
 * short-circuits replays. Per-contract failures dead-letter to
 * exception_queue('rental_billing_failed') without aborting the run;
 * rental_billing_runs is the audit spine.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  planNextInvoice,
  type BillingContractSnapshot,
  type BillingLineSnapshot,
  type PriorInvoicesSummary,
  type ReturnChargesSnapshot,
} from "../../../shared/rental-billing-core.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    // Canonical cron/service auth (matches the rest of the internal-secret
    // fleet): Bearer service_role_key OR apikey OR x-internal-service-secret.
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("service-role or internal-service-secret required", 401, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server misconfiguration", 500, origin);
    // deno-lint-ignore no-explicit-any
    const admin: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const today = new Date().toISOString().slice(0, 10);
    const summary = { examined: 0, invoiced: 0, skipped: 0, failed: 0, total_billed_cents: 0 };

    const { data: run, error: runError } = await admin
      .from("rental_billing_runs")
      // triggered_by is a uuid (user id) and null for system runs; the
      // "rental-billing-runner" provenance rides metadata instead.
      .insert({ run_date: today, billing_cycle: "cycle_28_day", status: "running", triggered_by: null, workspace_id: "default", metadata: { triggered_by: "rental-billing-runner" } })
      .select("id")
      .single();
    if (runError || !run) return safeJsonError(runError?.message ?? "Failed to open billing run", 500, origin);

    const { data: contracts, error: contractsError } = await admin
      .from("rental_contracts")
      .select("id, workspace_id, contract_number, contract_type, lifecycle_state, on_rent_at, off_rent_at, returned_at, agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate, delivery_fee_cents, pickup_fee_cents, damage_waiver_accepted, damage_waiver_rate_pct, deposit_status, deposit_amount, portal_customer_id, qrm_company_id")
      .in("lifecycle_state", ["on_rent", "returned"])
      .is("deleted_at", null)
      .limit(500);
    if (contractsError) return safeJsonError(contractsError.message, 500, origin);

    for (const contract of contracts ?? []) {
      summary.examined++;
      try {
        const { data: priorRows } = await admin
          .from("rental_invoices")
          .select("period_end, rental_charge_cents, status, metadata")
          .eq("rental_contract_id", contract.id)
          .is("deleted_at", null)
          .not("status", "in", "(void,reversed)");
        const prior: PriorInvoicesSummary = {
          count: (priorRows ?? []).length,
          last_period_end: (priorRows ?? []).reduce(
            (max: string | null, row: { period_end: string }) =>
              max == null || row.period_end > max ? row.period_end : max,
            null,
          ),
          rental_charge_cents_total: (priorRows ?? []).reduce(
            (sum: number, row: { rental_charge_cents: number | null }) => sum + (row.rental_charge_cents ?? 0),
            0,
          ),
          has_final_invoice: (priorRows ?? []).some(
            (row: { metadata: { kind?: string } | null }) => row.metadata?.kind === "final",
          ),
        };

        const { data: lines } = await admin
          .from("rental_contract_lines")
          .select("included_hours, outbound_meter_hours, return_meter_hours, overage_hourly_rate_cents")
          .eq("rental_contract_id", contract.id)
          .is("deleted_at", null);

        const { data: returnRow } = await admin
          .from("rental_returns")
          .select("fuel_charge_cents, cleaning_charge_cents, damage_charge_cents, environmental_fee_cents, damage_disposition")
          .eq("rental_contract_id", contract.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const plan = planNextInvoice(
          contract as BillingContractSnapshot,
          (lines ?? []) as BillingLineSnapshot[],
          prior,
          (returnRow ?? null) as ReturnChargesSnapshot | null,
          today,
        );
        if (!plan) { summary.skipped++; continue; }

        // Idempotency: the (contract, period) natural key short-circuits.
        const { data: existing } = await admin
          .from("rental_invoices")
          .select("id")
          .eq("rental_contract_id", contract.id)
          .eq("period_start", plan.period_start)
          .eq("period_end", plan.period_end)
          .is("deleted_at", null)
          .maybeSingle();
        if (existing) { summary.skipped++; continue; }

        const { data: numberData } = await admin.rpc("next_rental_invoice_number", {
          p_workspace_id: contract.workspace_id,
        });
        const invoiceNumber = (numberData as string | null) ?? `RENT-${Date.now()}`;

        const c = plan.charges;
        const depositCents = plan.kind === "final" && contract.deposit_status === "paid"
          ? Math.round((contract.deposit_amount ?? 0) * 100)
          : 0;
        const depositApplied = Math.min(depositCents, c.subtotal_cents);

        const { data: invoice, error: invoiceError } = await admin
          .from("rental_invoices")
          .insert({
            workspace_id: contract.workspace_id,
            rental_contract_id: contract.id,
            rental_billing_run_id: run.id,
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
            // Tax is a per-workspace profile concern (owner obligation 5b):
            // taxable computed here; rate resolution delegates to the
            // jurisdiction machinery when the workspace profile is configured.
            taxable_amount_cents: c.subtotal_cents,
            tax_cents: 0,
            total_cents: c.subtotal_cents,
            amount_paid_cents: depositApplied,  // balance_cents is generated
            status: "posted",
            posted_at: new Date().toISOString(),
            due_date: today,
            metadata: {
              kind: plan.kind,
              billable_days: plan.billable_days,
              billed_as: plan.base.segments,
              rate_optimizer_fired: plan.base.fired,
              beaten_alternative: plan.base.beaten_alternative,
              deposit_applied_cents: depositApplied,
              tax_profile: "workspace-unresolved",
            },
          })
          .select("id")
          .single();
        if (invoiceError || !invoice) throw new Error(invoiceError?.message ?? "invoice insert failed");

        // AR mirror: requires a portal identity today (customer_invoices is
        // portal-anchored); counter-only contracts note the skip.
        if (contract.portal_customer_id) {
          const { data: pc } = await admin
            .from("portal_customers")
            .select("id, crm_company_id")
            .eq("id", contract.portal_customer_id)
            .maybeSingle();
          if (pc) {
            await admin.from("customer_invoices").insert({
              workspace_id: contract.workspace_id,
              portal_customer_id: pc.id,
              crm_company_id: pc.crm_company_id,
              invoice_number: invoiceNumber,
              due_date: today,
              description: `Rental ${plan.kind} invoice · ${contract.contract_number ?? contract.id} · ${plan.period_start} → ${plan.period_end}`,
              amount: (c.subtotal_cents - depositApplied) / 100,
              total: (c.subtotal_cents - depositApplied) / 100,
              status: "pending",
            });
          }
        }

        summary.invoiced++;
        summary.total_billed_cents += c.subtotal_cents;
      } catch (err) {
        summary.failed++;
        await admin.rpc("enqueue_exception", {
          p_source: "rental_billing_failed",
          p_title: `Rental billing failed for ${contract.contract_number ?? contract.id}`,
          p_severity: "error",
          p_detail: err instanceof Error ? err.message : String(err),
          p_payload: { rental_contract_id: contract.id, run_id: run.id },
          p_entity_table: "rental_contracts",
          p_entity_id: contract.id,
        });
      }
    }

    await admin
      .from("rental_billing_runs")
      .update({
        status: summary.failed > 0 && summary.invoiced === 0 ? "failed" : "completed",
        invoice_count: summary.invoiced,
        total_billed_cents: summary.total_billed_cents,
        completed_at: new Date().toISOString(),
        metadata: { ...summary, triggered_by: "rental-billing-runner" },
      })
      .eq("id", run.id);

    return safeJsonOk({ run_id: run.id, ...summary }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "rental-billing-runner", req });
    console.error("rental-billing-runner:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
