-- 461_traffic_calendar_memos.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#traffic_ticket.weekly_memo.
--
-- Rollback notes:
--   drop trigger if exists set_traffic_calendar_memos_updated_at on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_rep_select" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_rep_scope" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_rep_own_select" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_workspace_select" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_workspace_insert" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_workspace_update" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_delete_elevated" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_all_elevated" on public.traffic_calendar_memos;
--   drop policy if exists "traffic_calendar_memos_service_all" on public.traffic_calendar_memos;
--   drop table if exists public.traffic_calendar_memos;
create table public.traffic_calendar_memos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  memo_date date not null,
  body text not null,
  urgency text check (urgency in ('low','medium','high')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.traffic_calendar_memos is 'Weekly traffic calendar memos with urgency for dispatch planning.';

create index idx_traffic_calendar_memos_date
  on public.traffic_calendar_memos (workspace_id, memo_date desc)
  where deleted_at is null;
comment on index public.idx_traffic_calendar_memos_date is 'Purpose: traffic calendar memo lookup by date.';

alter table public.traffic_calendar_memos enable row level security;

create policy "traffic_calendar_memos_service_all"
  on public.traffic_calendar_memos for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "traffic_calendar_memos_workspace_select"
  on public.traffic_calendar_memos for select
  using (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_calendar_memos_workspace_insert"
  on public.traffic_calendar_memos for insert
  with check (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_calendar_memos_workspace_update"
  on public.traffic_calendar_memos for update
  using (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_calendar_memos_delete_elevated"
  on public.traffic_calendar_memos for delete
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_traffic_calendar_memos_updated_at
  before update on public.traffic_calendar_memos
  for each row execute function public.set_updated_at();
