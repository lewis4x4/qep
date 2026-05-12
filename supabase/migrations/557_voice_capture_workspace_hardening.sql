-- Voice capture workspace hardening
--
-- New voice capture edge functions persist workspace_id directly. This migration
-- makes that column part of the schema, deterministically backfills legacy rows
-- when a local QRM deal id is available, and prevents elevated users from
-- reading/updating captures outside their active workspace.

alter table public.voice_captures
  add column if not exists workspace_id text;

comment on column public.voice_captures.workspace_id is
  'Workspace that owns the voice capture. New captures set this at ingest; legacy rows are only backfilled from verified local QRM deal links.';

update public.voice_captures vc
set workspace_id = d.workspace_id
from public.crm_deals d
where vc.workspace_id is null
  and vc.linked_deal_id = d.id
  and d.workspace_id is not null;

update public.voice_captures vc
set workspace_id = d.workspace_id
from public.crm_deals d
where vc.workspace_id is null
  and vc.hubspot_deal_id = d.id::text
  and d.workspace_id is not null;

create index if not exists idx_voice_captures_workspace_created
  on public.voice_captures(workspace_id, created_at desc);

create index if not exists idx_voice_captures_workspace_status
  on public.voice_captures(workspace_id, sync_status);

-- Replace legacy all-workspace elevated policies with active-workspace scoped
-- policies. Legacy rows that still have no deterministic workspace remain
-- visible/editable only to their owner; admins/managers/owners do not get a
-- cross-tenant fallback for null workspace_id rows. Drop every non-service
-- policy first so a permissive legacy policy cannot OR around these checks.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'voice_captures'
      and policyname <> 'voice_captures_service_all'
  loop
    execute format('drop policy if exists %I on public.voice_captures', policy_record.policyname);
  end loop;
end $$;

drop policy if exists "voice_captures_select" on public.voice_captures;
create policy "voice_captures_select" on public.voice_captures
  for select using (
    user_id = auth.uid()
    or (
      workspace_id = public.get_my_workspace()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
      )
    )
  );

drop policy if exists "voice_captures_insert" on public.voice_captures;
create policy "voice_captures_insert" on public.voice_captures
  for insert with check (
    user_id = auth.uid()
    and (workspace_id is null or workspace_id = public.get_my_workspace())
  );

drop policy if exists "voice_captures_update" on public.voice_captures;
create policy "voice_captures_update" on public.voice_captures
  for update using (
    (
      user_id = auth.uid()
      and (workspace_id is null or workspace_id = public.get_my_workspace())
    )
    or (
      workspace_id = public.get_my_workspace()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
      )
    )
  ) with check (
    (
      user_id = auth.uid()
      and (workspace_id is null or workspace_id = public.get_my_workspace())
    )
    or (
      workspace_id = public.get_my_workspace()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager', 'owner')
      )
    )
  );
