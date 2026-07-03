import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "754_f43_owner_delegation_toggles_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const buildLog = readText("QEP (1)", "QEP_OS_BUILD_LOG_2026-05-21.md");
const delegationSql = readText("supabase", "migrations", "621_qep_owner_delegation_policies.sql");
const delegationTest = readText("supabase", "migrations", "621_qep_owner_delegation_policies.test.ts");
const blockerHandoff = readText("docs", "operations", "QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactBuildLog = compact(buildLog);
const compactDelegation = compact(delegationSql);
const compactDelegationTest = compact(delegationTest);
const compactBlockerHandoff = compact(blockerHandoff);

function functionSql(source: string, functionName: string): string {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return compact(match?.[0] ?? "");
}

describe("754_f43_owner_delegation_toggles_closeout.sql contract", () => {
  it("marks only F4.3 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f4.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f43_owner_delegation_toggles_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f4.2'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.4'");
  });

  it("pins the roadmap row, spec defaults, and prior done evidence", () => {
    expect(compactSeed).toContain("'f4.3','f','f4','per-owner delegation toggles'");
    expect(compactSeed).toContain("each owner sets per-class delegation");
    expect(compactSeed).toContain("array['f2.5']");

    expect(compactPlan).toContain("\"trust brian on this\" delegation toggle");
    expect(compactPlan).toContain("rylee | brain may answer copy/ux decisions");
    expect(compactPlan).toContain("ryan | brian may answer non-visual decisions");
    expect(compactPlan).toContain("angela | never delegates compliance (tila) decisions");
    expect(compactPlan).toContain("owner gets a daily digest");
    expect(compactCatalog).toContain("qep-161 | done | 2026-05-21 | f4.3");
    expect(compactBuildLog).toContain("per-owner delegation rules");
    expect(compactBuildLog).toContain("f4.3 / qep-161");
    expect(compactBuildLog).toContain("foundation built");
  });

  it("pins delegation tables, defaults, RLS, and grants", () => {
    expect(compactDelegation).toContain("alter table public.qep_decisions add column if not exists decision_class text");
    expect(compactDelegation).toContain("create table if not exists public.qep_decision_delegation_policies");
    expect(compactDelegation).toContain("create table if not exists public.qep_decision_delegation_audit");
    expect(compactDelegation).toContain("qep_decision_delegation_policies_owner_class_delegate_uniq");
    expect(compactDelegation).toContain("qep_decision_delegation_policies_lookup_idx");
    expect(compactDelegation).toContain("alter table public.qep_decision_delegation_policies enable row level security");
    expect(compactDelegation).toContain("alter table public.qep_decision_delegation_audit enable row level security");
    expect(compactDelegation).toContain("grant execute on function public.apply_qep_delegated_recommendation(text, text, text, text) to authenticated");
    expect(compactDelegation).toContain("grant execute on function public.apply_qep_delegated_recommendation(text, text, text, text) to service_role");

    expect(compactDelegation).toContain("('rylee', 'copy_ux', 'brian', 'brian', true");
    expect(compactDelegation).toContain("('ryan', 'non_visual', 'brian', 'brian', true");
    expect(compactDelegation).toContain("('ryan', 'visual', 'brian', 'brian', false");
    expect(compactDelegation).toContain("('angela', 'compliance_tila', 'brian', 'brian', false");
    expect(compactDelegation).toContain("('norman', 'parts_pricing_mechanics', 'brian', 'brian', true");
    expect(compactDelegation).toContain("('norman', 'pricing_policy', 'brian', 'brian', false");
    expect(compactDelegation).toContain("('tina', 'accounting_mechanics', 'brian', 'brian', true");
    expect(compactDelegation).toContain("('tina', 'closed_period_policy', 'brian', 'brian', false");
  });

  it("pins classifier and delegated apply guards", () => {
    const classifier = functionSql(delegationSql, "fn_qep_decision_classify");
    expect(classifier).toContain("p_ai_prep_packet->>'decision_class'");
    expect(classifier).toContain("return 'compliance_tila'");
    expect(classifier).toContain("return 'closed_period_policy'");
    expect(classifier).toContain("return 'parts_pricing_mechanics'");
    expect(classifier).toContain("return 'copy_ux'");
    expect(classifier).toContain("return 'visual'");
    expect(classifier).toContain("return 'non_visual'");

    const delegatedApply = functionSql(delegationSql, "apply_qep_delegated_recommendation");
    expect(delegatedApply).toContain("security definer set search_path = public");
    expect(delegatedApply).toContain("auth.role() is distinct from 'service_role'");
    expect(delegatedApply).toContain("public.get_my_role() not in ('admin', 'manager', 'owner')");
    expect(delegatedApply).toContain("for update");
    expect(delegatedApply).toContain("v_decision.status::text not in ('open', 'escalated', 'shadow_ship')");
    expect(delegatedApply).toContain("decision % has no recommended_option");
    expect(delegatedApply).toContain("from public.qep_decision_delegation_policies p");
    expect(delegatedApply).toContain("and p.enabled = true");
    expect(delegatedApply).toContain("raise exception 'no enabled delegation policy for owner % class % delegate %'");
  });

  it("pins answer update, audit insert, Q11 proof, and boundaries", () => {
    const delegatedApply = functionSql(delegationSql, "apply_qep_delegated_recommendation");
    expect(delegatedApply).toContain("set status = 'answered'::public.qep_decision_status");
    expect(delegatedApply).toContain("answered_option = v_decision.recommended_option");
    expect(delegatedApply).toContain("'brian_triage_approved_by', v_actor");
    expect(delegatedApply).toContain("'delegation_apply'");
    expect(delegatedApply).toContain("insert into public.qep_decision_delegation_audit");
    expect(delegatedApply).toContain("'reason', 'delegated_recommendation_applied'");

    expect(compactDelegationTest).toContain("621_qep_owner_delegation_policies.sql f4.3 contract");
    expect(compactDelegationTest).toContain("guards delegated apply rpc by role, status, recommendation, and policy match");
    expect(compactBlockerHandoff).toContain("q11 was resolved using the live policy introduced by migration `621`");
    expect(compactBlockerHandoff).toContain("apply_qep_delegated_recommendation");
    expect(compactBlockerHandoff).toContain("policy id: `e4f38497-92c9-41f9-8546-d11138a010f8`");
    expect(compactBlockerHandoff).toContain("audit id: `61590fb6-5850-4172-b397-7d98ad133380`");

    expect(compactCloseout).toContain("does not mark f4.4, f5.1, or f5.2");
    expect(compactCloseout).toContain("no new live owner self-service settings session");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
