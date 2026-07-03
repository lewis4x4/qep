import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "677_g91_cores_returns_warranty_parts.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("677_g91_cores_returns_warranty_parts.sql contract", () => {
  it("prints the G9 return and warranty policy on receipts", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_return_policy_receipt_text",
    );
    expect(compactSql).toContain("30-day window");
    expect(compactSql).toContain("electrical parts are non-returnable");
    expect(compactSql).toContain("25% restocking fee");
    expect(compactSql).toContain("vendor-credit hold");
    expect(compactSql).toContain(
      "add column if not exists return_policy_receipt_text",
    );
  });

  it("extends customer returns with deterministic policy state", () => {
    expect(compactSql).toContain("alter table public.customer_returns");
    expect(compactSql).toContain("'late_return'");
    expect(compactSql).toContain(
      "add column if not exists vendor_credit_required boolean not null default false",
    );
    expect(compactSql).toContain(
      "add column if not exists original_line_total_cents bigint not null default 0",
    );
    expect(compactSql).toContain(
      "add constraint customer_returns_g91_policy_shape_ck",
    );
    expect(compactSql).toContain("idx_customer_returns_g91_vendor_hold");
  });

  it("evaluates 30-day, electrical, late, and special-order return rules", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_evaluate_customer_return_policy",
    );
    expect(compactSql).toContain(
      "v_requested_at::date > v_eligible_until",
    );
    expect(compactSql).toContain(
      "v_policy := 'electrical_non_returnable'",
    );
    expect(compactSql).toContain("v_policy := 'vendor_credit_hold'");
    expect(compactSql).toContain(
      "v_fee_cents := round(v_original_cents::numeric * 0.25)::bigint",
    );
    expect(compactSql).toContain("v_policy := 'late_return'");
  });

  it("creates governed customer returns instead of raw table-only policy", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_create_customer_return",
    );
    expect(compactSql).toContain("public.qep_parts_operator_role()");
    expect(compactSql).toContain("return_is_special_order");
    expect(compactSql).toContain("return_is_electrical");
    expect(compactSql).toContain("source', 'parts_create_customer_return");
    expect(compactSql).toContain("'blocked_vendor_credit'");
  });

  it("releases special-order customer holds only after vendor RA credit", () => {
    expect(compactSql).toContain("alter table public.vendor_returns");
    expect(compactSql).toContain(
      "add column if not exists vendor_credit_confirmed_at timestamptz",
    );
    expect(compactSql).toContain(
      "create or replace function public.parts_confirm_vendor_return_credit",
    );
    expect(compactSql).toContain("status = 'credited'");
    expect(compactSql).toContain("customer_hold_released_at");
    expect(compactSql).toContain("refund_status = case");
  });

  it("records bidirectional core ledger movements", () => {
    expect(compactSql).toContain("alter table public.core_ledger");
    expect(compactSql).toContain(
      "add column if not exists customer_return_id uuid references public.customer_returns",
    );
    expect(compactSql).toContain(
      "add column if not exists vendor_return_id uuid references public.vendor_returns",
    );
    expect(compactSql).toContain(
      "add constraint core_ledger_g91_bidirectional_amount_ck",
    );
    expect(compactSql).toContain(
      "create or replace function public.parts_record_core_ledger_movement",
    );
    expect(compactSql).toContain("'customer_core_credit'");
    expect(compactSql).toContain("'vendor_core_credit'");
  });

  it("enforces warranty evaluation and replacement payment decisions", () => {
    expect(compactSql).toContain("alter table public.warranty_claims");
    expect(compactSql).toContain(
      "add column if not exists manufacturer_evaluation_status text not null default 'required'",
    );
    expect(compactSql).toContain(
      "add constraint warranty_claims_g91_credit_after_evaluation_ck",
    );
    expect(compactSql).toContain(
      "create or replace function public.parts_apply_warranty_replacement_policy",
    );
    expect(compactSql).toContain("manufacturer_evaluation_required_before_credit");
    expect(compactSql).toContain("service warranties require certified technician confirmation");
    expect(compactSql).toContain("'paid_up_front'");
    expect(compactSql).toContain("'order_after_credit'");
  });

  it("marks G9.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g9.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain(
      "g91_cores_returns_warranty_parts_shipped",
    );
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("holds, credits, and replacement-payment timing");
  });
});
