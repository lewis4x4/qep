import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "758_f33_authorize_two_party_signing_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const buildLog = readText("QEP (1)", "QEP_OS_BUILD_LOG_2026-05-21.md");
const buildLogReview = readText("QEP (1)", "QEP_OS_BUILD_LOG_REVIEW_2026-05-21.md");
const authorizeSql = readText("supabase", "migrations", "619_qep_authorize_two_party_signatures.sql");
const resolutionAuthority = readText("supabase", "migrations", "651_qep_decision_resolution_authority.sql");
const resolutionAuthorityTest = readText("supabase", "migrations", "651_qep_decision_resolution_authority.test.ts");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactBuildLog = compact(buildLog);
const compactBuildLogReview = compact(buildLogReview);
const compactAuthorize = compact(authorizeSql);
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

describe("758_f33_authorize_two_party_signing_closeout.sql contract", () => {
  it("marks only F3.3 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f3.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f33_authorize_two_party_signing_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f3.2'");
    expect(compactCloseout).not.toContain("where task_id = 'f4.1'");
  });

  it("pins the roadmap row and prior build-log caveat", () => {
    expect(compactSeed).toContain("'f3.3','f','f3','authorize-lane two-party signing flow'");
    expect(compactSeed).toContain("reuses iron quote e-signature");
    expect(compactSeed).toContain("required for jar-103");
    expect(compactSeed).toContain("array['f1.4','a3.5']");

    expect(compactPlan).toContain("authorize-lane two-party signing flow");
    expect(compactPlan).toContain("reuses a3.5 e-signature");
    expect(compactCatalog).toContain("qep-145 | done | 2026-05-21 | f3.3");
    expect(compactBuildLog).toContain("f3.3 / qep-145");
    expect(compactBuildLog).toContain("foundation built");
    expect(compactBuildLogReview).toContain("no stated test verification on the decision system");
  });

  it("pins the AUTHORIZE signature ledger schema", () => {
    expect(compactAuthorize).toContain("create table if not exists public.qep_decision_authorizations");
    expect(compactAuthorize).toContain("decision_id uuid not null references public.qep_decisions(id) on delete cascade");
    expect(compactAuthorize).toContain("signer_role text not null");
    expect(compactAuthorize).toContain("signer_name text not null");
    expect(compactAuthorize).toContain("signature_data_url text not null");
    expect(compactAuthorize).toContain("signature_hash text not null");
    expect(compactAuthorize).toContain("terms_accepted boolean not null default true");
    expect(compactAuthorize).toContain("terms_version text not null");
    expect(compactAuthorize).toContain("revoked_at timestamptz");
    expect(compactAuthorize).toContain("position('data:image/' in lower(signature_data_url)) = 1");
    expect(compactAuthorize).toContain("qep_decision_authorizations_active_role_uniq");
    expect(compactAuthorize).toContain("where revoked_at is null");
  });

  it("pins signing RPC authorization, validation, and duplicate guards", () => {
    const rpc = functionSql(authorizeSql, "record_qep_authorize_signature");

    expect(rpc).toContain("security definer set search_path = public");
    expect(rpc).toContain("auth.role() is distinct from 'service_role'");
    expect(rpc).toContain("public.get_my_role() not in ('admin', 'manager', 'owner')");
    expect(rpc).toContain("decision_code is required");
    expect(rpc).toContain("signer_role is required");
    expect(rpc).toContain("signer_name is required");
    expect(rpc).toContain("signature_data_url is required");
    expect(rpc).toContain("terms_accepted must be true");
    expect(rpc).toContain("terms_version is required");
    expect(rpc).toContain("v_decision.lane <> 'authorize'::public.qep_decision_lane");
    expect(rpc).toContain("v_decision.status::text not in ('open', 'escalated', 'shadow_ship')");
    expect(rpc).toContain("v_signer_role = any(v_required_signers)");
    expect(rpc).toContain("already signed decision");
  });

  it("pins required-signer derivation, signature hashing, and completion behavior", () => {
    const rpc = functionSql(authorizeSql, "record_qep_authorize_signature");

    expect(rpc).toContain("unnest(coalesce(v_decision.requires_two_sigs, array[]::text[]))");
    expect(rpc).toContain("v_required_signers := array[nullif(btrim(v_decision.owner_role), '')]");
    expect(rpc).toContain("encode(extensions.digest(convert_to(btrim(p_signature_data_url), 'utf8'), 'sha256'), 'hex')");
    expect(rpc).toContain("insert into public.qep_decision_authorizations");
    expect(rpc).toContain("select coalesce(array_agg(distinct a.signer_role order by a.signer_role), array[]::text[])");
    expect(rpc).toContain("if coalesce(array_length(v_missing_roles, 1), 0) = 0 then");
    expect(rpc).toContain("set status = 'answered'::public.qep_decision_status");
    expect(rpc).toContain("'authorize_signature_status'");
    expect(rpc).toContain("'missing_roles', to_jsonb(v_missing_roles)");
    expect(rpc).toContain("'complete', coalesce(array_length(v_missing_roles, 1), 0) = 0");
  });

  it("pins status view, RLS posture, and grants", () => {
    expect(compactAuthorize).toContain("create or replace view public.v_qep_decision_authorize_signature_status");
    expect(compactAuthorize).toContain("required_signers");
    expect(compactAuthorize).toContain("signed_roles");
    expect(compactAuthorize).toContain("missing_roles");
    expect(compactAuthorize).toContain("where d.lane = 'authorize'::public.qep_decision_lane");

    expect(compactAuthorize).toContain("alter table public.qep_decision_authorizations enable row level security");
    expect(compactAuthorize).toContain("create policy qep_decision_authorizations_service_role_all");
    expect(compactAuthorize).toContain("create policy qep_decision_authorizations_authenticated_read");
    expect(compactAuthorize).toContain("inserts intentionally flow through record_qep_authorize_signature");
    expect(compactAuthorize).toContain("revoke execute on function public.record_qep_authorize_signature");
    expect(compactAuthorize).toContain("from anon");
    expect(compactAuthorize).toContain("grant execute on function public.record_qep_authorize_signature");
    expect(compactAuthorize).toContain("to authenticated");
    expect(compactAuthorize).toContain("to service_role");
  });

  it("pins the later resolution-authority guard and live boundaries", () => {
    expect(compactResolutionAuthority).toContain("record_qep_authorize_signature");
    expect(compactResolutionAuthority).toContain("authorise lane decisions must resolve through record_qep_authorize_signature");
    expect(compactResolutionAuthority).toContain("qep_decisions resolution must use lane-aware rpc");
    expect(compactResolutionAuthorityTest).toContain("blocks authorize direct answers");

    expect(compactCloseout).toContain("this closeout changes roadmap status and adds tests only");
    expect(compactCloseout).toContain("does not mark f4.1, f4.2, f4.3, f4.4, f5.1, or f5.2");
    expect(compactCloseout).toContain("no live tina/ryan or owner two-party signing ceremony was run");
    expect(compactCloseout).toContain("f5.1 signed pdf retention artifacts remain separate downstream audit work");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
