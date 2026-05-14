-- ============================================================================
-- Migration 559: Rep workspace-wide CRM read for customer discovery (Quote Builder)
--
-- Problem: profiles.role = 'rep' (Sales Rep / Iron Advisor) only matched
-- crm_*_select_rep_scope policies, which require crm_rep_can_access_company /
-- crm_rep_can_access_contact (assigned rep or territory). Quote Builder and
-- QRM search use direct reads on crm_companies / crm_contacts views — reps saw
-- zero rows for everyone else's book of business.
--
-- Fix: Add PERMISSIVE SELECT policies so reps can read all non-deleted rows in
-- their active workspace for discovery. Existing insert/update policies and
-- the original rep_scope SELECT remain unchanged (writes still assignment-based).
-- Elevated roles unchanged (already workspace-scoped via 556).
-- ============================================================================

drop policy if exists "crm_companies_select_rep_workspace_directory" on public.qrm_companies;
create policy "crm_companies_select_rep_workspace_directory"
  on public.qrm_companies
  for select
  using (
    (select public.get_my_role()) = 'rep'
    and (select public.get_my_workspace()) is not null
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

comment on policy "crm_companies_select_rep_workspace_directory" on public.qrm_companies is
  'Reps: read all companies in active workspace for search/quote intake; writes still enforced by other policies.';

drop policy if exists "crm_contacts_select_rep_workspace_directory" on public.qrm_contacts;
create policy "crm_contacts_select_rep_workspace_directory"
  on public.qrm_contacts
  for select
  using (
    (select public.get_my_role()) = 'rep'
    and (select public.get_my_workspace()) is not null
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

comment on policy "crm_contacts_select_rep_workspace_directory" on public.qrm_contacts is
  'Reps: read all contacts in active workspace for search/quote intake; writes still enforced by other policies.';
