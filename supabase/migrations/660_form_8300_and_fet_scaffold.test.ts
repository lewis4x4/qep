import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "660_form_8300_and_fet_scaffold.sql",
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

describe("660_form_8300_and_fet_scaffold.sql contract", () => {
  it("wraps the whole migration in a transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });

  it("creates all four finance-compliance tables with QEP column conventions", () => {
    expect(compactSql).toContain("create table if not exists public.form_8300_reports");
    expect(compactSql).toContain("create table if not exists public.fet_taxable_categories");
    expect(compactSql).toContain("create table if not exists public.fet_exemption_certificates");
    expect(compactSql).toContain("create table if not exists public.fet_liability_lines");

    // uuid pk + timestamp defaults present on the migration.
    expect(compactSql).toContain("id uuid primary key default gen_random_uuid()");
    expect(compactSql).toContain("created_at timestamptz not null default now()");
    expect(compactSql).toContain("updated_at timestamptz not null default now()");
  });

  it("defines the Form 8300 flag table with a $10,000 threshold and status vocabulary", () => {
    expect(compactSql).toContain("cash_amount numeric(14,2) not null check (cash_amount >= 0)");
    expect(compactSql).toContain("threshold_amount numeric(14,2) not null default 10000");
    expect(compactSql).toContain("status text not null default 'flagged' check (status in ('flagged','filed','void','exempt'))");
    expect(compactSql).toContain("invoice_id uuid references public.customer_invoices(id) on delete set null");
    // idempotent one-flag-per-invoice index.
    expect(compactSql).toContain("create unique index if not exists form_8300_reports_invoice_uidx");
  });

  it("flags cash payments over $10,000 via an AFTER INSERT OR UPDATE trigger on customer_invoices", () => {
    const triggerFn = compact(functionSql("flag_form_8300_if_cash_over_threshold"));
    expect(triggerFn).toContain("lower(new.payment_method) in ('cash', 'currency')");
    expect(triggerFn).toContain("new.payment_method ilike '%cash%'");
    expect(triggerFn).toContain("coalesce(new.amount_paid, 0) > 10000");
    expect(triggerFn).toContain("perform public.evaluate_form_8300(new.id)");

    expect(compactSql).toContain("create trigger trg_flag_form_8300_cash after insert or update on public.customer_invoices");
  });

  it("provides an idempotent manual evaluator that returns the report id or null", () => {
    const evalFn = compact(functionSql("evaluate_form_8300"));
    expect(evalFn).toContain("create or replace function public.evaluate_form_8300(p_invoice_id uuid) returns uuid");
    expect(evalFn).toContain("security definer");
    expect(evalFn).toContain("set search_path = public");
    // idempotent: refresh existing live flag rather than duplicating.
    expect(evalFn).toContain("where invoice_id = p_invoice_id and deleted_at is null");
    expect(evalFn).toContain("returning id into v_report_id");
  });

  it("seeds the FET-taxable categories at the default 12% rate", () => {
    expect(compactSql).toContain("fet_rate numeric(6,4) not null default 0.12");
    expect(compactSql).toContain("'grapple_truck'");
    expect(compactSql).toContain("'truck_body'");
    expect(compactSql).toContain("'chassis'");
    expect(compactSql).toContain("form 720");
    // idempotent seed.
    expect(compactSql).toContain("on conflict (workspace_id, category_code) do update set");
    expect(compactSql).toContain("unique (workspace_id, category_code)");
  });

  it("keeps the FET exemption table separate from the sales-tax exemption table", () => {
    // FET exemption certs must NOT be jammed into tax_exemption_certificates.
    const fetExemptBlock = sql.match(
      /create table if not exists public\.fet_exemption_certificates[\s\S]*?\);/i,
    );
    expect(fetExemptBlock).not.toBeNull();
    const block = compact(fetExemptBlock?.[0] ?? "");
    expect(block).toContain("status text not null default 'pending' check (status in ('pending','verified','expired','revoked'))");
    expect(block).toContain("verified_by uuid references public.profiles(id)");
    expect(block).toContain("deleted_at timestamptz");
  });

  it("computes fet_liability_lines.fet_amount as a generated taxable * rate column", () => {
    expect(compactSql).toContain(
      "fet_amount numeric(14,2) generated always as (round(taxable_amount * fet_rate, 2)) stored",
    );
    expect(compactSql).toContain("taxable_amount numeric(14,2) not null default 0");
    expect(compactSql).toContain(
      "exemption_certificate_id uuid references public.fet_exemption_certificates(id)",
    );
    expect(compactSql).toContain("invoice_id uuid references public.customer_invoices(id) on delete cascade");
    expect(compactSql).toContain("create index if not exists fet_liability_lines_workspace_invoice_idx");
  });

  it("exposes an immutable compute_fet() that returns 0 when exempt", () => {
    const fn = compact(functionSql("compute_fet"));
    expect(fn).toContain(
      "create or replace function public.compute_fet( p_taxable_amount numeric, p_rate numeric default 0.12, p_is_exempt boolean default false )",
    );
    expect(fn).toContain("immutable");
    expect(fn).toContain("when p_is_exempt then 0::numeric");
    expect(fn).toContain("else round(coalesce(p_taxable_amount, 0) * coalesce(p_rate, 0.12), 2)");
  });

  it("enables RLS on all four tables with workspace-scoped select policies", () => {
    for (const table of [
      "form_8300_reports",
      "fet_taxable_categories",
      "fet_exemption_certificates",
      "fet_liability_lines",
    ]) {
      expect(compactSql).toContain(`alter table public.${table} enable row level security`);
      expect(compactSql).toContain(
        `create policy ${table}_select on public.${table} for select using (workspace_id = (select public.get_my_workspace()))`,
      );
    }
  });

  it("gates writes on the finance-sensitive tables to admin/manager/owner", () => {
    for (const table of [
      "form_8300_reports",
      "fet_taxable_categories",
      "fet_exemption_certificates",
    ]) {
      const insertPolicy = compact(
        sql.match(
          new RegExp(
            `create policy ${table}_insert on public\\.${table}[\\s\\S]*?;`,
            "i",
          ),
        )?.[0] ?? "",
      );
      expect(insertPolicy).toContain(
        "(select public.get_my_role()) in ('admin','manager','owner')",
      );
    }
  });

  it("wraps every helper reference in a scalar subselect for init-plan efficiency", () => {
    expect(compactSql).not.toMatch(/using \(workspace_id = public\.get_my_workspace\(\)\)/);
    expect(compactSql).toContain("(select public.get_my_workspace())");
    expect(compactSql).toContain("(select public.get_my_role())");
    expect(compactSql).toContain("(select auth.role()) = 'service_role'");
  });
});
