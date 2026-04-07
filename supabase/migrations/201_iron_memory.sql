-- ============================================================================
-- Migration 201: Wave 7 Iron Companion v1.8 — cross-system memory affinity
--
-- Mission-lock transformational deliverable per v3 plan §V3-16: Iron's
-- recall feels psychic because the entity_picker surfaces the most-recently-
-- touched records first, drawing signal from native QRM use — not just from
-- past Iron conversations.
--
-- Architecture:
--   • iron_memory table: per-(user, entity_type, entity_id) score
--   • iron_bump_memory(user, entity_type, entity_id, action) RPC: atomic
--     upsert. Insert at score=1.0; on conflict bump by +0.1 capped at 1.0,
--     increment access_count, set last_accessed_at = now().
--   • iron_decay_memory() RPC: nightly-callable. Multiplies score by 0.98
--     for rows idle >1 day, hard-prunes <0.05 + idle >30d, hard-prunes
--     idle >180d unconditionally.
--   • Triggers on six tables. ALL triggers use auth.uid() (the touching
--     user) — NOT row-owner columns. If A edits B's customer, the bump
--     goes to A. Service-role writes (auth.uid() is null) are skipped.
--   • Per-trigger linked-entity bumps for cross-system signal: editing a
--     parts order bumps the linked qrm_companies row, not the parts order
--     itself.
--
-- Workspace pattern: text default get_my_workspace(), no FK to a nonexistent
-- workspaces table.
--
-- Note on table names: migration 170 renamed crm_* tables to qrm_* and made
-- crm_* compat views. Triggers in this migration target the underlying
-- qrm_* tables. Iron flow definitions are updated in the same slice to use
-- the qrm_* strings as canonical entity_table values.
-- ============================================================================

-- ── 1. iron_memory table ──────────────────────────────────────────────────

create table if not exists public.iron_memory (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  entity_type text not null
    check (entity_type in (
      'qrm_companies', 'qrm_contacts', 'qrm_equipment',
      'parts_orders', 'service_jobs', 'rental_returns'
    )),
  entity_id uuid not null,
  relevance_score numeric(4, 3) not null default 1.000
    check (relevance_score >= 0.000 and relevance_score <= 1.000),
  access_count integer not null default 1,
  last_action_type text not null default 'system',
  first_seen_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

comment on table public.iron_memory is
  'Wave 7 Iron Companion v1.8: per-user, per-entity affinity scores. Bumped by triggers on touch, decayed nightly. Powers the entity_picker pre-fill ordering in Iron flows.';

-- Performance index for the entity_picker merge query: "give me the user's
-- top-N entities of type X, ordered by relevance + recency".
create index if not exists idx_iron_memory_user_type_score
  on public.iron_memory (user_id, entity_type, relevance_score desc, last_accessed_at desc);

-- Index for the decay sweep
create index if not exists idx_iron_memory_decay
  on public.iron_memory (last_accessed_at)
  where relevance_score > 0;

alter table public.iron_memory enable row level security;

create policy iron_memory_self_read on public.iron_memory for select
  using (workspace_id = public.get_my_workspace() and user_id = auth.uid());

create policy iron_memory_manager_read on public.iron_memory for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_memory_service_all on public.iron_memory for all
  to service_role using (true) with check (true);

-- The bump RPC runs SECURITY DEFINER and is granted to authenticated, so
-- direct inserts/updates from end users are not needed via the table itself.

-- ── 2. iron_bump_memory RPC ───────────────────────────────────────────────
--
-- Atomic upsert called from triggers AND from the client (when the user
-- picks an entity in an Iron flow's entity_picker). Caps the score at 1.0
-- and never lets a successful bump take the score downward.

create or replace function public.iron_bump_memory(
  p_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action_type text default 'touch'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace text;
begin
  -- Skip silent failures: null user (service role write), null entity, or
  -- unknown entity type. The check constraint will reject unknown types
  -- anyway, but we want the trigger to be a no-op rather than an error.
  if p_user_id is null or p_entity_id is null then return; end if;
  if p_entity_type not in (
    'qrm_companies', 'qrm_contacts', 'qrm_equipment',
    'parts_orders', 'service_jobs', 'rental_returns'
  ) then return; end if;

  v_workspace := coalesce(public.get_my_workspace(), 'default');

  insert into public.iron_memory
    (user_id, workspace_id, entity_type, entity_id,
     relevance_score, access_count, last_action_type,
     first_seen_at, last_accessed_at)
  values
    (p_user_id, v_workspace, p_entity_type, p_entity_id,
     1.000, 1, coalesce(p_action_type, 'touch'),
     now(), now())
  on conflict (user_id, entity_type, entity_id) do update
    set relevance_score = least(1.000, public.iron_memory.relevance_score + 0.100),
        access_count = public.iron_memory.access_count + 1,
        last_action_type = coalesce(excluded.last_action_type, public.iron_memory.last_action_type),
        last_accessed_at = now();
end;
$$;

revoke execute on function public.iron_bump_memory(uuid, text, uuid, text) from public;
grant execute on function public.iron_bump_memory(uuid, text, uuid, text) to authenticated, service_role;

-- ── 3. iron_decay_memory RPC ──────────────────────────────────────────────
--
-- Nightly-callable. Multiplies relevance_score by 0.98 for rows idle >1 day.
-- Hard-prunes the long tail.
-- Returns counts as { decayed, pruned } so the caller can audit.

create or replace function public.iron_decay_memory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decayed integer;
  v_pruned_low integer;
  v_pruned_old integer;
begin
  -- Decay step
  with updated as (
    update public.iron_memory
    set relevance_score = round(relevance_score * 0.98, 3)
    where last_accessed_at < now() - interval '1 day'
      and relevance_score > 0
    returning user_id
  )
  select count(*) into v_decayed from updated;

  -- Hard prune: dead-and-old
  with deleted as (
    delete from public.iron_memory
    where relevance_score < 0.05
      and last_accessed_at < now() - interval '30 days'
    returning user_id
  )
  select count(*) into v_pruned_low from deleted;

  -- Hard prune: very old regardless of score
  with deleted as (
    delete from public.iron_memory
    where last_accessed_at < now() - interval '180 days'
    returning user_id
  )
  select count(*) into v_pruned_old from deleted;

  return jsonb_build_object(
    'decayed', v_decayed,
    'pruned_low_score', v_pruned_low,
    'pruned_aged_out', v_pruned_old,
    'ran_at', now()
  );
end;
$$;

revoke execute on function public.iron_decay_memory() from public;
grant execute on function public.iron_decay_memory() to service_role;

-- ── 4. Direct-touch trigger functions ─────────────────────────────────────
--
-- These bump the touched row itself for the user who issued the statement.

create or replace function public.iron_memory_bump_self_qrm_companies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_companies', new.id, tg_op);
  end if;
  return new;
end;
$$;

create or replace function public.iron_memory_bump_self_qrm_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_contacts', new.id, tg_op);
  end if;
  return new;
end;
$$;

create or replace function public.iron_memory_bump_self_qrm_equipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_equipment', new.id, tg_op);
  end if;
  return new;
end;
$$;

-- ── 5. Linked-entity trigger functions ────────────────────────────────────
--
-- Cross-system signal: editing a parts order bumps the linked company,
-- editing a service job bumps the linked company + contact + machine,
-- editing a rental return bumps the linked equipment. The mission lift —
-- this is what makes Iron's recall feel psychic because the user touched
-- the entity through a different surface entirely.

create or replace function public.iron_memory_bump_from_parts_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  -- parts_orders has a crm_company_id column (still named crm_*; the FK
  -- followed the qrm_ rename automatically per migration 170).
  if new.crm_company_id is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_companies', new.crm_company_id, 'parts_order_' || tg_op);
  end if;
  return new;
end;
$$;

create or replace function public.iron_memory_bump_from_service_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  if new.customer_id is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_companies', new.customer_id, 'service_job_' || tg_op);
  end if;
  if new.contact_id is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_contacts', new.contact_id, 'service_job_' || tg_op);
  end if;
  if new.machine_id is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_equipment', new.machine_id, 'service_job_' || tg_op);
  end if;
  return new;
end;
$$;

create or replace function public.iron_memory_bump_from_rental_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  if new.equipment_id is not null then
    perform public.iron_bump_memory(v_uid, 'qrm_equipment', new.equipment_id, 'rental_return_' || tg_op);
  end if;
  return new;
end;
$$;

-- ── 6. Trigger registration ───────────────────────────────────────────────
--
-- AFTER triggers (read-only side effect via the SECURITY DEFINER bump RPC).
-- INSERT and UPDATE only — DELETE doesn't get a bump since the entity is gone.
-- Each registration is idempotent (drop-then-create).

drop trigger if exists trg_iron_memory_qrm_companies on public.qrm_companies;
create trigger trg_iron_memory_qrm_companies
  after insert or update on public.qrm_companies
  for each row execute function public.iron_memory_bump_self_qrm_companies();

drop trigger if exists trg_iron_memory_qrm_contacts on public.qrm_contacts;
create trigger trg_iron_memory_qrm_contacts
  after insert or update on public.qrm_contacts
  for each row execute function public.iron_memory_bump_self_qrm_contacts();

drop trigger if exists trg_iron_memory_qrm_equipment on public.qrm_equipment;
create trigger trg_iron_memory_qrm_equipment
  after insert or update on public.qrm_equipment
  for each row execute function public.iron_memory_bump_self_qrm_equipment();

drop trigger if exists trg_iron_memory_parts_orders on public.parts_orders;
create trigger trg_iron_memory_parts_orders
  after insert or update on public.parts_orders
  for each row execute function public.iron_memory_bump_from_parts_order();

drop trigger if exists trg_iron_memory_service_jobs on public.service_jobs;
create trigger trg_iron_memory_service_jobs
  after insert or update on public.service_jobs
  for each row execute function public.iron_memory_bump_from_service_job();

drop trigger if exists trg_iron_memory_rental_returns on public.rental_returns;
create trigger trg_iron_memory_rental_returns
  after insert or update on public.rental_returns
  for each row execute function public.iron_memory_bump_from_rental_return();
