-- ============================================================================
-- Migration 563: rebate stack kind tagging
--
-- Allows resolver/UI to distinguish additive vs. mutually-exclusive rebates.
-- ============================================================================

alter table public.qb_programs
  add column if not exists stack_kind text not null default 'always_on';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qb_programs_stack_kind_check'
  ) then
    alter table public.qb_programs
      add constraint qb_programs_stack_kind_check
      check (stack_kind in ('cash_alt', 'finance_addon', 'always_on'));
  end if;
end$$;

comment on column public.qb_programs.stack_kind is
  'cash_alt = choose cash OR finance incentive path; finance_addon = stackable finance add-on; always_on = always applicable.';
