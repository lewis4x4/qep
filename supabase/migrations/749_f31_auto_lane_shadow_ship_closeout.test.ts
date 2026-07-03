import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "749_f31_auto_lane_shadow_ship_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const goLive = readText("QEP (1)", "QEP_DECISION_INBOX_GO_LIVE.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const shadowShip = readText("supabase", "migrations", "618_qep_auto_lane_shadow_ship_flags.sql");
const rlsReapply = readText("supabase", "migrations", "629_rls_initplan_corrective_reapply.sql");
const resolutionAuthority = readText("supabase", "migrations", "651_qep_decision_resolution_authority.sql");
const resolutionAuthorityTest = readText("supabase", "migrations", "651_qep_decision_resolution_authority.test.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactGoLive = compact(goLive);
const compactCatalog = compact(catalog);
const compactShadowShip = compact(shadowShip);
const compactRlsReapply = compact(rlsReapply);
const compactResolutionAuthority = compact(resolutionAuthority);
const compactResolutionAuthorityTest = compact(resolutionAuthorityTest);

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

describe("749_f31_auto_lane_shadow_ship_closeout.sql contract", () => {
  it("marks only F3.1 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f3.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f31_auto_lane_shadow_ship_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f3.2'");
  });

  it("pins the canonical roadmap row and Done catalog provenance", () => {
    expect(compactSeed).toContain("'f3.1','f','f3','auto-lane shadow-ship infrastructure'");
    expect(compactSeed).toContain("flag-scoped feature toggles");
    expect(compactSeed).toContain("recommendation goes live immediately for one rep");
    expect(compactSeed).toContain("array['f1.4']");

    expect(compactPlan).toContain("auto-lane shadow-ship");
    expect(compactPlan).toContain("flag-scoped feature toggle infrastructure");
    expect(compactGoLive).toContain("f3.1 + f3.2 infrastructure");
    expect(compactCatalog).toContain("qep-147 | done | 2026-05-21 | f3.1");
  });

  it("pins the shadow-ship ledger schema and lifecycle constraints", () => {
    expect(compactShadowShip).toContain("create type public.qep_shadow_ship_status as enum");
    expect(compactShadowShip).toContain("'shadow_ship'");
    expect(compactShadowShip).toContain("'ratified'");
    expect(compactShadowShip).toContain("'reverted'");
    expect(compactShadowShip).toContain("create table if not exists public.qep_shadow_ship_flags");
    expect(compactShadowShip).toContain("feature_flag text not null");
    expect(compactShadowShip).toContain("rep_scope text not null");
    expect(compactShadowShip).toContain("silence_deadline_at timestamptz not null");
    expect(compactShadowShip).toContain("qep_shadow_ship_flags_active_scope_uniq");
    expect(compactShadowShip).toContain("where status = 'shadow_ship'");
  });

  it("pins AUTO activation validation and side effects", () => {
    const activate = functionSql(shadowShip, "activate_qep_auto_shadow_ship");

    expect(activate).toContain("security definer set search_path = public");
    expect(activate).toContain("public.get_my_role() not in ('admin', 'manager', 'owner')");
    expect(activate).toContain("decision_code is required");
    expect(activate).toContain("feature_flag is required");
    expect(activate).toContain("rep_scope is required");
    expect(activate).toContain("recommendation is required");
    expect(activate).toContain("v_decision.lane::text <> 'auto'");
    expect(activate).toContain("v_decision.status::text not in ('open', 'escalated')");
    expect(activate).toContain("recommendation must match decision recommended_option");
    expect(activate).toContain("insert into public.qep_shadow_ship_flags");
    expect(activate).toContain("set status = 'shadow_ship'::public.qep_decision_status");
    expect(activate).toContain("'auto_shadow_ship'");
    expect(activate).toContain("insert into public.qep_roadmap_sync_events");
  });

  it("pins service-role ratification and grants", () => {
    const ratifier = functionSql(shadowShip, "ratify_expired_qep_auto_shadow_ship");

    expect(ratifier).toContain("if auth.role() is distinct from 'service_role'");
    expect(ratifier).toContain("where f.status = 'shadow_ship'::public.qep_shadow_ship_status");
    expect(ratifier).toContain("f.silence_deadline_at <= p_now");
    expect(ratifier).toContain("d.lane = 'auto'::public.qep_decision_lane");
    expect(ratifier).toContain("set status = 'ratified'::public.qep_shadow_ship_status");
    expect(ratifier).toContain("set status = 'answered'::public.qep_decision_status");
    expect(ratifier).toContain("insert into public.qep_roadmap_sync_events");

    expect(compactShadowShip).toContain("grant execute on function public.activate_qep_auto_shadow_ship");
    expect(compactShadowShip).toContain("to authenticated");
    expect(compactShadowShip).toContain("to service_role");
    expect(compactShadowShip).toContain("revoke execute on function public.ratify_expired_qep_auto_shadow_ship");
    expect(compactShadowShip).toContain("grant execute on function public.ratify_expired_qep_auto_shadow_ship(timestamptz, text) to service_role");
  });

  it("pins RLS correction and resolution authority interactions", () => {
    expect(compactShadowShip).toContain("alter table public.qep_shadow_ship_flags enable row level security");
    expect(compactShadowShip).toContain("create policy qep_shadow_ship_flags_authenticated_write");
    expect(compactRlsReapply).toContain("drop policy if exists qep_shadow_ship_flags_authenticated_write");
    expect(compactRlsReapply).toContain("with check ((select public.get_my_role()) in ('admin', 'manager', 'owner'))");

    expect(compactResolutionAuthority).toContain("new.status::text in ('answered', 'shadow_ship', 'superseded')");
    expect(compactResolutionAuthority).toContain("qep_decisions resolution must use lane-aware rpc");
    expect(compactResolutionAuthority).toContain("current_setting('app.qep_decision_resolution_authority', true)");
    expect(compactResolutionAuthorityTest).toContain("guards resolved-state direct table updates outside approved rpc execution");
  });

  it("keeps live rollout boundaries explicit", () => {
    expect(compactCloseout).toContain("does not mark f3.2, f3.3, f4.1, f4.2, f4.3, f4.4, f5.1, or f5.2");
    expect(compactCloseout).toContain("no live auto decision was activated behind a production feature flag");
    expect(compactCloseout).toContain("actual application feature-flag consumers");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
