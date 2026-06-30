import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "651_qep_decision_resolution_authority.sql",
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

describe("651_qep_decision_resolution_authority.sql contract", () => {
  it("adds a generic immutable resolution audit ledger", () => {
    expect(compactSql).toContain("create table if not exists public.qep_decision_resolution_audit");
    expect(compactSql).toContain("decision_id uuid not null references public.qep_decisions(id) on delete cascade");
    expect(compactSql).toContain("target_status public.qep_decision_status not null");
    expect(compactSql).toContain("context jsonb not null default '{}'::jsonb");
  });

  it("guards resolved-state direct table updates outside approved RPC execution", () => {
    const guard = compact(functionSql("fn_qep_decision_resolution_authority_guard"));

    expect(guard).toContain("current_user in ('postgres', 'supabase_admin')");
    expect(guard).toContain("new.status::text in ('answered', 'shadow_ship', 'superseded')");
    expect(guard).toContain("new.answered_option is distinct from old.answered_option");
    expect(guard).toContain("raise exception 'qep_decisions resolution must use lane-aware rpc'");
    expect(compactSql).toContain("create trigger qep_decisions_resolution_authority_guard");
  });

  it("exposes a lane-aware resolver RPC and blocks AUTHORIZE direct answers", () => {
    const fn = compact(functionSql("resolve_qep_decision"));

    expect(fn).toContain("security definer set search_path = public");
    expect(fn).toContain("public.get_my_role() not in ('admin', 'manager', 'owner')");
    expect(fn).toContain("v_decision.lane = 'authorize'::public.qep_decision_lane");
    expect(fn).toContain("authorise lane decisions must resolve through record_qep_authorize_signature");
    expect(fn).toContain("v_target_status = 'shadow_ship'::public.qep_decision_status");
    expect(fn).toContain("v_decision.lane <> 'ratify'::public.qep_decision_lane");
    expect(fn).toContain("insert into public.qep_decision_resolution_audit");
  });

  it("keeps resolver callable by authenticated/service_role only, never anon", () => {
    expect(compactSql).toContain("revoke execute on function public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) from anon");
    expect(compactSql).toContain("grant execute on function public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) to authenticated");
    expect(compactSql).toContain("grant execute on function public.resolve_qep_decision(text, public.qep_decision_status, text, text, text, jsonb) to service_role");
  });
});
