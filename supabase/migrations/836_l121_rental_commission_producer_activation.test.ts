import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/836_l121_rental_commission_producer_activation.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(name: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("836 L12.1 rental commission producer activation", () => {
  it("accepts only durable AR application or verified Stripe payment evidence", () => {
    const paid = functionSql("rental_activate_paid_invoice_commission");
    expect(paid).toContain(
      "p_payment_source_kind not in ('customer_payment_application', 'stripe_payment_intent')",
    );
    expect(paid).toContain("from public.customer_payment_applications a");
    expect(paid).toContain("join public.customer_payments p");
    expect(paid).toContain("pi.status = 'succeeded'");
    expect(paid).toContain("pi.webhook_signature_verified = true");
    expect(paid).toContain("v_customer.status <> 'paid'");
    expect(paid).toContain("public.rental_record_unit_commission_paid(");
    expect(paid).not.toContain("p_rent_basis_cents");
  });

  it("derives one unit and never guesses a multi-unit allocation", () => {
    expect(compact).toContain(
      "exactly one canonical equipment unit is required; multi-unit rent allocation is not inferred",
    );
    expect(compact).toContain("v_invoice.rental_charge_cents");
    expect(compact).toContain("union select l.equipment_id");
  });

  it("persists approved refund and correction evidence before clawback", () => {
    const adjustment = functionSql("rental_record_approved_rent_adjustment");
    expect(compact).toContain("create table if not exists public.rental_rent_adjustments");
    expect(adjustment).toContain(
      "active finance, manager, admin, or owner approval is required",
    );
    expect(adjustment).toContain(
      "correction must reference an attributable paid commission source",
    );
    expect(adjustment).toContain("insert into public.rental_rent_adjustments");
    expect(adjustment).toContain("public.rental_record_rent_refund_clawback(");
    expect(adjustment).toContain(
      "idempotency key already exists with different rent adjustment evidence",
    );
  });

  it("makes negotiated credit and human approval explicit before posting", () => {
    const conversion = functionSql("rental_approve_conversion_commission");
    expect(conversion).toContain("conversion approval actor and reason are required");
    expect(conversion).toContain("p_negotiated_rent_credit_cents");
    expect(conversion).toContain("public.rental_calculate_conversion_commission(");
    expect(conversion).toContain("public.rental_post_conversion_commission(");
    expect(conversion).toContain("'approval_reason', btrim(p_approval_reason)");
  });

  it("requires two different reviewers for exact legacy payroll evidence", () => {
    const stage = functionSql("rental_stage_legacy_payroll_commission");
    const approve = functionSql("rental_approve_legacy_payroll_commission");
    expect(compact).toContain(
      "create table if not exists public.rental_legacy_payroll_commission_imports",
    );
    expect(compact).toContain(
      "round(rent_basis_cents::numeric * 0.050000)::bigint",
    );
    expect(stage).toContain("source_document_reference");
    expect(stage).toContain("legacy payroll contract, unit, payee, or split provenance is invalid");
    expect(approve).toContain("v_row.staged_by = p_approved_by");
    expect(approve).toContain("legacy payroll import requires a different approver");
    expect(approve).toContain(
      "unit conversion commission is posted; use a finance correction workflow",
    );
    expect(approve).toContain("'legacy_paid_commission'");
    expect(approve).toContain("'rental_commission_paid'");
  });

  it("keeps every producer service-only and source tables non-mutable by callers", () => {
    for (const name of [
      "rental_activate_paid_invoice_commission",
      "rental_record_approved_rent_adjustment",
      "rental_approve_conversion_commission",
      "rental_stage_legacy_payroll_commission",
      "rental_approve_legacy_payroll_commission",
    ]) {
      expect(functionSql(name)).toContain("requires service_role");
    }
    expect(compact).toContain(
      "revoke all on table public.rental_rent_adjustments from public, anon, authenticated",
    );
    expect(compact).toContain(
      "revoke all on table public.rental_legacy_payroll_commission_imports from public, anon, authenticated",
    );
  });

  it("records code activation while retaining the UAT blocker", () => {
    expect(compact).toContain("where task_id = 'l12.1'");
    expect(compact).toContain("blocking_decision = 'blk-rental-commission-uat'");
    expect(compact).toContain("'code_state', 'producer_active_uat_pending'");
    expect(compact).toContain("multi-unit invoice commission allocation remains blocked");
  });
});
