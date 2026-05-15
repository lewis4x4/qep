-- ============================================================================
-- Migration 566: post-approval send routing preference
-- ============================================================================

alter table public.quote_packages
  add column if not exists post_approval_action text not null default 'return_to_rep';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_packages_post_approval_action_check'
  ) then
    alter table public.quote_packages
      add constraint quote_packages_post_approval_action_check
      check (post_approval_action in ('auto_send_customer', 'return_to_rep'));
  end if;
end$$;

comment on column public.quote_packages.post_approval_action is
  'Controls whether approved quote auto-sends to customer or routes back to rep send panel.';
