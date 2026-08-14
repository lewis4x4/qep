import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const edgeSource = readFileSync(
  join(process.cwd(), "supabase/functions/rental-ops/index.ts"),
  "utf8",
);
const webApiSource = readFileSync(
  join(process.cwd(), "apps/web/src/features/qrm/lib/rental-ops-api.ts"),
  "utf8",
);
const stripeReconcileSource = readFileSync(
  join(
    process.cwd(),
    "supabase/functions/_shared/portal-stripe-reconcile.ts",
  ),
  "utf8",
);
const compactEdge = edgeSource.replace(/\s+/g, " ");

describe("L12.1 rental commission producer contract", () => {
  it("exposes only the five approved producer workflows", () => {
    for (const action of [
      "activate_paid_invoice_commission",
      "record_rent_refund_credit",
      "approve_conversion_commission",
      "record_commission_correction",
      "stage_legacy_payroll_commission",
      "approve_legacy_payroll_commission",
    ]) {
      expect(edgeSource).toContain(`action: "${action}"`);
      expect(edgeSource).toContain(`body.action === "${action}"`);
    }

    for (const rpc of [
      "rental_activate_paid_invoice_commission",
      "rental_record_approved_rent_adjustment",
      "rental_approve_conversion_commission",
      "rental_stage_legacy_payroll_commission",
      "rental_approve_legacy_payroll_commission",
    ]) {
      expect(edgeSource).toContain(`admin.rpc("${rpc}"`);
    }
  });

  it("requires canonical payment evidence and never accepts a caller-supplied rent basis", () => {
    expect(compactEdge).toContain(
      '["customer_payment_application", "stripe_payment_intent"].includes(body.payment_source_kind ?? "")',
    );
    expect(compactEdge).toContain("p_payment_source_id: paymentSourceId");
    expect(compactEdge).not.toMatch(
      /activate_paid_invoice_commission[\s\S]{0,1000}p_rent_basis_cents/,
    );
    expect(stripeReconcileSource).toContain(
      '"rental_activate_paid_invoice_commission"',
    );
    expect(stripeReconcileSource).toContain(
      'p_payment_source_kind: "stripe_payment_intent"',
    );
    expect(stripeReconcileSource).toContain("p_actor_id: null");
  });

  it("fails closed on missing refund, correction, conversion, and legacy evidence", () => {
    for (const marker of [
      "positive refunded_rent_cents",
      "corrects_source_event_key",
      "nonnegative negotiated_rent_credit_cents",
      "payroll/source references",
      "import_id and approval_reason required",
    ]) {
      expect(edgeSource).toContain(marker);
    }
    expect(compactEdge).toContain('p_corrects_source_event_key: null');
    expect(compactEdge).toContain('p_source_kind: "correction"');
  });

  it("keeps financial and conversion approvals role-gated at the edge", () => {
    expect(compactEdge).toContain(
      '["finance_admin", "manager", "admin", "owner"].includes(auth.role)',
    );
    expect(compactEdge).toContain(
      '["manager", "admin", "owner"].includes(auth.role)',
    );
    expect(compactEdge).toContain(
      '["finance_admin", "admin", "owner"].includes(auth.role)',
    );
  });

  it("publishes typed client contracts without adding an unapproved UI mutation", () => {
    for (const method of [
      "activatePaidInvoiceCommission",
      "recordRentRefundCredit",
      "recordCommissionCorrection",
      "approveConversionCommission",
      "stageLegacyPayrollCommission",
      "approveLegacyPayrollCommission",
    ]) {
      expect(webApiSource).toContain(`${method}:`);
    }
  });
});
