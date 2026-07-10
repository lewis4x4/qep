import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "811_rental_billing_resumable_batches.sql",
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
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("811 rental billing durable batch contract", () => {
  it("adds an active-return soft-delete contract for corrected assessments", () => {
    expect(compactSql).toContain(
      "alter table public.rental_returns add column if not exists deleted_at timestamptz",
    );
    expect(compactSql).toContain(
      "create index if not exists idx_rental_returns_active_contract_equipment",
    );
    expect(compactSql).toContain("where deleted_at is null");
  });

  it("persists a checkpoint row for every contract without a global ceiling", () => {
    const start = functionSql("start_or_resume_rental_billing_run");
    expect(compactSql).toContain(
      "create table if not exists public.rental_billing_run_items",
    );
    expect(compactSql).toContain(
      "unique (rental_billing_run_id, rental_contract_id)",
    );
    expect(start).toContain("from public.rental_contracts c");
    expect(start).toContain(
      "c.lifecycle_state in ('on_rent', 'off_rent', 'returned')",
    );
    expect(start).toContain(
      "p_contract_ids is null or c.id = any(p_contract_ids)",
    );
    expect(start).toContain("order by c.id");
    expect(start).not.toContain("limit 500");
  });

  it("claims stable bounded batches with leases and SKIP LOCKED", () => {
    const claim = functionSql("claim_rental_billing_batch");
    expect(claim).toContain("order by i.rental_contract_id asc, i.id asc");
    expect(claim).toContain("limit v_limit");
    expect(claim).toContain("for update skip locked");
    expect(claim).toContain(
      "i.status = 'processing' and i.lease_expires_at is not null and i.lease_expires_at <= now()",
    );
    expect(claim).toContain("worker_token = p_worker_token");
    expect(claim).toContain("attempt_count = i.attempt_count + 1");
  });

  it("prevents stale workers and concurrent contract-period duplicates", () => {
    const post = functionSql("post_rental_invoice_for_billing_item");
    const complete = functionSql("complete_rental_billing_item");
    expect(post).toContain("from public.rental_billing_run_items i");
    expect(post).toContain("for update");
    expect(post).toContain(
      "v_item.status <> 'processing' or v_item.worker_token is distinct from p_worker_token",
    );
    expect(post).toContain("insert into public.rental_invoices");
    expect(post).toContain("update public.rental_billing_run_items i");
    expect(post.indexOf("insert into public.rental_invoices")).toBeLessThan(
      post.indexOf("update public.rental_billing_run_items i"),
    );
    expect(complete).toContain(
      "and i.worker_token = p_worker_token",
    );
    expect(complete).toContain("and i.rental_invoice_id = p_invoice_id");
    expect(compactSql).toContain(
      "create unique index if not exists uq_rental_invoices_active_contract_period",
    );
    expect(compactSql).toContain(
      "on public.rental_invoices (rental_contract_id, period_start, period_end)",
    );
    expect(compactSql).toContain("'void'::public.rental_invoice_status");
    expect(compactSql).toContain("'reversed'::public.rental_invoice_status");
  });

  it("posts only a current contract and a canonically reconciled money payload", () => {
    const post = functionSql("post_rental_invoice_for_billing_item");
    expect(post.indexOf("from public.rental_billing_runs r")).toBeLessThan(
      post.indexOf("select i.* into v_item"),
    );
    expect(post).toContain("v_run.status not in ('running', 'partial', 'resumed')");
    expect(post).toContain("from public.rental_contracts c");
    expect(post).toContain("c.workspace_id = v_item.workspace_id");
    expect(post).toContain("c.deleted_at is null");
    expect(post).toContain("invoice cents fields must be nonnegative");
    expect(post).toContain(
      "invoice cents do not reconcile to canonical charge, tax, and payment totals",
    );
    expect(post).toContain("<> v_charge_sum - coalesce");
    expect(post).toContain("+ coalesce((p_invoice ->> 'tax_cents')::bigint, 0)");
  });

  it("records partial, resumed, completed, and failed run truth", () => {
    const claim = functionSql("claim_rental_billing_batch");
    const finalize = functionSql("finalize_rental_billing_run");
    expect(compactSql).toContain(
      "'draft', 'running', 'partial', 'resumed', 'completed', 'failed', 'rolled_back'",
    );
    expect(claim).toContain(
      "case when r.batch_count = 0 then 'running' else 'resumed' end",
    );
    expect(claim).toContain(
      "resume_count = r.resume_count + case when r.batch_count = 0 then 0 else 1 end",
    );
    expect(finalize).toContain(
      "when v_pending + v_processing > 0 then 'partial'",
    );
    expect(finalize).toContain("when v_failed > 0 then 'failed'");
    expect(finalize).toContain("else 'completed'");
    expect(finalize).toContain(
      "examined_count = v_invoiced + v_skipped + v_failed",
    );
  });

  it("keeps all queue mutation RPCs service-role-only and workspace scoped", () => {
    for (
      const functionName of [
        "start_or_resume_rental_billing_run",
        "claim_rental_billing_batch",
        "post_rental_invoice_for_billing_item",
        "complete_rental_billing_item",
        "finalize_rental_billing_run",
      ]
    ) {
      expect(functionSql(functionName)).toContain(
        "auth.role()) is distinct from 'service_role'",
      );
    }
    expect(compactSql).toContain(
      'create policy "rental_billing_run_items_service_all"',
    );
    expect(compactSql).toContain(
      'create policy "rental_billing_run_items_internal_read"',
    );
    expect(compactSql).toContain(
      "workspace_id = (select public.get_my_workspace())",
    );
    expect(compactSql).toContain(
      "revoke execute on function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb) from public, anon, authenticated",
    );
  });
});
