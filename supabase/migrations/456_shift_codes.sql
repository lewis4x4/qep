-- 456_shift_codes.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#employee.shift_code.
-- employees.shift_code is stored as text in 455; formal FK can be added after both foundations exist if required.
--
-- Rollback notes:
--   drop trigger if exists set_shift_codes_updated_at on public.shift_codes;
--   drop policy if exists "shift_codes_rep_select" on public.shift_codes;
--   drop policy if exists "shift_codes_rep_scope" on public.shift_codes;
--   drop policy if exists "shift_codes_rep_own_select" on public.shift_codes;
--   drop policy if exists "shift_codes_workspace_select" on public.shift_codes;
--   drop policy if exists "shift_codes_workspace_insert" on public.shift_codes;
--   drop policy if exists "shift_codes_workspace_update" on public.shift_codes;
--   drop policy if exists "shift_codes_delete_elevated" on public.shift_codes;
--   drop policy if exists "shift_codes_all_elevated" on public.shift_codes;
--   drop policy if exists "shift_codes_service_all" on public.shift_codes;
--   drop table if exists public.shift_codes;
create table public.shift_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  description text,
  start_time time,
  end_time time,
  days_of_week integer[],
  ot_multiplier numeric(6,3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.shift_codes is 'Shift-code lookup for employee scheduling, payroll, overtime, and dispatch eligibility.';

alter table public.shift_codes enable row level security;

create policy "shift_codes_service_all"
  on public.shift_codes for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "shift_codes_all_elevated"
  on public.shift_codes for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "shift_codes_rep_select"
  on public.shift_codes for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_shift_codes_updated_at
  before update on public.shift_codes
  for each row execute function public.set_updated_at();
