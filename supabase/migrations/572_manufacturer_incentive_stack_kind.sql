-- Align manufacturer incentive rows with quote resolver/UI stack semantics.

alter table public.manufacturer_incentives
  add column if not exists stack_kind text;

update public.manufacturer_incentives
set stack_kind = case
  when coalesce(stackable, false) then 'always_on'
  else 'cash_alt'
end
where stack_kind is null
   or stack_kind not in ('cash_alt', 'finance_addon', 'always_on');

alter table public.manufacturer_incentives
  alter column stack_kind set default 'always_on',
  alter column stack_kind set not null;

do $do$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manufacturer_incentives_stack_kind_check'
      and conrelid = 'public.manufacturer_incentives'::regclass
  ) then
    alter table public.manufacturer_incentives
      add constraint manufacturer_incentives_stack_kind_check
      check (stack_kind in ('cash_alt', 'finance_addon', 'always_on'));
  end if;
end;
$do$;

comment on column public.manufacturer_incentives.stack_kind is
  'cash_alt = mutually exclusive cash/rebate alternative; finance_addon = additive financing support; always_on = additive incentive.';
