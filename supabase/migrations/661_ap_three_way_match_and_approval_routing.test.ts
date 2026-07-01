import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "661_ap_three_way_match_and_approval_routing.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(functionName: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("661_ap_three_way_match_and_approval_routing.sql contract", () => {
  it("wraps the whole migration in a transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });

  it("creates the greenfield goods receipt header and lines", () => {
    expect(compactSql).toContain("create table if not exists public.goods_receipts");
    expect(compactSql).toContain(
      "workspace_id text not null default public.get_my_workspace()",
    );
    expect(compactSql).toContain(
      "purchase_order_id uuid references public.vendor_purchase_orders(id) on delete set null",
    );
    expect(compactSql).toContain(
      "received_by uuid references public.profiles(id) on delete set null",
    );
    expect(compactSql).toContain("unique (workspace_id, receipt_number)");

    expect(compactSql).toContain("create table if not exists public.goods_receipt_lines");
    expect(compactSql).toContain(
      "goods_receipt_id uuid references public.goods_receipts(id) on delete cascade",
    );
    expect(compactSql).toContain(
      "purchase_order_line_id uuid references public.vendor_purchase_order_lines(id)",
    );
    expect(compactSql).toContain("quantity_received numeric(12, 2) not null default 0");
    expect(compactSql).toContain(
      "idx_goods_receipt_lines_receipt on public.goods_receipt_lines (workspace_id, goods_receipt_id)",
    );
  });

  it("adds purchase_order_id and match_status to vendor_invoices", () => {
    expect(compactSql).toContain(
      "add column if not exists purchase_order_id uuid references public.vendor_purchase_orders(id) on delete set null",
    );
    expect(compactSql).toContain(
      "add column if not exists match_status text not null default 'unmatched'",
    );
    expect(compactSql).toContain(
      "check (match_status in ('unmatched', 'matched', 'price_mismatch', 'quantity_mismatch', 'partial'))",
    );
  });

  it("creates the approval matrix and per-invoice approval steps", () => {
    expect(compactSql).toContain("create table if not exists public.ap_approval_matrix");
    expect(compactSql).toContain("min_amount numeric(14, 2) not null default 0");
    expect(compactSql).toContain("required_role text not null");
    expect(compactSql).toContain("sequence int not null default 1");
    expect(compactSql).toContain("active boolean not null default true");
    expect(compactSql).toContain(
      "unique (workspace_id, min_amount, required_role, sequence)",
    );

    expect(compactSql).toContain("create table if not exists public.ap_invoice_approvals");
    expect(compactSql).toContain(
      "vendor_invoice_id uuid references public.vendor_invoices(id) on delete cascade",
    );
    expect(compactSql).toContain(
      "status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'skipped'))",
    );
    expect(compactSql).toContain(
      "idx_ap_invoice_approvals_invoice on public.ap_invoice_approvals (workspace_id, vendor_invoice_id)",
    );
  });

  it("seeds the Section 9.3 threshold ladder idempotently", () => {
    expect(compactSql).toContain(
      "insert into public.ap_approval_matrix (workspace_id, min_amount, max_amount, required_role, sequence, active)",
    );
    expect(compactSql).toContain("('default', 0, 5000, 'manager', 1, true)");
    expect(compactSql).toContain("('default', 5000, 25000, 'manager', 1, true)");
    expect(compactSql).toContain("('default', 5000, 25000, 'owner', 2, true)");
    expect(compactSql).toContain("('default', 25000, null, 'owner', 1, true)");
    expect(compactSql).toContain("('default', 25000, null, 'admin', 2, true)");
    expect(compactSql).toContain(
      "on conflict (workspace_id, min_amount, required_role, sequence) do nothing",
    );
  });

  it("creates the AP payment ledger", () => {
    expect(compactSql).toContain("create table if not exists public.ap_payments");
    expect(compactSql).toContain("amount numeric(14, 2) not null check (amount > 0)");
    expect(compactSql).toContain(
      "vendor_invoice_id uuid references public.vendor_invoices(id) on delete set null",
    );
    expect(compactSql).toContain(
      "idx_ap_payments_invoice on public.ap_payments (workspace_id, vendor_invoice_id)",
    );
  });

  it("enables RLS on every new table with workspace-scoped select and elevated writes", () => {
    for (const table of [
      "goods_receipts",
      "goods_receipt_lines",
      "ap_approval_matrix",
      "ap_invoice_approvals",
      "ap_payments",
    ]) {
      expect(compactSql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(compactSql).toContain(
        `on public.${table} for select using (workspace_id = (select public.get_my_workspace()))`,
      );
    }
    // Write policies gate to elevated roles via wrapped helper refs.
    expect(compactSql).toContain(
      "(select public.get_my_role()) in ('admin', 'manager', 'owner')",
    );
    expect(compactSql).toContain("(select public.get_my_workspace())");
  });

  it("evaluate_three_way_match returns mismatch statuses within a documented tolerance", () => {
    const fn = compact(functionSql("evaluate_three_way_match"));
    expect(fn).toContain("returns text");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    // Reconciles all three legs.
    expect(fn).toContain("from public.vendor_purchase_order_lines pol");
    expect(fn).toContain("from public.goods_receipt_lines grl");
    // Cents -> dollars normalization for PO unit cost.
    expect(fn).toContain("unit_cost_cents), 0)::numeric(14, 2) / 100");
    // Documented tolerance.
    expect(fn).toContain("v_tolerance := greatest(1.00, round(v_ordered_value * 0.01, 2))");
    // Emits the specific mismatch statuses.
    expect(fn).toContain("v_match_status := 'quantity_mismatch'");
    expect(fn).toContain("v_match_status := 'price_mismatch'");
    expect(fn).toContain("v_match_status := 'matched'");
    expect(fn).toContain("v_match_status := 'partial'");
    // Drives both match_status and hold_status.
    expect(fn).toContain("set match_status = v_match_status");
    expect(fn).toContain("hold_status = case");
  });

  it("route_ap_invoice_for_approval reads the matrix and parks on approval hold", () => {
    const fn = compact(functionSql("route_ap_invoice_for_approval"));
    expect(fn).toContain("returns integer");
    expect(fn).toContain("from public.ap_approval_matrix m");
    expect(fn).toContain("v_amount >= m.min_amount");
    expect(fn).toContain("m.max_amount is null or v_amount < m.max_amount");
    expect(fn).toContain("insert into public.ap_invoice_approvals");
    // Idempotent: skips already-materialized steps.
    expect(fn).toContain(
      "on conflict (workspace_id, vendor_invoice_id, required_role, sequence) do nothing",
    );
    expect(fn).toContain("set hold_status = 'approval_pending'");
  });

  it("record_ap_payment is the double-pay guard: locks FOR UPDATE and RAISEs on already-paid", () => {
    const fn = compact(functionSql("record_ap_payment"));
    expect(fn).toContain("returns uuid");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    // Locks the invoice row.
    expect(fn).toContain("from public.vendor_invoices where id = p_vendor_invoice_id for update");
    // Double-pay guard raises.
    expect(fn).toContain("raise exception 'invoice already fully paid'");
    expect(fn).toContain("raise exception 'payment amount % exceeds outstanding balance %'");
    // Approval-pending blocks payment.
    expect(fn).toContain("raise exception 'invoice requires approval before payment'");
    expect(fn).toContain(
      "select 1 from public.ap_invoice_approvals where vendor_invoice_id = p_vendor_invoice_id and status = 'pending'",
    );
    // Writes ledger and advances state.
    expect(fn).toContain("insert into public.ap_payments");
    expect(fn).toContain("set amount_paid = v_new_paid");
    expect(fn).toContain(
      "status = case when (v_amount - v_new_paid) <= 0 then 'paid' else 'partial' end",
    );
  });

  it("has a BEFORE INSERT trigger that re-checks balance on direct inserts", () => {
    const fn = compact(functionSql("fn_ap_payments_guard_balance"));
    expect(fn).toContain("returns trigger");
    expect(fn).toContain("from public.vendor_invoices where id = new.vendor_invoice_id for update");
    expect(fn).toContain("raise exception 'invoice already fully paid'");
    expect(compactSql).toContain(
      "create trigger trg_ap_payments_guard_balance before insert on public.ap_payments",
    );
  });
});
