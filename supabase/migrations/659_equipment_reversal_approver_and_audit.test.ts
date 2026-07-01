import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "659_equipment_reversal_approver_and_audit.sql",
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

describe("659_equipment_reversal_approver_and_audit.sql contract", () => {
  it("wraps the migration in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("creates the equipment_reversal_audit table with the required columns and action check", () => {
    expect(compactSql).toContain(
      "create table if not exists public.equipment_reversal_audit",
    );
    expect(compactSql).toContain("id uuid primary key default gen_random_uuid()");
    expect(compactSql).toContain(
      "workspace_id text not null default public.get_my_workspace()",
    );
    expect(compactSql).toContain("reversal_id text");
    expect(compactSql).toContain("stock_number text");
    expect(compactSql).toContain("original_invoice_id uuid");
    expect(compactSql).toContain("credit_memo_id uuid");
    expect(compactSql).toContain(
      "action text not null check (action in ('approved', 'rejected', 'executed'))",
    );
    expect(compactSql).toContain(
      "approver_id uuid references public.profiles(id)",
    );
    expect(compactSql).toContain("approver_role text");
    expect(compactSql).toContain("reason text");
    expect(compactSql).toContain("outcome text");
    expect(compactSql).toContain("detail jsonb not null default '{}'::jsonb");
    expect(compactSql).toContain("created_at timestamptz not null default now()");
  });

  it("indexes the audit table for workspace timeline and stock-number lookup", () => {
    expect(compactSql).toContain(
      "create index if not exists idx_equipment_reversal_audit_workspace_created on public.equipment_reversal_audit (workspace_id, created_at desc)",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_equipment_reversal_audit_stock_number on public.equipment_reversal_audit (stock_number)",
    );
  });

  it("enables RLS and scopes audit visibility to manager+ with wrapped helpers", () => {
    expect(compactSql).toContain(
      "alter table public.equipment_reversal_audit enable row level security",
    );
    // Wrapped helper refs (RLS init-plan safe).
    expect(compactSql).toContain("(select public.get_my_workspace())");
    expect(compactSql).toContain("(select public.get_my_role())");
    // Select policy: same workspace AND manager roles.
    expect(compactSql).toContain(
      "create policy \"equipment_reversal_audit_manager_select\"",
    );
    expect(compactSql).toContain(
      "(select public.get_my_role()) in ('admin', 'manager', 'owner')",
    );
    // Insert policy for same workspace + manager roles.
    expect(compactSql).toContain(
      "create policy \"equipment_reversal_audit_manager_insert\"",
    );
  });

  it("assert_reversal_approver returns the role and gates on ('manager','owner')", () => {
    const fn = compact(functionSql("assert_reversal_approver"));
    expect(fn).toContain("returns text");
    expect(fn).toContain("security definer");
    // Reads a specific user's role from profiles by id (not get_my_role()).
    expect(fn).toContain("from public.profiles p");
    expect(fn).toContain("where p.id = p_approver_id");
    expect(fn).toContain("not in ('manager', 'owner')");
    expect(fn).toContain(
      "raise exception 'reversal requires sales manager or iron manager approval'",
    );
    expect(fn).toContain("return v_role");
  });

  it("audit_equipment_reversal inserts a row and returns its id, security definer", () => {
    const fn = compact(functionSql("audit_equipment_reversal"));
    expect(fn).toContain("returns uuid");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public");
    expect(fn).toContain("insert into public.equipment_reversal_audit");
    expect(fn).toContain("returning id into v_audit_id");
    expect(fn).toContain("return v_audit_id");
  });

  it("wrapper asserts approver, delegates to the base RPC, and audits every outcome", () => {
    const fn = compact(functionSql("reverse_equipment_sale_with_approval"));
    // Same base params plus p_approver_id.
    expect(fn).toContain("p_approver_id uuid default null");
    expect(fn).toContain("returns jsonb");
    // (a) approval gate reads the approver's role by id (not get_my_role),
    // writes a 'rejected' audit row, and returns approved:false WITHOUT raising
    // (raising would roll back the rejected audit row in the same transaction).
    expect(fn).toContain("from public.profiles p");
    expect(fn).toContain("v_approver_role not in ('manager', 'owner')");
    expect(fn).toContain("'rejected'");
    expect(fn).toContain("'approved', false");
    // The wrapper itself must NOT re-raise (that would discard the audit row).
    expect(fn).not.toContain("raise;");
    // (b) delegates to the untouched 540 base function.
    expect(fn).toContain(
      "from public.reverse_equipment_sale_by_stock_number(",
    );
    // (c) executed audit row.
    expect(fn).toContain("'executed'");
    // Returns the required jsonb summary.
    expect(fn).toContain("'reversal_id', v_result.reversal_id");
    expect(fn).toContain("'credit_memo_id', v_result.credit_memo_id");
    expect(fn).toContain("'approver_role', v_approver_role");
  });

  it("does not alter the base 540 function signature", () => {
    expect(compactSql).not.toContain(
      "create or replace function public.reverse_equipment_sale_by_stock_number",
    );
  });

  it("grants execute on the new RPCs to authenticated and service_role only", () => {
    expect(compactSql).toContain(
      "revoke execute on function public.reverse_equipment_sale_with_approval",
    );
    expect(compactSql).toContain(
      "grant execute on function public.reverse_equipment_sale_with_approval(text, text, text, text, text, text, uuid, uuid, uuid, uuid) to authenticated",
    );
    expect(compactSql).toContain(
      "grant execute on function public.assert_reversal_approver(uuid) to authenticated",
    );
  });

  it("keeps the JARVIS persona out of the migration copy", () => {
    expect(compactSql).not.toContain("jarvis");
  });
});
