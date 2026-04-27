-- 462_record_change_history.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#audit.field_level_change_history.
--
-- Rollback notes:
--   drop trigger if exists set_record_change_history_updated_at on public.record_change_history;
--   drop policy if exists "record_change_history_rep_select" on public.record_change_history;
--   drop policy if exists "record_change_history_rep_scope" on public.record_change_history;
--   drop policy if exists "record_change_history_rep_own_select" on public.record_change_history;
--   drop policy if exists "record_change_history_workspace_select" on public.record_change_history;
--   drop policy if exists "record_change_history_workspace_insert" on public.record_change_history;
--   drop policy if exists "record_change_history_workspace_update" on public.record_change_history;
--   drop policy if exists "record_change_history_delete_elevated" on public.record_change_history;
--   drop policy if exists "record_change_history_all_elevated" on public.record_change_history;
--   drop policy if exists "record_change_history_service_all" on public.record_change_history;
--   drop table if exists public.record_change_history;
create table public.record_change_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  table_name text not null,
  record_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('insert','update','delete')),
  changed_fields jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.record_change_history is 'Field-level change history foundation for auditable workspace records.';

create index idx_record_change_history_record
  on public.record_change_history (workspace_id, table_name, record_id, occurred_at desc)
  where deleted_at is null;
comment on index public.idx_record_change_history_record is 'Purpose: load audit trail for a specific table record.';

alter table public.record_change_history enable row level security;

create policy "record_change_history_service_all"
  on public.record_change_history for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "record_change_history_all_elevated"
  on public.record_change_history for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_record_change_history_updated_at
  before update on public.record_change_history
  for each row execute function public.set_updated_at();
