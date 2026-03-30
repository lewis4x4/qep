-- CRM Slice 2 (E2a/E2b): durable quote persistence + CRM linkage.
-- Adds quotes table, workspace-bound RLS, quote mutation audit, and
-- deal list performance index for stage/rep filtering.

-- ── Quotes table ────────────────────────────────────────────────────────────
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  crm_deal_id uuid references public.crm_deals(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'linked', 'archived')),
  title text,
  line_items jsonb not null default '[]'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (jsonb_typeof(line_items) = 'array'),
  check (jsonb_typeof(customer_snapshot) = 'object'),
  check (jsonb_typeof(metadata) = 'object'),
  check (status <> 'linked' or crm_contact_id is not null or crm_deal_id is not null)
);

create index if not exists idx_quotes_workspace_created
  on public.quotes (workspace_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_quotes_workspace_contact
  on public.quotes (workspace_id, crm_contact_id)
  where crm_contact_id is not null and deleted_at is null;

create index if not exists idx_quotes_workspace_deal
  on public.quotes (workspace_id, crm_deal_id)
  where crm_deal_id is not null and deleted_at is null;

create index if not exists idx_crm_deals_workspace_stage_rep
  on public.crm_deals (workspace_id, stage_id, assigned_rep_id)
  where deleted_at is null;

drop trigger if exists set_quotes_updated_at on public.quotes;
create trigger set_quotes_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- ── Quote mutation audit trail ──────────────────────────────────────────────
create table if not exists public.crm_quote_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event_type text not null check (event_type in ('quote_created', 'quote_updated', 'quote_linked', 'quote_archived')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_quote_audit_workspace_created
  on public.crm_quote_audit_events (workspace_id, created_at desc);

create index if not exists idx_crm_quote_audit_quote_created
  on public.crm_quote_audit_events (quote_id, created_at desc);

create or replace function public.log_quote_mutation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_type text;
  request_id text;
begin
  if tg_op = 'INSERT' then
    event_type := case when new.status = 'linked' then 'quote_linked' else 'quote_created' end;
  else
    event_type := case
      when new.status = 'linked' and old.status is distinct from new.status then 'quote_linked'
      when new.status = 'archived' and old.status is distinct from new.status then 'quote_archived'
      else 'quote_updated'
    end;
  end if;

  request_id := nullif(current_setting('request.header.x-request-id', true), '');

  insert into public.crm_quote_audit_events (
    workspace_id,
    quote_id,
    event_type,
    actor_user_id,
    request_id,
    metadata
  )
  values (
    new.workspace_id,
    new.id,
    event_type,
    auth.uid(),
    request_id,
    jsonb_build_object(
      'status', new.status,
      'crm_contact_id', new.crm_contact_id,
      'crm_deal_id', new.crm_deal_id
    )
  );

  return new;
end;
$$;

revoke execute on function public.log_quote_mutation_event() from public;
revoke execute on function public.log_quote_mutation_event() from authenticated;
grant execute on function public.log_quote_mutation_event() to service_role;

drop trigger if exists trg_quotes_log_mutation on public.quotes;
create trigger trg_quotes_log_mutation
  after insert or update on public.quotes
  for each row execute function public.log_quote_mutation_event();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.quotes enable row level security;
alter table public.crm_quote_audit_events enable row level security;

drop policy if exists "quotes_service_all" on public.quotes;
drop policy if exists "quotes_all_elevated_workspace" on public.quotes;
drop policy if exists "quotes_rep_select_scope" on public.quotes;
drop policy if exists "quotes_rep_insert_scope" on public.quotes;
drop policy if exists "quotes_rep_update_scope" on public.quotes;
drop policy if exists "quotes_rep_delete_own" on public.quotes;

create policy "quotes_service_all"
  on public.quotes
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "quotes_all_elevated_workspace"
  on public.quotes
  for all
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "quotes_rep_select_scope"
  on public.quotes
  for select
  using (
    public.get_my_role() = 'rep'
    and workspace_id = public.get_my_workspace()
    and (
      created_by = auth.uid()
      or (crm_contact_id is not null and public.crm_rep_can_access_contact(crm_contact_id))
      or (crm_deal_id is not null and public.crm_rep_can_access_deal(crm_deal_id))
    )
  );

create policy "quotes_rep_insert_scope"
  on public.quotes
  for insert
  with check (
    public.get_my_role() = 'rep'
    and workspace_id = public.get_my_workspace()
    and created_by = auth.uid()
    and (
      status <> 'linked'
      or (
        (crm_contact_id is not null and public.crm_rep_can_access_contact(crm_contact_id))
        or (crm_deal_id is not null and public.crm_rep_can_access_deal(crm_deal_id))
      )
    )
  );

create policy "quotes_rep_update_scope"
  on public.quotes
  for update
  using (
    public.get_my_role() = 'rep'
    and workspace_id = public.get_my_workspace()
    and (
      created_by = auth.uid()
      or (crm_contact_id is not null and public.crm_rep_can_access_contact(crm_contact_id))
      or (crm_deal_id is not null and public.crm_rep_can_access_deal(crm_deal_id))
    )
  )
  with check (
    public.get_my_role() = 'rep'
    and workspace_id = public.get_my_workspace()
    and (
      created_by = auth.uid()
      or (crm_contact_id is not null and public.crm_rep_can_access_contact(crm_contact_id))
      or (crm_deal_id is not null and public.crm_rep_can_access_deal(crm_deal_id))
    )
    and (
      status <> 'linked'
      or (
        (crm_contact_id is not null and public.crm_rep_can_access_contact(crm_contact_id))
        or (crm_deal_id is not null and public.crm_rep_can_access_deal(crm_deal_id))
      )
    )
  );

create policy "quotes_rep_delete_own"
  on public.quotes
  for delete
  using (
    public.get_my_role() = 'rep'
    and workspace_id = public.get_my_workspace()
    and created_by = auth.uid()
  );

drop policy if exists "crm_quote_audit_events_service_all" on public.crm_quote_audit_events;
drop policy if exists "crm_quote_audit_events_select_elevated_workspace" on public.crm_quote_audit_events;

create policy "crm_quote_audit_events_service_all"
  on public.crm_quote_audit_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_quote_audit_events_select_elevated_workspace"
  on public.crm_quote_audit_events
  for select
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

grant select, insert, update, delete on public.quotes to authenticated;
grant select on public.crm_quote_audit_events to authenticated;

comment on table public.quotes is
  'CRM-linked quotes with durable contact/deal references and workspace-bound RLS policies.';

comment on table public.crm_quote_audit_events is
  'Append-only quote mutation audit events with request correlation ids when available.';

-- ── Rollback DDL (manual, reverse dependency order) ────────────────────────
-- drop policy if exists "crm_quote_audit_events_select_elevated_workspace" on public.crm_quote_audit_events;
-- drop policy if exists "crm_quote_audit_events_service_all" on public.crm_quote_audit_events;
-- drop policy if exists "quotes_rep_delete_own" on public.quotes;
-- drop policy if exists "quotes_rep_update_scope" on public.quotes;
-- drop policy if exists "quotes_rep_insert_scope" on public.quotes;
-- drop policy if exists "quotes_rep_select_scope" on public.quotes;
-- drop policy if exists "quotes_all_elevated_workspace" on public.quotes;
-- drop policy if exists "quotes_service_all" on public.quotes;
-- drop trigger if exists trg_quotes_log_mutation on public.quotes;
-- drop function if exists public.log_quote_mutation_event();
-- drop trigger if exists set_quotes_updated_at on public.quotes;
-- drop table if exists public.crm_quote_audit_events;
-- drop table if exists public.quotes;
-- drop index if exists idx_crm_deals_workspace_stage_rep;
