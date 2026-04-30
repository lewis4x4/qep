-- 509_intellidealer_ar_type_true_balance_forward.sql
--
-- Migration 508 adds the enum value, but PostgreSQL does not allow using a
-- newly added enum value inside the same transaction. Refresh the mapper here
-- so IntelliDealer CMASTR A/R type T imports as true balance forward.

create or replace function public.qrm_intellidealer_ar_type_code(p_code text)
returns public.ar_type
language sql
immutable
set search_path = public
as $$
  select case trim(coalesce(p_code, ''))
    when 'O' then 'open_item'::public.ar_type
    when 'B' then 'balance_forward'::public.ar_type
    when 'T' then 'true_balance_forward'::public.ar_type
    else 'open_item'::public.ar_type
  end;
$$;

comment on function public.qrm_intellidealer_ar_type_code(text) is
  'Maps IntelliDealer CMASTR A/R type codes O/B/T to QRM ar_type values.';
