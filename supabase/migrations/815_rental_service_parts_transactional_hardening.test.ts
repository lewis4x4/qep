import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "815_rental_service_parts_transactional_hardening.sql",
);
const sql = readFileSync(migrationPath, "utf8");
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

describe("815 rental and service-parts transactional hardening", () => {
  it("quarantines deterministic duplicate active periods before rebuilding uniqueness", () => {
    const escapedGuard = compact.indexOf(
      "rental_duplicate_period_financially_escaped",
    );
    const quarantine = compact.indexOf(
      "insert into public.rental_invoice_period_quarantine",
    );
    const retire = compact.indexOf(
      "set status = 'void'::public.rental_invoice_status",
    );
    const unique = compact.indexOf(
      "create unique index uq_rental_invoices_active_contract_period",
    );
    expect(escapedGuard).toBeGreaterThan(0);
    expect(quarantine).toBeGreaterThan(escapedGuard);
    expect(retire).toBeGreaterThan(quarantine);
    expect(unique).toBeGreaterThan(retire);
    expect(compact).toContain(
      "order by ri.posted_at asc nulls last, ri.created_at asc, ri.id asc",
    );
    expect(compact).toContain("where r.duplicate_rank > 1");
    expect(compact).toContain("r.amount_paid_cents > 0");
    expect(compact).toContain(
      "ci.quickbooks_gl_status in ('processing', 'posted')",
    );
    expect(compact).toContain("gl.quickbooks_txn_id is not null");
    expect(compact).toContain(
      "delete from public.quickbooks_gl_sync_jobs gl using public.rental_invoices ri",
    );
    expect(compact).toContain(
      "set status = 'void', quickbooks_gl_status = 'not_synced'",
    );
  });

  it("compares the exact planned money snapshot while holding every source stable", () => {
    const post = functionSql("post_rental_invoice_for_billing_item");
    expect(post).toContain("from public.rental_billing_runs r");
    expect(post).toContain("from public.rental_billing_run_items i");
    expect(post).toContain("from public.rental_contracts c");
    expect(post).toContain("for update");
    expect(post).toContain("from public.rental_contract_lines l");
    expect(post).toContain("from public.rental_returns rr");
    expect(post).toContain("from public.rental_invoices ri");
    expect(post).toContain("from public.branches b");
    expect(post).toContain("from public.portal_customers pc");
    expect(post).toContain("from public.qrm_company_ship_to_addresses sta");
    expect(post).toContain("from public.tax_jurisdictions tj");
    expect(post.match(/for share/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    expect(post).toContain("p_invoice -> 'billing_source_snapshot'");
    expect(post).toContain("is distinct from v_source_snapshot");
    expect(post).toContain("rental_billing_source_stale");
    expect(post).toContain("billing_source_fingerprint");
    expect(compact).toContain("'version', 2");
    expect(compact).toContain("'numbering_branch'");
    expect(compact).toContain("'tax_resolution'");
    expect(compact).toContain("'tax_jurisdiction'");
    expect(compact).toContain("'updated_at', b.updated_at");
    expect(compact).toContain("'updated_at', sta.updated_at");
  });

  it("does not terminalize after rental money posts but before its mirror commits", () => {
    const post = functionSql("post_rental_invoice_for_billing_item");
    const nested = post.indexOf(
      "public.post_rental_invoice_for_billing_item_v1_unchecked",
    );
    const pending = post.indexOf("set status = 'processing'");
    expect(nested).toBeGreaterThan(0);
    expect(pending).toBeGreaterThan(nested);
    expect(post).toContain("rental_invoice_id = v_post.invoice_id");
    expect(post).toContain("completed_at = null");
  });

  it("commits the AR header, line, backlink, GL outbox, and terminal checkpoint together", () => {
    const mirror = functionSql("mirror_rental_invoice_for_billing_item");
    const header = mirror.indexOf("insert into public.customer_invoices");
    const line = mirror.indexOf(
      "insert into public.customer_invoice_line_items",
    );
    const backlink = mirror.indexOf("update public.rental_invoices ri");
    const gl = mirror.indexOf("insert into public.quickbooks_gl_sync_jobs");
    const checkpoint = mirror.indexOf(
      "update public.rental_billing_run_items i",
    );
    expect(header).toBeGreaterThan(0);
    expect(line).toBeGreaterThan(header);
    expect(backlink).toBeGreaterThan(line);
    expect(gl).toBeGreaterThan(backlink);
    expect(checkpoint).toBeGreaterThan(gl);
    expect(mirror).toContain("on conflict (invoice_id) do nothing");
    expect(mirror).toContain("set status = 'invoiced'");
    expect(mirror).toContain("worker_token = null");
  });

  it("can atomically attach a same-run invoice before crash recovery mirrors it", () => {
    const attach = functionSql("attach_rental_invoice_to_billing_item");
    expect(attach).toContain(
      "ri.rental_billing_run_id = v_item.rental_billing_run_id",
    );
    expect(attach).toContain(
      "ri.rental_contract_id = v_item.rental_contract_id",
    );
    expect(attach).toContain("rental_invoice_id = v_invoice.id");
    expect(attach).toContain("i.worker_token = p_worker_token");
    expect(compact).toContain(
      "grant execute on function public.attach_rental_invoice_to_billing_item(uuid, uuid, uuid) to service_role",
    );
  });

  it("keeps mirror failures reclaimable and reopens legacy incomplete graphs", () => {
    const defer = functionSql("defer_rental_billing_mirror");
    expect(defer).toContain("set status = 'processing'");
    expect(defer).toContain("lease_expires_at = now() +");
    expect(defer).toContain("completed_at = null");
    expect(compact).toContain(
      "not exists ( select 1 from public.customer_invoice_line_items li",
    );
    expect(compact).toContain(
      "not exists ( select 1 from public.quickbooks_gl_sync_jobs gl",
    );
    expect(compact).toContain(
      "m815 reopened incomplete ar mirror for durable retry",
    );
    expect(compact).toContain("set status = 'partial', completed_at = null");
  });

  it("rejects an incomplete or stale service-parts set before invoking m810", () => {
    const reconcile = functionSql("reconcile_service_parts_plan");
    const completeness = reconcile.indexOf(
      "service_parts_plan_stale_or_incomplete",
    );
    const unsafeCall = reconcile.indexOf(
      "public.reconcile_service_parts_plan_v1_unchecked",
    );
    expect(reconcile).toContain("for update");
    expect(reconcile.match(/ except /g)?.length ?? 0).toBe(2);
    expect(reconcile).toContain(
      "r.status in ('pending', 'picking', 'transferring', 'ordering')",
    );
    expect(completeness).toBeGreaterThan(0);
    expect(unsafeCall).toBeGreaterThan(completeness);
  });

  it("keeps unsafe implementations private and exposes only scoped wrappers", () => {
    expect(compact).toContain(
      "revoke execute on function public.post_rental_invoice_for_billing_item_v1_unchecked(uuid, uuid, jsonb) from public, anon, authenticated, service_role",
    );
    expect(compact).toContain(
      "grant execute on function public.mirror_rental_invoice_for_billing_item(uuid, uuid) to service_role",
    );
    expect(compact).toContain(
      "revoke execute on function public.reconcile_service_parts_plan_v1_unchecked(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role",
    );
    expect(compact).toContain(
      "grant execute on function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb) to authenticated",
    );
  });
});
