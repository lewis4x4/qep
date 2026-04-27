-- 413_parts_memos.sql
--
-- Wave 1B: IntelliDealer Parts Profile memos/comments from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#part.memos.
--
-- Rollback notes:
--   drop trigger if exists set_parts_memos_updated_at on public.parts_memos;
--   drop policy if exists "parts_memos_rep_scope" on public.parts_memos;
--   drop policy if exists "parts_memos_all_elevated" on public.parts_memos;
--   drop policy if exists "parts_memos_service_all" on public.parts_memos;
--   drop table if exists public.parts_memos;

create table public.parts_memos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  part_catalog_id uuid not null references public.parts_catalog(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.parts_memos is
  'Pinned and historical buyer/counter-staff memos attached to Parts Profile records.';

create index idx_parts_memos_part_pinned
  on public.parts_memos (workspace_id, part_catalog_id, pinned desc, created_at desc)
  where deleted_at is null;
comment on index public.idx_parts_memos_part_pinned is
  'Purpose: load pinned banners and chronological memo history on the Parts Profile.';

alter table public.parts_memos enable row level security;

create policy "parts_memos_service_all"
  on public.parts_memos for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "parts_memos_all_elevated"
  on public.parts_memos for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "parts_memos_rep_scope"
  on public.parts_memos for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_parts_memos_updated_at
  before update on public.parts_memos
  for each row execute function public.set_updated_at();
