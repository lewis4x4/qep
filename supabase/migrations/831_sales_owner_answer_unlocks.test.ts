import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");
const migration = read("supabase", "migrations", "831_sales_owner_answer_unlocks.sql");
const ownerReconciliation = read("supabase", "migrations", "825_owner_answer_source_truth_reconciliation.sql");
const quoteHandler = read("supabase", "functions", "quote-builder-v2", "index.ts");
const stackingValidator = read("apps", "web", "src", "lib", "programs", "stacking-db.ts");
const compact = migration.replace(/\s+/g, " ").toLowerCase();

describe("831 sales owner-answer unlocks", () => {
  it("drives SA6 from evidence-bearing send/accept boundaries, not naked status", () => {
    expect(compact).toContain("create or replace function public.guard_quote_prospect_status_evidence");
    expect(compact).toContain("prospect_send_evidence_required");
    expect(compact).toContain("prospect_acceptance_signature_required");
    expect(compact).toContain("public.quote_send_package_commit_v599");
    expect(compact).toContain("perform public.sync_quote_prospect_lifecycle(p_quote_package_id)");
    expect(compact).toContain("create or replace function public.mark_quote_package_sent_with_evidence");
    expect(compact).toContain("'manual_attestation'");
    expect(compact).toContain("drop trigger if exists trg_quote_package_prospect_lifecycle");
    expect(compact).not.toContain("create trigger trg_quote_package_prospect_lifecycle");
    expect(compact).not.toContain("after insert on public.quote_packages");
  });

  it("binds Tina/Ryan approvals to immutable principal profile IDs", () => {
    expect(compact).toContain("check (approval_scope in ('quarter_reopen', 'sales_credit'))");
    expect(compact).toContain("from public.finance_approval_principals principal");
    expect(compact).toContain("principal.approval_scope = 'sales_credit'");
    expect(compact).toContain("principal.profile_id = auth.uid()");
    expect(compact).toContain("create or replace view public.v_finance_approval_principal_readiness");
    expect(compact).toContain("when principal.profile_id is null then 'profile_binding_required'");
    expect(compact).toContain("quarter-reopen % principal binding is required");
    expect(compact).toContain("drop policy if exists \"finance_approval_principals_owner_mutate\"");
    expect(compact).toContain("create table if not exists public.finance_approval_principal_binding_events");
    expect(compact).toContain("create or replace function public.finance_bind_approval_principal");
    expect(compact).toContain("approval-principal binding requires service_role");
    expect(compact).toContain("approval-principal binding is immutable");
    expect(compact).toContain("approval-principal profile must be active in the target workspace");
    expect(compact).toContain(
      "revoke insert, update, delete on public.finance_approval_principals from public, anon, authenticated, service_role",
    );
    expect(compact).not.toContain("lower(split_part(trim(coalesce(profile.full_name" );
    expect(compact).not.toContain("and lower(trim(v_actor.full_name))");
  });

  it("keeps finance-admin authority explicit while retaining principal checks", () => {
    expect(compact).toContain("'admin', 'manager', 'owner', 'finance_admin'");
    expect(compact).toContain("if not public.is_sales_credit_principal(v_request.workspace_id)");
    expect(compact).toContain("sales credit approval request is outside the active workspace");
    expect(compact).toContain("approved terms code is required");
    expect(compact).toContain("approved credit limit must be zero or greater");
    expect(compact).toContain("when company.credit_hold_reason = v_hold_reason then false");
  });

  it("never identifies an existing customer or contact by mutable text", () => {
    expect(compact).toContain("from public.qrm_deals deal join public.qrm_companies company");
    expect(compact).toContain("'identity_evidence', 'explicit_qrm_deal_company_id'");
    expect(compact).toContain("'linked_existing_customer'");
    expect(compact).toContain("'dedupe_review_required'");
    expect(compact).toContain("'potential_duplicate_company_ids'");
    expect(compact).not.toContain("and lower(trim(contact.email)) = v_person_email");
    expect(compact).not.toContain("regexp_replace(coalesce(contact.phone, contact.cell" );
    expect(compact).not.toContain("select company.id into v_company_id from public.qrm_companies company where company.workspace_id = v_quote.workspace_id and company.deleted_at is null and lower(trim(company.name))");
  });

  it("accepts signature and quote status atomically behind service role", () => {
    expect(compact).toContain("create or replace function public.accept_quote_package_with_signature");
    expect(compact).toContain("accept_quote_package_with_signature requires service_role");
    expect(compact).toContain("insert into public.quote_signatures");
    expect(compact).toContain("set status = 'accepted', accepted_at = v_signature.signed_at");
    expect(compact).toContain("drop policy if exists \"signatures_workspace\"");
    expect(compact).toContain("create policy \"signatures_workspace_select\"");
    expect(quoteHandler).toContain('.rpc(\n    "accept_quote_package_with_signature"');
    expect(quoteHandler).toContain('.rpc(\n        "accept_quote_package_with_signature"');
    expect(quoteHandler).not.toContain('"Signature saved, but quote acceptance could not be completed');
    expect(quoteHandler).toContain('admin.rpc("mark_quote_package_sent_with_evidence"');
  });

  it("implements exact OEM/program/effective-date worksheet policy and fails closed", () => {
    expect(compact).toContain("create table if not exists public.qb_program_pair_policies");
    expect(compact).toContain("program_a_id uuid not null references public.qb_programs");
    expect(compact).toContain("source_price_sheet_id uuid not null");
    expect(compact).toContain("published stacking policy effective windows may not overlap");
    expect(compact).toContain("source rows must be approved/applied rows for both programs");
    expect(compact).toContain("price-sheet program workspace must match source sheet workspace");
    expect(compact).toContain("deprecated legacy global type-pair fixtures");
    expect(compact).toContain("create or replace function public.guard_qb_quote_program_policy_ready");
    expect(compact).toContain("program_policy_pending");
    expect(compact).toContain("program_stacking_not_allowed");
    expect(compact).toContain("before insert or update of status, applied_program_ids, sent_at on public.qb_quotes");
    expect(compact).toContain("referencing old table as old_price_sheets new table as new_price_sheets");
    expect(compact).toContain("for each statement execute function public.refresh_qb_program_provenance_on_sheet_publish()");
    expect(compact).toContain("with published_sheets as");
    expect(compact).toContain("update public.qb_programs program set source_price_sheet_id = source.price_sheet_id");
    expect(compact).not.toContain("set applied_at = source_row.applied_at");
    expect(compact).toContain("workspace_id, brand_id, status, program_a_id, program_b_id, effective_from, effective_to");
    expect(compact).toContain("include ( can_combine, source_price_sheet_id, reviewed_at, notes )");
    expect(stackingValidator).toContain('.from("qb_program_pair_policies")');
    expect(stackingValidator).toContain('.in("program_a_id", programIds)');
    expect(stackingValidator).toContain('.in("program_b_id", programIds)');
    expect(stackingValidator).toContain("new Map<string, StackingRuleRow>()");
    expect(stackingValidator).not.toContain("typedRules.find");
    expect(stackingValidator).toContain("Customer send is blocked");
    expect(stackingValidator).not.toContain('.from("qb_program_stacking_rules")');
    expect(ownerReconciliation).toContain("A4.3 is not shipped and A7.3 remains source-sheet blocked");
    expect(ownerReconciliation).not.toContain("Existing schema satisfies the decision");
  });

  it("rejects cross-tenant availability recipients and reconciles reassignments", () => {
    expect(compact).toContain("create or replace function public.validate_quote_availability_request_members");
    expect(compact).toContain("assigned_to must be an active member of workspace");
    expect(compact).toContain("current_profile.id = v_request.assigned_to");
    expect(compact).toContain("'cancelled_reason', 'recipient_no_longer_current'");
    expect(compact).toContain("delivery.workspace_id = v_request.workspace_id");
    expect(compact).toContain("existing.workspace_id = v_request.workspace_id");
    expect(compact).toContain("unique (workspace_id, alert_query_id, recipient_user_id, channel)");
    expect(compact).toContain("queued is not delivery proof");
  });

  it("makes mute changes commit through a caller-scoped definer RPC", () => {
    expect(compact).toContain("create or replace function public.set_sales_availability_alert_mute");
    const muteStart = compact.indexOf("create or replace function public.set_sales_availability_alert_mute");
    const muteEnd = compact.indexOf("comment on function public.set_sales_availability_alert_mute", muteStart);
    const mute = compact.slice(muteStart, muteEnd);
    expect(mute).toContain("security definer");
    expect(mute).toContain("active workspace membership required");
    expect(mute).toContain("delivery.recipient_user_id = v_user_id");
    expect(mute).toContain("delivery.status in ('queued', 'muted')");
    expect(compact).toContain("create policy \"sales_alert_preferences_own_select\"");
    expect(compact).not.toContain("create policy \"sales_alert_preferences_own_all\"");
  });
});
