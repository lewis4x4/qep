-- 491_employee_wave2_columns.sql
-- Wave 2 additive compatibility columns for employees from Cross-Cutting.
-- Wave 1 already created the table; do not recreate it.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'profit_center_code') then
    create type public.profit_center_code as enum ('0','1','2','3','4','5','6','7','8','9');
  end if;
  if not exists (select 1 from pg_type where typname = 'pay_type') then
    create type public.pay_type as enum ('hourly','salary','commission','piecework','flat_rate');
  end if;
end $$;

alter table public.employees
  add column if not exists profit_center public.profit_center_code,
  add column if not exists category_code text,
  add column if not exists pay_type public.pay_type,
  add column if not exists termination_reason text,
  add column if not exists shop_rate_cents integer,
  add column if not exists shop_rate_effective_from date,
  add column if not exists shift_code text,
  add column if not exists supervisor_id uuid references public.employees(id) on delete set null;

comment on column public.employees.profit_center is '0=Balance Sheet,1=Admin,2=Equipment,3=Parts,4=Service,5=Rental,6-9=User.';
comment on column public.employees.shop_rate_cents is 'Shop labor rate in cents for payroll/WO recovery reconciliation.';
comment on column public.employees.shift_code is 'Legacy shift code; Wave 1 shift_codes table is canonical when joined by workspace/code.';
