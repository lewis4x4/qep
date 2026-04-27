-- 460_traffic_ticket_comments.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#traffic_ticket.comments_tab.
--
-- Rollback notes:
--   drop trigger if exists set_traffic_ticket_comments_updated_at on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_rep_select" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_rep_scope" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_rep_own_select" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_workspace_select" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_workspace_insert" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_workspace_update" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_delete_elevated" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_all_elevated" on public.traffic_ticket_comments;
--   drop policy if exists "traffic_ticket_comments_service_all" on public.traffic_ticket_comments;
--   drop table if exists public.traffic_ticket_comments;
create table public.traffic_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  traffic_ticket_id uuid not null references public.traffic_tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.traffic_ticket_comments is 'Traffic ticket comments for billing, reported problems, and dispatch collaboration.';

create index idx_traffic_ticket_comments_ticket
  on public.traffic_ticket_comments (workspace_id, traffic_ticket_id, created_at desc)
  where deleted_at is null;
comment on index public.idx_traffic_ticket_comments_ticket is 'Purpose: load comment timeline for a traffic ticket.';

alter table public.traffic_ticket_comments enable row level security;

create policy "traffic_ticket_comments_service_all"
  on public.traffic_ticket_comments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "traffic_ticket_comments_workspace_select"
  on public.traffic_ticket_comments for select
  using (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_ticket_comments_workspace_insert"
  on public.traffic_ticket_comments for insert
  with check (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_ticket_comments_workspace_update"
  on public.traffic_ticket_comments for update
  using (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) is not null
    and workspace_id = (select public.get_my_workspace())
  );

create policy "traffic_ticket_comments_delete_elevated"
  on public.traffic_ticket_comments for delete
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_traffic_ticket_comments_updated_at
  before update on public.traffic_ticket_comments
  for each row execute function public.set_updated_at();
