import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "621_qep_owner_delegation_policies.sql",
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

describe("621_qep_owner_delegation_policies.sql F4.3 contract", () => {
  it("adds delegation policy + audit tables and decision_class support", () => {
    expect(compactSql).toContain("alter table public.qep_decisions add column if not exists decision_class text");
    expect(compactSql).toContain("create table if not exists public.qep_decision_delegation_policies");
    expect(compactSql).toContain("create table if not exists public.qep_decision_delegation_audit");
  });

  it("seeds owner delegation defaults from spec section 11", () => {
    expect(compactSql).toContain("('rylee', 'copy_ux', 'brian', 'brian', true");
    expect(compactSql).toContain("('ryan', 'non_visual', 'brian', 'brian', true");
    expect(compactSql).toContain("('ryan', 'visual', 'brian', 'brian', false");
    expect(compactSql).toContain("('angela', 'compliance_tila', 'brian', 'brian', false");
    expect(compactSql).toContain("('norman', 'parts_pricing_mechanics', 'brian', 'brian', true");
    expect(compactSql).toContain("('norman', 'pricing_policy', 'brian', 'brian', false");
    expect(compactSql).toContain("('tina', 'accounting_mechanics', 'brian', 'brian', true");
    expect(compactSql).toContain("('tina', 'closed_period_policy', 'brian', 'brian', false");
  });

  it("guards delegated apply RPC by role, status, recommendation, and policy match", () => {
    const fn = compact(functionSql("apply_qep_delegated_recommendation"));

    expect(fn).toContain("security definer set search_path = public");
    expect(fn).toContain("public.get_my_role() not in ('admin', 'manager', 'owner')");
    expect(fn).toContain("v_decision.status::text not in ('open', 'escalated', 'shadow_ship')");
    expect(fn).toContain("decision % has no recommended_option");
    expect(fn).toContain("from public.qep_decision_delegation_policies p");
    expect(fn).toContain("and p.enabled = true");
    expect(fn).toContain("and (lower(p.decision_class) = v_class or p.decision_class = '*')");
    expect(fn).toContain("raise exception 'no enabled delegation policy for owner % class % delegate %'");
  });

  it("records Brian approval metadata and immutable delegation audit evidence", () => {
    const fn = compact(functionSql("apply_qep_delegated_recommendation"));

    expect(fn).toContain("'brian_triage_approved_by', v_actor");
    expect(fn).toContain("'brian_triage_approved_at', v_now");
    expect(fn).toContain("insert into public.qep_decision_delegation_audit");
    expect(fn).toContain("'reason', 'delegated_recommendation_applied'");
  });

  it("exposes RPC/classifier executes to authenticated + service_role, never anon", () => {
    expect(compactSql).toContain("revoke execute on function public.fn_qep_decision_classify(text, text, text, jsonb) from anon");
    expect(compactSql).toContain("grant execute on function public.fn_qep_decision_classify(text, text, text, jsonb) to authenticated");
    expect(compactSql).toContain("grant execute on function public.fn_qep_decision_classify(text, text, text, jsonb) to service_role");
    expect(compactSql).toContain("revoke execute on function public.apply_qep_delegated_recommendation(text, text, text, text) from anon");
    expect(compactSql).toContain("grant execute on function public.apply_qep_delegated_recommendation(text, text, text, text) to authenticated");
    expect(compactSql).toContain("grant execute on function public.apply_qep_delegated_recommendation(text, text, text, text) to service_role");
  });
});
