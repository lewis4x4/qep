-- ============================================================================
-- Migration 555: Surface authorityBand as a Flow Admin policy toggle
-- ============================================================================
--
-- Today the edge function (supabase/functions/quote-builder-v2/index.ts:5430)
-- hard-pins authorityBand to 'owner_admin' on every quote submission. That
-- bypasses the branch_sales_manager / branch_general_manager resolution path
-- entirely and lands the approval on a workspace owner.
--
-- This migration adds the column so the same policy table that already
-- governs SLA hours, margin floors, named-branch fallbacks, and allowed
-- condition types can also drive the routing band. The default is
-- 'owner_admin' so the rollout is non-behavioural for existing tenants —
-- the override is opt-in via Flow Admin.
--
-- Constraint mirrors the TypeScript union in shared/qep-moonshot-contracts.ts.

alter table public.quote_approval_policies
  add column if not exists authority_band text not null default 'owner_admin';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_approval_policies_authority_band_check'
  ) then
    alter table public.quote_approval_policies
      add constraint quote_approval_policies_authority_band_check
      check (authority_band in ('branch_manager', 'owner_admin'));
  end if;
end$$;

comment on column public.quote_approval_policies.authority_band is
  'Routing band for quote approval notifications: owner_admin routes to workspace owners/admins; branch_manager routes through branch sales/general manager chain.';
