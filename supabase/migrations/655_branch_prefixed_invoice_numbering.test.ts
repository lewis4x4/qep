import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "655_branch_prefixed_invoice_numbering.sql",
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

describe("655_branch_prefixed_invoice_numbering.sql contract", () => {
  it("wraps the migration in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });

  it("adds a 2-digit legacy_code column with a format check and unique index", () => {
    expect(compactSql).toContain(
      "alter table public.branches add column if not exists legacy_code text",
    );
    // 2-digit format constraint
    expect(compactSql).toContain("legacy_code ~ '^[0-9]{2}$'");
    // company-wide-unique legacy code per workspace, ignoring soft-deletes
    expect(compactSql).toContain(
      "create unique index if not exists branches_ws_legacy_code_uidx on public.branches(workspace_id, legacy_code) where legacy_code is not null and deleted_at is null",
    );
  });

  it("creates the sequence-counter table with the required columns and unique key", () => {
    expect(compactSql).toContain(
      "create table if not exists public.invoice_number_sequences",
    );
    expect(compactSql).toContain("id uuid primary key default gen_random_uuid()");
    expect(compactSql).toContain(
      "workspace_id text not null default public.get_my_workspace()",
    );
    expect(compactSql).toContain("branch_legacy_code text not null");
    expect(compactSql).toContain(
      "dept_prefix text not null check (dept_prefix in ('e', 'p', 's', 'r', 'g'))",
    );
    expect(compactSql).toContain("next_value bigint not null default 1000");
    expect(compactSql).toContain("created_at timestamptz not null default now()");
    expect(compactSql).toContain("updated_at timestamptz not null default now()");
    expect(compactSql).toContain(
      "unique (workspace_id, branch_legacy_code, dept_prefix)",
    );
  });

  it("enables RLS with workspace-scoped policies wrapping helpers in a subselect", () => {
    expect(compactSql).toContain(
      "alter table public.invoice_number_sequences enable row level security",
    );
    // helpers must be wrapped as (select public.get_my_workspace()) — never bare
    expect(compactSql).toContain(
      "using (workspace_id = (select public.get_my_workspace()))",
    );
    expect(compactSql).toContain(
      "(select public.get_my_role()) in ('admin', 'manager', 'owner')",
    );
    // security-definer bypass path for the generator
    expect(compactSql).toContain("(select auth.role()) = 'service_role'");
    // guard against accidentally bare helper calls in a policy predicate
    expect(compactSql).not.toMatch(/using\s*\(\s*workspace_id\s*=\s*public\.get_my_workspace\(\)/i);
  });

  it("defines a concurrency-safe security-definer generator", () => {
    const fn = compact(functionSql("next_invoice_number"));

    expect(fn).toContain(
      "create or replace function public.next_invoice_number( p_workspace_id text, p_branch_legacy_code text, p_invoice_type text )",
    );
    expect(fn).toContain("returns text");
    expect(fn).toContain("language plpgsql");
    expect(fn).toContain("security definer");

    // atomic increment via upsert
    expect(fn).toContain(
      "on conflict (workspace_id, branch_legacy_code, dept_prefix) do update set next_value = invoice_number_sequences.next_value + 1 returning next_value into v_next",
    );

    // composes `<legacy>-<prefix><value>`
    expect(fn).toContain(
      "return p_branch_legacy_code || '-' || v_dept_prefix || v_next::text",
    );
  });

  it("maps invoice_type to the department prefix, equipment -> E", () => {
    const fn = compact(functionSql("next_invoice_number"));

    expect(fn).toContain("when 'equipment' then 'e'");
    expect(fn).toContain("when 'parts' then 'p'");
    expect(fn).toContain("when 'service' then 's'");
    expect(fn).toContain("when 'rental' then 'r'");
    expect(fn).toContain("when 'general' then 'g'");
  });

  it("locks execution of the generator to trusted callers", () => {
    expect(compactSql).toContain(
      "revoke execute on function public.next_invoice_number(text, text, text) from public, anon",
    );
    expect(compactSql).toContain(
      "grant execute on function public.next_invoice_number(text, text, text) to authenticated, service_role",
    );
  });
});
