import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "658_margin_matrix_segment_tags.sql",
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

describe("658_margin_matrix_segment_tags.sql contract", () => {
  it("wraps the migration in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });

  it("guards the margin_line_class enum with exact parts/service/equipment values", () => {
    expect(compactSql).toContain(
      "if not exists (select 1 from pg_type where typname = 'margin_line_class') then",
    );
    expect(compactSql).toContain(
      "create type public.margin_line_class as enum ('parts', 'service', 'equipment')",
    );
  });

  it("guards the margin_segment enum with exact customer/warranty/internal/sublet values", () => {
    expect(compactSql).toContain(
      "if not exists (select 1 from pg_type where typname = 'margin_segment') then",
    );
    expect(compactSql).toContain(
      "create type public.margin_segment as enum ('customer', 'warranty', 'internal', 'sublet')",
    );
  });

  it("creates margin_matrix_entries with uuid pk and canonical timestamps", () => {
    expect(compactSql).toContain(
      "create table if not exists public.margin_matrix_entries",
    );
    expect(compactSql).toContain("id uuid primary key default gen_random_uuid()");
    expect(compactSql).toContain(
      "workspace_id text not null default public.get_my_workspace()",
    );
    expect(compactSql).toContain(
      "source_type text not null check (source_type in ('equipment', 'parts', 'service'))",
    );
    expect(compactSql).toContain("line_class public.margin_line_class not null");
    expect(compactSql).toContain("segment public.margin_segment not null");
    expect(compactSql).toContain("created_at timestamptz not null default now()");
    expect(compactSql).toContain("updated_at timestamptz not null default now()");
    expect(compactSql).toContain("deleted_at timestamptz");
  });

  it("generates gross_margin_cents as sale - cost", () => {
    expect(compactSql).toContain(
      "gross_margin_cents bigint generated always as (sale_cents - cost_cents) stored",
    );
  });

  it("generates net_margin_cents as sale - cost - shop_burden (burden below GM)", () => {
    expect(compactSql).toContain(
      "net_margin_cents bigint generated always as (sale_cents - cost_cents - shop_burden_cents) stored",
    );
  });

  it("indexes the matrix and source lookups", () => {
    expect(compactSql).toContain(
      "on public.margin_matrix_entries (workspace_id, line_class, segment)",
    );
    expect(compactSql).toContain(
      "on public.margin_matrix_entries (workspace_id, source_type, source_id)",
    );
  });

  it("rolls up the matrix by line_class + segment in a plain view", () => {
    expect(compactSql).toContain(
      "create or replace view public.v_margin_matrix_summary as",
    );
    expect(compactSql).toContain("sum(gross_margin_cents) as gross_margin_cents");
    expect(compactSql).toContain("sum(net_margin_cents) as net_margin_cents");
    expect(compactSql).toContain("group by workspace_id, line_class, segment");
    // plain view, not security definer — inherits invoker RLS.
    expect(compactSql).not.toContain("security definer");
  });

  it("computes net segment margin by subtracting shop burden below gross margin", () => {
    const fn = compact(functionSql("compute_segment_margin"));
    expect(fn).toContain(
      "p_shop_burden_cents bigint default 0",
    );
    expect(fn).toContain("immutable");
    expect(fn).toContain(
      "p_sale_cents - p_cost_cents - coalesce(p_shop_burden_cents, 0)",
    );
  });

  it("computes margin percentage guarded against divide-by-zero", () => {
    const fn = compact(functionSql("compute_margin_pct"));
    expect(fn).toContain("immutable");
    expect(fn).toContain(
      "round(((p_sale_cents - p_cost_cents)::numeric / nullif(p_sale_cents, 0)) * 100, 4)",
    );
  });

  it("enables RLS and scopes every policy through (select public.get_my_workspace())", () => {
    expect(compactSql).toContain(
      "alter table public.margin_matrix_entries enable row level security",
    );
    expect(compactSql).toContain("create policy margin_matrix_entries_select");
    expect(compactSql).toContain(
      "using (workspace_id = (select public.get_my_workspace()))",
    );
    // never bare helper calls.
    expect(compactSql).not.toMatch(/[^(]get_my_workspace\(\)\)?\s+in/);
  });

  it("restricts insert/update/delete to admin/manager/owner in the same workspace", () => {
    expect(compactSql).toContain("create policy margin_matrix_entries_insert");
    expect(compactSql).toContain("create policy margin_matrix_entries_update");
    expect(compactSql).toContain("create policy margin_matrix_entries_delete");
    expect(compactSql).toContain(
      "(select public.get_my_role()) in ('admin', 'manager', 'owner')",
    );
  });

  it("keeps the personal AI persona out of the migration", () => {
    expect(compactSql).not.toContain("jarvis");
  });
});
