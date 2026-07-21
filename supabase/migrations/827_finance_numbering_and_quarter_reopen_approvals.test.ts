import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/827_finance_numbering_and_quarter_reopen_approvals.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("827 finance numbering + quarter approvals", () => {
  it("mints five-digit E/R/P/W numbers from one counter table", () => {
    expect(compact).toContain("create or replace function public.next_invoice_number");
    expect(compact).toContain("when 'service' then 'w'");
    expect(compact).toContain("lpad(v_next::text, 5, '0')");
    expect(compact).toContain("values ( p_workspace_id, p_branch_legacy_code, v_dept_prefix, 1 )");
    expect(compact).toContain("existing counters are never reset");
  });

  it("binds invoice minting to caller workspace and finance role", () => {
    expect(compact).toContain(
      "p_workspace_id is distinct from v_caller_workspace",
    );
    expect(compact).toContain("not public.qep_finance_can_mutate()");
    expect(compact).toContain("branch code % is not registered in workspace %");
    expect(compact).toContain(
      "revoke all on function public.next_invoice_number(text, text, text) from public, anon, authenticated",
    );
  });

  it("delegates both compatibility wrappers to the canonical generator", () => {
    expect(compact).toContain(
      "v_invoice_number := public.next_invoice_number( p_workspace_id, v_branch_code, v_invoice_type )",
    );
    expect(compact).toContain("when 's' then 'service'");
    expect(compact).toContain("then 'w' else v_department_code");
  });

  it("requires named Ryan and Tina approval slots", () => {
    expect(compact).toContain("'quarter_reopen', 'owner', 'ryan mckenzie'");
    expect(compact).toContain(
      "'quarter_reopen', 'finance_controller', 'tina mckenzie'",
    );
    expect(compact).toContain("finance_approval_principals");
    expect(compact).toContain("3162f130-021a-45d4-a13c-be98f357a38b");
    expect(compact).toContain(
      "revoke insert, update, delete on public.finance_approval_principals",
    );
    expect(compact).not.toContain(
      'create policy "finance_approval_principals_owner_mutate"',
    );
    expect(compact).not.toContain("lower(p.full_name)");
  });

  it("records two independent attestations before execution", () => {
    expect(compact).toContain("create table if not exists public.quarter_reopen_requests");
    expect(compact).toContain("create table if not exists public.quarter_reopen_approvals");
    expect(compact).toContain("unique (request_id, approval_role)");
    expect(compact).toContain("unique (request_id, approver_id)");
    expect(compact).toContain("v_approve_count = 2");
    expect(compact).toContain("two independent recorded approvals");
  });

  it("removes the old authenticated one-call reopen path", () => {
    expect(compact).toContain(
      "revoke all on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated",
    );
    expect(compact).toContain(
      "grant execute on function public.reopen_gl_quarter(uuid, uuid, uuid, text, jsonb) to service_role",
    );
    expect(compact).toContain("execute_gl_quarter_reopen");
  });
});
