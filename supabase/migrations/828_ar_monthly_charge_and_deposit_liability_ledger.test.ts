import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/828_ar_monthly_charge_and_deposit_liability_ledger.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();
const portalStripe = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/portal-stripe-reconcile.ts"),
  "utf8",
);
const equipmentInvoice = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/equipment-invoice.ts"),
  "utf8",
);
const rentalBilling = readFileSync(
  join(process.cwd(), "supabase/functions/rental-billing-runner/index.ts"),
  "utf8",
);

describe("828 monthly AR charge + deposit liability ledger", () => {
  it("reserves one original-invoice finance charge before money", () => {
    expect(compact).toContain("charge_period date");
    expect(compact).toContain("uq_ar_dunning_finance_charge_month");
    expect(compact).toContain(
      "insert into public.ar_dunning_events ( workspace_id, crm_company_id, invoice_id",
    );
    expect(compact.indexOf("returning id into v_charge_event_id")).toBeLessThan(
      compact.indexOf("insert into public.customer_invoices ("),
    );
    expect(compact).toContain(
      "coalesce(ci.invoice_source_code, '') <> 'finance_charge'",
    );
  });

  it("requires a full monthly cadence across calendar boundaries", () => {
    expect(compact).toContain(
      "prior.cycle_date + interval '1 month' > p_cycle_date::timestamp",
    );
    expect(compact).toContain(
      "normal ar dunning runs must use current_date",
    );
  });

  it("locks the current balance and uses canonical branch numbering", () => {
    expect(compact).toContain("v_batch_limit constant integer := 250");
    expect(compact).toContain(
      "order by cursor_pass, coalesce(ci.due_date, 'infinity'::date), ci.created_at, ci.id limit v_batch_limit for update of ci skip locked",
    );
    expect(compact).toContain("ar_dunning_invoice_cycle_claims");
    expect(compact).toContain("claim_order integer not null");
    expect(compact).toContain("uq_ar_dunning_invoice_cycle_claims_run_order");
    expect(compact).toContain(
      "on conflict (workspace_id, cycle_date, invoice_id) do nothing",
    );
    expect(compact).toContain("claim.statement_run_id = v_statement_run_id");
    expect(compact).toContain("'claimed_invoices', v_claimed_count");
    expect(compact).toContain("'has_more', v_has_more");
    expect(compact).toContain("into v_locked_balance, v_locked_status");
    expect(compact).toContain("for update;");
    expect(compact).toContain("public.qep_next_finance_invoice_number(");
    expect(compact).toContain("qep_invoice_number, branch_id, deal_id");
    expect(compact).toContain(
      "no finance-charge event or receivable was created",
    );
  });

  it("rotates durable invoice and workspace cursors through bounded cron turns", () => {
    expect(compact).toContain(
      "create table if not exists public.ar_dunning_workspace_cursors",
    );
    expect(compact).toContain(
      "hashtextextended('ar-dunning:' || p_workspace_id, 0)",
    );
    expect(compact).toContain(
      "when coalesce(ci.due_date, 'infinity'::date) > v_cursor_due_date then 0",
    );
    expect(compact).toContain(
      "set last_due_date = v_last_due_date, last_created_at = v_last_created_at, last_invoice_id = v_last_invoice_id",
    );
    expect(compact).toContain(
      "drained_cycle_date = case when v_has_more then null else p_cycle_date end",
    );
    expect(compact).toContain(
      "v_workspace_batch_limit constant integer := 1",
    );
    expect(compact).toContain(
      "where cursor.drained_cycle_date is distinct from current_date",
    );
    expect(compact).toContain("limit v_workspace_batch_limit");
    expect(compact).toContain("'*/5 * * * *'");
  });

  it("keeps compounding off without dated legal evidence", () => {
    expect(compact).toContain("ar_finance_charge_policy_approvals");
    expect(compact).toContain("no row is seeded by the owner packet");
    expect(compact).toContain("and coalesce(v_policy.compounding_allowed, false)");
    expect(compact).toContain(
      "case when v_compounding_active then v_policy.id else null end",
    );
    expect(compact).toContain(
      "v_settings.ar_finance_charge_rate_pct, v_lawful_annual_cap / 12.0",
    );
  });

  it("never mints an unratified general finance-charge number", () => {
    expect(compact).toContain("finance charge skipped: invoice department is unclassified");
    expect(compact).toContain("'ar_finance_charge_department'");
    expect(compact).not.toContain("else 'g' end;");
  });

  it("makes legal evidence append-only and separately revocable", () => {
    expect(compact).toContain(
      "create policy \"ar_finance_charge_policy_owner_insert\"",
    );
    expect(compact).toContain(
      "revoke update, delete, truncate on table public.ar_finance_charge_policy_approvals",
    );
    expect(compact).toContain(
      "create or replace function public.revoke_ar_finance_charge_policy_approval",
    );
    expect(compact).toContain("revocation requires a reason");
    expect(compact).toContain("p_revoked_by uuid");
    expect(compact).toContain(
      "revocation actor must match the signed-in owner",
    );
    expect(compact).toContain(
      "revocation actor must be an active workspace owner",
    );
    expect(compact).toContain("revoked_by = p_revoked_by");
    expect(compact).toContain(
      "revoke_ar_finance_charge_policy_approval(text, uuid, text, uuid)",
    );
  });

  it("uses one append-only ledger for sale and rental deposit liabilities", () => {
    expect(compact).toContain("customer_deposit_ledger_entries");
    expect(compact).toContain("'sale_deposit', 'rental_security'");
    expect(compact).toContain("liability_delta_cents bigint generated always as");
    expect(compact).toContain("customer_deposit_ledger_block_mutation");
    expect(compact).toContain("customer_deposit_liability_reconciliation");
    expect(compact).toContain(
      "revoke insert, update, delete, truncate on table public.customer_deposit_ledger_entries",
    );
    expect(compact).toContain(
      "revoke insert, update, delete, truncate on table public.ar_dunning_events",
    );
  });

  it("serializes balance math and rejects negative liabilities", () => {
    expect(compact).toContain("deposit-ledger-key:");
    expect(compact).toContain("deposit-ledger-source:");
    expect(compact).toContain("v_current_balance_cents + v_requested_delta_cents < 0");
    expect(compact).toContain("deposit liability cannot become negative");
    expect(compact).toContain(
      ") to service_role; -- atomic stripe/manual sale-deposit receipt boundary",
    );
  });

  it("binds linked money and refunds to workspace-safe evidence", () => {
    expect(compact).toContain("customer invoice is outside the deposit workspace");
    expect(compact).toContain("rental return is outside the deposit workspace");
    expect(compact).toContain("refund requires the original payment method");
    expect(compact).toContain(
      "sale deposit and customer invoice must belong to the same deal",
    );
    expect(compact).toContain(
      "rental return must belong to the source contract",
    );
    expect(compact).toContain(
      "deposit refund must use the original payment method",
    );
    expect(compact).toContain(
      "idempotency key already belongs to a different deposit entry",
    );
    expect(compact).toContain(
      "v_existing.entry_date is distinct from v_entry_date",
    );
    expect(compact).toContain(
      "is distinct from v_normalized_memo",
    );
    expect(compact).toContain(
      "v_existing.metadata is distinct from v_normalized_metadata",
    );
    expect(compact).toContain("sale deposit deal is outside the requested workspace");
    expect(compact).toContain("customer invoice deal is outside the deposit workspace");
  });

  it("allows one exact sale receipt and requires audited cash before application", () => {
    expect(compact).toContain("sale deposit receipt must equal the required amount");
    expect(compact).toContain(
      "sale deposit receipt already exists with different payment evidence",
    );
    expect(compact).toContain(
      "v_existing_receipt.idempotency_key is distinct from trim(p_idempotency_key)",
    );
    expect(compact).toContain(
      "(v_existing_receipt.metadata ->> 'received_at')::timestamptz is distinct from p_received_at",
    );
    expect(compact).toContain(
      "v_deposit.received_at is distinct from p_received_at",
    );
    expect(compact).toContain("'idempotent_replay', true");
    expect(compact).toContain("has no audited liability receipt");
    expect(compact).not.toContain("legacy-sale-deposit-receipt:");
  });

  it("applies only to active original equipment invoices with unique IDs", () => {
    expect(compact).toContain(
      "sale deposits may apply only to an active original equipment invoice",
    );
    expect(compact).toContain(
      "sale deposit application requires one or more unique non-null deposit ids",
    );
    expect(compact).toContain("v_invoice.status in ('void', 'reversed')");
    expect(compact).toContain("v_invoice.reversal_of_invoice_id is not null");
  });

  it("wires sale receipts, sale applications, and rental final mirrors", () => {
    expect(compact).toContain(
      "create or replace function public.record_sale_deposit_receipt",
    );
    expect(compact).toContain(
      "create or replace function public.apply_sale_deposits_to_invoice",
    );
    expect(compact).toContain(
      "create trigger trg_rental_deposit_liability_on_mirror",
    );
    expect(compact).toContain("rental-deposit-apply:");
    expect(portalStripe).toContain('"record_sale_deposit_receipt"');
    expect(equipmentInvoice).toContain('"apply_sale_deposits_to_invoice"');
    expect(rentalBilling).toContain(
      "Migration 828's trigger",
    );
    expect(rentalBilling).not.toContain(
      '.update({ deposit_status: nextDepositStatus })',
    );
    expect(equipmentInvoice).toContain("amount_paid: 0");
    expect(compact).toContain("v_application_cents := least(");
    expect(compact).toContain("v_remaining_invoice_cents");
    expect(compact).toContain("invoice_amount_paid_cents");
    expect(compact).toContain("v_contract.deposit_status is distinct from 'paid'");
    expect(compact).toContain(
      "paid rental deposit lacks a fully paid same-workspace deposit invoice",
    );
    expect(compact).toContain("v_deposit_invoice.portal_customer_id is distinct from v_contract.portal_customer_id");
    expect(compact).toContain("'apply_damage'");
    expect(compact).toContain("rental-deposit-damage:");
    expect(compact).toContain("damage application lacks complete source-return evidence");
    expect(equipmentInvoice).toContain('.eq("workspace_id", workspaceId)');
    expect(portalStripe).toContain('"deal_company_mismatch"');
    expect(portalStripe).toContain('from("exception_queue")');
    expect(compact).toContain(
      "uq_exception_stripe_sale_deposit_reconciliation_open",
    );
    expect(compact).toContain(
      "payload ->> 'exception_subtype' = 'stripe_sale_deposit_reconciliation'",
    );
    expect(portalStripe).toContain('exceptionError.code === "23505"');
  });

  it("persists exact partial sale-deposit application state", () => {
    expect(compact).toContain("'partially_applied'");
    expect(compact).toContain("add column if not exists applied_amount");
    expect(compact).toContain("else 'partially_applied'");
    expect(compact).toContain("d.required_amount - d.applied_amount");
  });

  it("does not call absent and unledgered sources reconciled", () => {
    expect(compact).toContain("when coalesce(l.entry_count, 0) = 0 then 'unledgered_source'");
    expect(compact).toContain("then 'orphan_ledger'");
    expect(compact).toContain("then 'wrong_liability_account'");
    expect(compact).toContain("when c.deposit_status is null and not c.deposit_required then 0::bigint");
  });
});
