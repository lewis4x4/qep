-- 493_profile_salesperson_wave2_columns.sql
-- Wave 2 profile extension from Phase-9 customer.salesperson.

alter table public.profiles
  add column if not exists salesperson_code text;

comment on column public.profiles.salesperson_code is 'Short alpha code used historically in IntelliDealer for sales attribution; rendered on Account 360 and traffic tickets.';

create unique index if not exists idx_profiles_salesperson_code
  on public.profiles(active_workspace_id, salesperson_code)
  where salesperson_code is not null;
comment on index public.idx_profiles_salesperson_code is 'Purpose: salesperson-code lookup/uniqueness inside the active workspace.';
