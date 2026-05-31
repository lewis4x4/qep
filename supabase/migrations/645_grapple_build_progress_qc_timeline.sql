-- ============================================================================
-- Migration 645: Stream I grapple-truck progress visibility, final QC release gate,
-- and build timeline reporting
--
-- Completes Stream I slice 3:
-- - I5.1 build-progress sheets to sales + service (read-only cross-dept view)
-- - I6.1 final QC checklist + assigned Lead sign-off release gate
-- - I7.1 build-timeline reporting from grapple_build_stage_events (no duplicate log)
-- ============================================================================

-- ── I5.1 read-only progress visibility helper --------------------------------

create or replace function public.grapple_build_can_read_progress(p_workspace_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.role()) = 'service_role'
    or (
      p_workspace_id = (select public.get_my_workspace())
      and coalesce((select public.get_my_role())::text, '') in (
        'rep',
        'service_writer',
        'technician',
        'parts_counter',
        'dispatch',
        'finance_admin',
        'admin',
        'manager',
        'owner'
      )
    );
$$;

comment on function public.grapple_build_can_read_progress(text) is
  'I5.1 read-only cross-department helper: sales reps and service department roles can see grapple-build progress/timeline in their workspace without gaining build management rights.';

revoke execute on function public.grapple_build_can_read_progress(text) from public;
grant execute on function public.grapple_build_can_read_progress(text) to authenticated, service_role;

-- RLS read policies that are deliberately SELECT-only. Existing insert/update/delete
-- policies remain tied to public.grapple_build_can_manage / child can_manage.
drop policy if exists "grapple_builds_select_progress_sales_service" on public.grapple_builds;
create policy "grapple_builds_select_progress_sales_service" on public.grapple_builds for select
  using (deleted_at is null and public.grapple_build_can_read_progress(workspace_id));

drop policy if exists "grapple_build_stage_events_select_progress_sales_service" on public.grapple_build_stage_events;
create policy "grapple_build_stage_events_select_progress_sales_service" on public.grapple_build_stage_events for select
  using (
    exists (
      select 1
      from public.grapple_builds gb
      where gb.id = grapple_build_stage_events.build_id
        and gb.workspace_id = grapple_build_stage_events.workspace_id
        and gb.deleted_at is null
        and public.grapple_build_can_read_progress(gb.workspace_id)
    )
  );

-- ── I6.1 final QC checklist entity ------------------------------------------

create table if not exists public.grapple_build_final_qc_checklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  checklist_number integer not null default 1,
  status text not null default 'draft',
  overall_result text,
  qc_performed_by uuid references public.profiles(id) on delete set null,
  qc_performed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  lead_signed_by uuid references public.profiles(id) on delete set null,
  lead_signed_at timestamptz,
  lead_signature_name text,
  lead_signature_statement text,
  notes text,
  item_count integer not null default 0,
  passed_item_count integer not null default 0,
  failed_item_count integer not null default 0,
  rework_required_count integer not null default 0,
  unchecked_item_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (checklist_number > 0),
  check (status in ('draft', 'in_progress', 'submitted', 'signed', 'void')),
  check (overall_result is null or overall_result in ('pass', 'fail', 'needs_rework', 'not_applicable')),
  check (item_count >= 0 and passed_item_count >= 0 and failed_item_count >= 0 and rework_required_count >= 0 and unchecked_item_count >= 0),
  check (passed_item_count <= item_count and failed_item_count <= item_count and rework_required_count <= item_count and unchecked_item_count <= item_count),
  check (completed_at is null or qc_performed_at is null or completed_at >= qc_performed_at),
  check (lead_signed_at is null or completed_at is null or lead_signed_at >= completed_at),
  check (
    status <> 'signed'
    or (
      overall_result = 'pass'
      and item_count > 0
      and failed_item_count = 0
      and rework_required_count = 0
      and unchecked_item_count = 0
      and completed_by is not null
      and completed_at is not null
      and lead_signed_by is not null
      and lead_signed_at is not null
      and nullif(trim(lead_signature_name), '') is not null
    )
  )
);

comment on table public.grapple_build_final_qc_checklists is
  'I6.1 final QC checklist header attached to a standalone grapple_build. A signed/pass checklist plus assigned Lead sign-off is required before production_complete release.';
comment on column public.grapple_build_final_qc_checklists.lead_signed_by is
  'Assigned build Lead who signs the final QC checklist for release. The release gate verifies this matches grapple_builds.assigned_lead_id.';

create table if not exists public.grapple_build_final_qc_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  checklist_id uuid not null references public.grapple_build_final_qc_checklists(id) on delete cascade,
  section_key text not null default 'final_qc',
  item_key text not null,
  display_order integer not null default 0,
  prompt text not null,
  result text not null default 'not_checked',
  measured_value text,
  notes text,
  defect_severity text,
  rework_required boolean not null default false,
  checked_by uuid references public.profiles(id) on delete set null,
  checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (checklist_id, item_key),
  check (display_order >= 0),
  check (result in ('not_checked', 'pass', 'fail', 'not_applicable')),
  check (defect_severity is null or defect_severity in ('minor', 'major', 'critical')),
  check (result <> 'fail' or defect_severity is not null or rework_required = true),
  check (result = 'not_checked' or checked_at is not null)
);

comment on table public.grapple_build_final_qc_items is
  'I6.1 final QC checklist line items for release-critical grapple-build checks.';

create unique index if not exists idx_grapple_build_final_qc_checklists_build_number_live
  on public.grapple_build_final_qc_checklists(build_id, checklist_number)
  where deleted_at is null;
create index if not exists idx_grapple_build_final_qc_checklists_build_status
  on public.grapple_build_final_qc_checklists(build_id, status, updated_at desc)
  where deleted_at is null;
create index if not exists idx_grapple_build_final_qc_checklists_workspace_status
  on public.grapple_build_final_qc_checklists(workspace_id, status, updated_at desc)
  where deleted_at is null;
create index if not exists idx_grapple_build_final_qc_items_checklist
  on public.grapple_build_final_qc_items(checklist_id, display_order, item_key)
  where deleted_at is null;
create index if not exists idx_grapple_build_final_qc_items_build_result
  on public.grapple_build_final_qc_items(build_id, result)
  where deleted_at is null;

create or replace function public.grapple_build_final_qc_item_sync_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text;
  v_build_id uuid;
begin
  select c.workspace_id, c.build_id
    into v_workspace_id, v_build_id
  from public.grapple_build_final_qc_checklists c
  where c.id = new.checklist_id
    and c.deleted_at is null;

  if v_build_id is null then
    raise exception 'final QC checklist % not found for item row', new.checklist_id using errcode = '23503';
  end if;

  if new.build_id is not null and new.build_id is distinct from v_build_id then
    raise exception 'final QC item build_id must match checklist parent' using errcode = '23514';
  end if;

  new.workspace_id := v_workspace_id;
  new.build_id := v_build_id;

  if new.result <> 'not_checked' and new.checked_at is null then
    new.checked_at := now();
  end if;

  return new;
end;
$$;

comment on function public.grapple_build_final_qc_item_sync_parent() is
  'I6.1 workspace/build sync guard for final QC item rows.';

create or replace function public.grapple_build_final_qc_recalculate(p_checklist_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.grapple_build_final_qc_checklists c
  set item_count = totals.item_count,
      passed_item_count = totals.passed_item_count,
      failed_item_count = totals.failed_item_count,
      rework_required_count = totals.rework_required_count,
      unchecked_item_count = totals.unchecked_item_count,
      overall_result = case
        when c.status = 'void' then c.overall_result
        when totals.item_count = 0 then null
        when totals.failed_item_count > 0 then 'fail'
        when totals.rework_required_count > 0 then 'needs_rework'
        when totals.unchecked_item_count > 0 then c.overall_result
        else 'pass'
      end,
      updated_at = now()
  from (
    select
      count(*)::integer as item_count,
      count(*) filter (where result = 'pass')::integer as passed_item_count,
      count(*) filter (where result = 'fail')::integer as failed_item_count,
      count(*) filter (where rework_required)::integer as rework_required_count,
      count(*) filter (where result = 'not_checked')::integer as unchecked_item_count
    from public.grapple_build_final_qc_items
    where checklist_id = p_checklist_id
      and deleted_at is null
  ) totals
  where c.id = p_checklist_id;
end;
$$;

comment on function public.grapple_build_final_qc_recalculate(uuid) is
  'I6.1 rollup helper for final QC checklist item/pass/fail/rework counts.';

create or replace function public.grapple_build_final_qc_items_after_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.grapple_build_final_qc_recalculate(old.checklist_id);
  end if;

  if tg_op = 'INSERT' then
    perform public.grapple_build_final_qc_recalculate(new.checklist_id);
  elsif tg_op = 'UPDATE' and new.checklist_id is distinct from old.checklist_id then
    perform public.grapple_build_final_qc_recalculate(new.checklist_id);
  end if;

  return null;
end;
$$;

comment on function public.grapple_build_final_qc_items_after_change() is
  'I6.1 trigger wrapper that keeps final QC checklist header counts synchronized with item rows.';

create or replace function public.grapple_build_final_qc_guard_signed_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  v_entering_signed boolean := false;
begin
  select gb.id, gb.workspace_id, gb.assigned_lead_id
    into b
  from public.grapple_builds gb
  where gb.id = new.build_id
    and gb.deleted_at is null;

  if not found then
    raise exception 'grapple build % not found for final QC checklist', new.build_id using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'signed'
       and (select auth.role()) <> 'service_role'
       and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'Signed final QC checklists are release records and cannot be modified directly'
        using errcode = '23514',
              hint = 'Void or supersede the checklist through a controlled service-role workflow before changing release-critical QC data.';
    end if;

    v_entering_signed := new.status = 'signed' and old.status is distinct from new.status;
  else
    v_entering_signed := new.status = 'signed';
  end if;

  if v_entering_signed then
    if b.assigned_lead_id is null then
      raise exception 'A build Lead must be assigned before final QC sign-off' using errcode = '23514';
    end if;

    if (select auth.role()) <> 'service_role' and b.assigned_lead_id is distinct from (select auth.uid()) then
      raise exception 'Only the assigned build Lead can sign final QC' using errcode = '42501';
    end if;

    new.lead_signed_by := b.assigned_lead_id;
    new.lead_signed_at := coalesce(new.lead_signed_at, now());
    new.completed_by := coalesce(new.completed_by, (select auth.uid()), b.assigned_lead_id);
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  return new;
end;
$$;

comment on function public.grapple_build_final_qc_guard_signed_checklist() is
  'I6.1 DB guard for Lead sign-off integrity: direct signed-state writes must come from the assigned Lead or service_role, and signed QC records are immutable for normal users.';

create or replace function public.grapple_build_final_qc_guard_signed_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signed_parent boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select exists (
      select 1
      from public.grapple_build_final_qc_checklists c
      where c.id = old.checklist_id
        and c.deleted_at is null
        and c.status = 'signed'
    ) into v_signed_parent;
  end if;

  if v_signed_parent = false and tg_op in ('INSERT', 'UPDATE') then
    select exists (
      select 1
      from public.grapple_build_final_qc_checklists c
      where c.id = new.checklist_id
        and c.deleted_at is null
        and c.status = 'signed'
    ) into v_signed_parent;
  end if;

  if v_signed_parent and (select auth.role()) <> 'service_role' then
    raise exception 'Final QC items cannot be modified after Lead sign-off'
      using errcode = '23514',
            hint = 'Create a superseding checklist or use a controlled service-role correction workflow.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.grapple_build_final_qc_guard_signed_items() is
  'I6.1 DB guard that freezes final QC line items after the checklist becomes a signed release record.';

-- Header workspace follows the parent build. Reuses the child sync helper from migration 644.
drop trigger if exists trg_grapple_build_final_qc_checklists_sync_workspace on public.grapple_build_final_qc_checklists;
create trigger trg_grapple_build_final_qc_checklists_sync_workspace
  before insert or update of build_id, workspace_id
  on public.grapple_build_final_qc_checklists
  for each row execute function public.grapple_build_child_sync_build_workspace();

drop trigger if exists trg_grapple_build_final_qc_checklists_guard_signed on public.grapple_build_final_qc_checklists;
create trigger trg_grapple_build_final_qc_checklists_guard_signed
  before insert or update on public.grapple_build_final_qc_checklists
  for each row execute function public.grapple_build_final_qc_guard_signed_checklist();

drop trigger if exists set_grapple_build_final_qc_checklists_updated_at on public.grapple_build_final_qc_checklists;
create trigger set_grapple_build_final_qc_checklists_updated_at
  before update on public.grapple_build_final_qc_checklists
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_final_qc_items_guard_signed on public.grapple_build_final_qc_items;
create trigger trg_grapple_build_final_qc_items_guard_signed
  before insert or update or delete on public.grapple_build_final_qc_items
  for each row execute function public.grapple_build_final_qc_guard_signed_items();

drop trigger if exists trg_grapple_build_final_qc_items_sync_parent on public.grapple_build_final_qc_items;
create trigger trg_grapple_build_final_qc_items_sync_parent
  before insert or update of checklist_id, build_id, workspace_id, result, checked_at
  on public.grapple_build_final_qc_items
  for each row execute function public.grapple_build_final_qc_item_sync_parent();

drop trigger if exists set_grapple_build_final_qc_items_updated_at on public.grapple_build_final_qc_items;
create trigger set_grapple_build_final_qc_items_updated_at
  before update on public.grapple_build_final_qc_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_grapple_build_final_qc_items_after_change on public.grapple_build_final_qc_items;
create trigger trg_grapple_build_final_qc_items_after_change
  after insert or update or delete on public.grapple_build_final_qc_items
  for each row execute function public.grapple_build_final_qc_items_after_change();

-- ── Final QC RLS --------------------------------------------------------------

alter table public.grapple_build_final_qc_checklists enable row level security;
alter table public.grapple_build_final_qc_items enable row level security;

drop policy if exists "grapple_build_final_qc_checklists_service_all" on public.grapple_build_final_qc_checklists;
create policy "grapple_build_final_qc_checklists_service_all" on public.grapple_build_final_qc_checklists for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_final_qc_checklists_select_scoped" on public.grapple_build_final_qc_checklists;
create policy "grapple_build_final_qc_checklists_select_scoped" on public.grapple_build_final_qc_checklists for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_checklists_insert_assigned_or_manager" on public.grapple_build_final_qc_checklists;
create policy "grapple_build_final_qc_checklists_insert_assigned_or_manager" on public.grapple_build_final_qc_checklists for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_checklists_update_assigned_or_manager" on public.grapple_build_final_qc_checklists;
create policy "grapple_build_final_qc_checklists_update_assigned_or_manager" on public.grapple_build_final_qc_checklists for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_checklists_delete_assigned_or_manager" on public.grapple_build_final_qc_checklists;
create policy "grapple_build_final_qc_checklists_delete_assigned_or_manager" on public.grapple_build_final_qc_checklists for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_items_service_all" on public.grapple_build_final_qc_items;
create policy "grapple_build_final_qc_items_service_all" on public.grapple_build_final_qc_items for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_final_qc_items_select_scoped" on public.grapple_build_final_qc_items;
create policy "grapple_build_final_qc_items_select_scoped" on public.grapple_build_final_qc_items for select
  using (deleted_at is null and public.grapple_build_child_can_read(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_items_insert_assigned_or_manager" on public.grapple_build_final_qc_items;
create policy "grapple_build_final_qc_items_insert_assigned_or_manager" on public.grapple_build_final_qc_items for insert
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_items_update_assigned_or_manager" on public.grapple_build_final_qc_items;
create policy "grapple_build_final_qc_items_update_assigned_or_manager" on public.grapple_build_final_qc_items for update
  using (public.grapple_build_child_can_manage(workspace_id, build_id))
  with check (public.grapple_build_child_can_manage(workspace_id, build_id));

drop policy if exists "grapple_build_final_qc_items_delete_assigned_or_manager" on public.grapple_build_final_qc_items;
create policy "grapple_build_final_qc_items_delete_assigned_or_manager" on public.grapple_build_final_qc_items for delete
  using (public.grapple_build_child_can_manage(workspace_id, build_id));

-- ── Final QC release gate RPC + DB backstop ----------------------------------

create or replace function public.grapple_build_final_qc_release_gate(p_build_id uuid)
returns table (
  ok boolean,
  code text,
  reason text,
  missing jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
  qc record;
  v_missing jsonb := '[]'::jsonb;
begin
  select
    gb.id,
    gb.workspace_id,
    gb.build_number,
    gb.production_stage,
    gb.status,
    gb.assigned_lead_id,
    gb.assigned_builder_id,
    gb.deleted_at
  into b
  from public.grapple_builds gb
  where gb.id = p_build_id
    and gb.deleted_at is null;

  if not found then
    return query select
      false,
      'grapple_build_not_found'::text,
      'Grapple build not found for final QC release gate.'::text,
      jsonb_build_array(jsonb_build_object('scope', 'build', 'field', 'id'));
    return;
  end if;

  if (select auth.role()) <> 'service_role'
     and not (
       b.workspace_id = (select public.get_my_workspace())
       and (
         public.grapple_build_can_read(b.workspace_id, b.assigned_lead_id, b.assigned_builder_id)
         or public.grapple_build_can_read_progress(b.workspace_id)
       )
     ) then
    return query select
      false,
      'grapple_build_not_found'::text,
      'Grapple build not found for final QC release gate.'::text,
      jsonb_build_array(jsonb_build_object('scope', 'build', 'field', 'id'));
    return;
  end if;

  select c.*
    into qc
  from public.grapple_build_final_qc_checklists c
  where c.build_id = p_build_id
    and c.workspace_id = b.workspace_id
    and c.deleted_at is null
    and c.status = 'signed'
  order by c.lead_signed_at desc nulls last, c.completed_at desc nulls last, c.updated_at desc
  limit 1;

  if not found then
    return query select
      false,
      'final_qc_not_signed'::text,
      'Build cannot be released until a final QC checklist is completed and signed by the assigned Lead.'::text,
      jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'status', 'expected', 'signed'));
    return;
  end if;

  if b.assigned_lead_id is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'scope', 'build',
      'field', 'assigned_lead_id',
      'reason', 'A build Lead must be assigned before final release.'
    ));
  elsif qc.lead_signed_by is distinct from b.assigned_lead_id then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'scope', 'final_qc',
      'field', 'lead_signed_by',
      'expected', b.assigned_lead_id,
      'actual', qc.lead_signed_by
    ));
  end if;

  if qc.overall_result is distinct from 'pass' then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'scope', 'final_qc',
      'field', 'overall_result',
      'expected', 'pass',
      'actual', qc.overall_result
    ));
  end if;

  if qc.item_count <= 0 then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'item_count', 'reason', 'At least one final QC item is required.'));
  end if;

  if qc.failed_item_count > 0 then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'failed_item_count', 'actual', qc.failed_item_count));
  end if;

  if qc.rework_required_count > 0 then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'rework_required_count', 'actual', qc.rework_required_count));
  end if;

  if qc.unchecked_item_count > 0 then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'unchecked_item_count', 'actual', qc.unchecked_item_count));
  end if;

  if qc.completed_by is null or qc.completed_at is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'completed_by/completed_at'));
  end if;

  if qc.lead_signed_by is null or qc.lead_signed_at is null or nullif(trim(coalesce(qc.lead_signature_name, '')), '') is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'lead_signature'));
  end if;

  if jsonb_array_length(v_missing) > 0 then
    return query select
      false,
      'final_qc_incomplete'::text,
      'Build cannot be released until final QC has passed and the assigned Lead has signed off.'::text,
      v_missing;
    return;
  end if;

  return query select
    true,
    'final_qc_release_ready'::text,
    'Final QC checklist is complete and assigned Lead sign-off is present for release.'::text,
    '[]'::jsonb;
end;
$$;

comment on function public.grapple_build_final_qc_release_gate(uuid) is
  'I6.1 release gate: production_complete is blocked unless a signed/pass final QC checklist exists and the assigned build Lead has signed it.';

create or replace function public.sign_grapple_build_final_qc(
  p_checklist_id uuid,
  p_signature_name text,
  p_signature_statement text default null,
  p_notes text default null
)
returns public.grapple_build_final_qc_checklists
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.grapple_build_final_qc_checklists%rowtype;
  b public.grapple_builds%rowtype;
  updated public.grapple_build_final_qc_checklists%rowtype;
begin
  select * into c
  from public.grapple_build_final_qc_checklists
  where id = p_checklist_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'final QC checklist % not found', p_checklist_id using errcode = '23503';
  end if;

  select * into b
  from public.grapple_builds
  where id = c.build_id
    and workspace_id = c.workspace_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'grapple build % not found for final QC checklist', c.build_id using errcode = '23503';
  end if;

  if b.assigned_lead_id is null then
    raise exception 'A build Lead must be assigned before final QC sign-off' using errcode = '23514';
  end if;

  if (select auth.role()) <> 'service_role' and b.assigned_lead_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned build Lead can sign final QC' using errcode = '42501';
  end if;

  if c.item_count <= 0 or c.failed_item_count > 0 or c.rework_required_count > 0 or c.unchecked_item_count > 0 or c.overall_result is distinct from 'pass' then
    raise exception 'Final QC cannot be signed until every checklist item has passed or is not applicable' using errcode = '23514';
  end if;

  update public.grapple_build_final_qc_checklists
  set status = 'signed',
      completed_by = coalesce(completed_by, (select auth.uid())),
      completed_at = coalesce(completed_at, now()),
      lead_signed_by = b.assigned_lead_id,
      lead_signed_at = now(),
      lead_signature_name = nullif(trim(p_signature_name), ''),
      lead_signature_statement = coalesce(nullif(trim(p_signature_statement), ''), 'I certify that final QC passed and this grapple build is ready for release.'),
      notes = coalesce(nullif(trim(p_notes), ''), notes),
      updated_at = now()
  where id = p_checklist_id
  returning * into updated;

  insert into public.grapple_build_stage_events (
    workspace_id,
    build_id,
    from_stage,
    to_stage,
    from_status,
    to_status,
    event_type,
    note,
    metadata,
    actor_id
  ) values (
    b.workspace_id,
    b.id,
    b.production_stage,
    b.production_stage,
    b.status,
    b.status,
    'note',
    'Final QC checklist signed by assigned Lead.',
    jsonb_build_object('final_qc_checklist_id', updated.id, 'release_gate', 'final_qc_release_ready'),
    (select auth.uid())
  );

  return updated;
end;
$$;

comment on function public.sign_grapple_build_final_qc(uuid, text, text, text) is
  'I6.1 assigned Lead sign-off RPC for final QC. The release gate and DB trigger still backstop production_complete.';

create or replace function public.enforce_grapple_build_final_qc_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate record;
  v_requires_gate boolean := false;
begin
  if new.production_stage = 'production_complete' then
    if tg_op = 'INSERT' then
      v_requires_gate := true;
    elsif old.production_stage is distinct from new.production_stage or old.status is distinct from new.status then
      v_requires_gate := true;
    end if;
  end if;

  if v_requires_gate then
    select * into gate
    from public.grapple_build_final_qc_release_gate(new.id)
    limit 1;

    if gate.ok is not true then
      raise exception using
        errcode = 'P0001',
        message = gate.reason,
        detail = gate.code;
    end if;

    new.status := 'completed';
    new.actual_completed_at := coalesce(new.actual_completed_at, now());
  end if;

  return new;
end;
$$;

comment on function public.enforce_grapple_build_final_qc_release() is
  'I6.1 DB backstop: direct grapple_builds production_complete/release updates are blocked until final QC and assigned Lead sign-off pass.';

drop trigger if exists grapple_builds_final_qc_release_trg on public.grapple_builds;
create trigger grapple_builds_final_qc_release_trg
  before insert or update of production_stage, status
  on public.grapple_builds
  for each row execute function public.enforce_grapple_build_final_qc_release();

-- Replace the stage transition RPC so the normal backend path checks the same
-- release gate before the DB trigger backstop is reached.
create or replace function public.transition_grapple_build_stage(
  p_build_id uuid,
  p_next_stage text,
  p_next_status text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.grapple_builds
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.grapple_builds%rowtype;
  v_after public.grapple_builds%rowtype;
  v_status text;
  gate record;
begin
  select * into v_before
  from public.grapple_builds
  where id = p_build_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'grapple build % not found', p_build_id;
  end if;

  if p_next_stage = 'production_complete' then
    select * into gate
    from public.grapple_build_final_qc_release_gate(p_build_id)
    limit 1;

    if gate.ok is not true then
      raise exception using
        errcode = 'P0001',
        message = gate.reason,
        detail = gate.code;
    end if;
  end if;

  v_status := coalesce(
    p_next_status,
    case
      when p_next_stage = 'production_hold' then 'on_hold'
      when p_next_stage = 'production_complete' then 'completed'
      else 'active'
    end
  );

  update public.grapple_builds
  set production_stage = p_next_stage,
      status = v_status,
      current_stage_entered_at = now(),
      actual_started_at = case when actual_started_at is null and p_next_stage in ('in_production', 'production_hold', 'production_complete', 'ready_for_final_qc') then now() else actual_started_at end,
      actual_completed_at = case when p_next_stage = 'production_complete' and v_status = 'completed' and actual_completed_at is null then now() else actual_completed_at end,
      updated_at = now()
  where id = p_build_id
  returning * into v_after;

  insert into public.grapple_build_stage_events (
    workspace_id,
    build_id,
    from_stage,
    to_stage,
    from_status,
    to_status,
    event_type,
    note,
    metadata
  ) values (
    v_after.workspace_id,
    v_after.id,
    v_before.production_stage,
    v_after.production_stage,
    v_before.status,
    v_after.status,
    case when v_before.production_stage is distinct from v_after.production_stage then 'stage_transition' else 'status_update' end,
    p_note,
    case
      when p_next_stage = 'production_complete'
        then coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('release_gate', 'final_qc_release_ready')
      else coalesce(p_metadata, '{}'::jsonb)
    end
  );

  return v_after;
end;
$$;

comment on function public.transition_grapple_build_stage(uuid, text, text, text, jsonb) is
  'I1/I6 backend RPC for grapple-build stage/status transitions. production_complete is release-gated by final QC + assigned Lead sign-off.';

-- ── I7.1 timeline view computed from existing stage events -------------------

create or replace view public.v_grapple_build_timeline
  with (security_invoker = true) as
with ordered_events as (
  select
    ev.id,
    ev.workspace_id,
    ev.build_id,
    ev.to_stage as production_stage,
    ev.created_at as stage_started_at,
    lead(ev.created_at) over (partition by ev.build_id order by ev.created_at, ev.id) as next_event_at
  from public.grapple_build_stage_events ev
), stage_intervals as (
  select
    gb.id as build_id,
    gb.workspace_id,
    oe.production_stage,
    oe.stage_started_at,
    case
      when oe.next_event_at is not null then oe.next_event_at
      when gb.production_stage = 'production_complete' then coalesce(gb.actual_completed_at, oe.stage_started_at)
      else now()
    end as stage_ended_at
  from public.grapple_builds gb
  join ordered_events oe
    on oe.build_id = gb.id
   and oe.workspace_id = gb.workspace_id
  where gb.deleted_at is null
    and public.grapple_build_can_read_progress(gb.workspace_id)
    and ((select auth.role()) = 'service_role' or gb.workspace_id = (select public.get_my_workspace()))
), stage_rollup as (
  select
    build_id,
    workspace_id,
    production_stage,
    min(stage_started_at) as first_entered_at,
    max(stage_ended_at) as last_exited_at,
    count(*)::integer as entry_count,
    greatest(0, sum(extract(epoch from (stage_ended_at - stage_started_at))))::bigint as duration_seconds
  from stage_intervals
  group by build_id, workspace_id, production_stage
), build_rollup as (
  select
    build_id,
    workspace_id,
    min(first_entered_at) as timeline_started_at,
    max(last_exited_at) as latest_timeline_at,
    coalesce(sum(duration_seconds), 0)::bigint as total_duration_seconds,
    jsonb_agg(
      jsonb_build_object(
        'stage', production_stage,
        'entry_count', entry_count,
        'first_entered_at', first_entered_at,
        'last_exited_at', last_exited_at,
        'duration_seconds', duration_seconds,
        'duration_hours', round(duration_seconds::numeric / 3600.0, 2)
      )
      order by case production_stage
        when 'intake' then 10
        when 'chassis_arrival' then 20
        when 'pre_build_review' then 30
        when 'production_scheduled' then 40
        when 'in_production' then 50
        when 'production_hold' then 60
        when 'ready_for_final_qc' then 70
        when 'production_complete' then 80
        else 999
      end
    ) as stage_durations
  from stage_rollup
  group by build_id, workspace_id
)
select
  gb.id as build_id,
  gb.workspace_id,
  gb.build_number,
  gb.production_stage,
  gb.status,
  br.timeline_started_at,
  case when gb.production_stage = 'production_complete' then gb.actual_completed_at else null end as timeline_completed_at,
  br.latest_timeline_at,
  coalesce(br.total_duration_seconds, 0)::bigint as total_duration_seconds,
  round(coalesce(br.total_duration_seconds, 0)::numeric / 3600.0, 2) as total_duration_hours,
  coalesce(br.stage_durations, '[]'::jsonb) as stage_durations,
  gb.current_stage_entered_at,
  greatest(0, floor(extract(epoch from (now() - gb.current_stage_entered_at)) / 86400))::integer as days_in_current_stage,
  gb.created_at,
  gb.updated_at
from public.grapple_builds gb
left join build_rollup br
  on br.build_id = gb.id
 and br.workspace_id = gb.workspace_id
where gb.deleted_at is null
  and public.grapple_build_can_read_progress(gb.workspace_id)
  and ((select auth.role()) = 'service_role' or gb.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_timeline is
  'I7.1 reportable security_invoker timeline view. Durations are computed from grapple_build_stage_events; the event log is not duplicated.';

-- ── I5.1 progress-sheet view --------------------------------------------------

create or replace view public.v_grapple_build_progress_sheets
  with (security_invoker = true) as
select
  gb.id as build_id,
  gb.workspace_id,
  gb.build_number,
  gb.production_stage,
  gb.status,
  gb.priority,
  case gb.production_stage
    when 'intake' then 10
    when 'chassis_arrival' then 20
    when 'pre_build_review' then 35
    when 'production_scheduled' then 50
    when 'in_production' then 70
    when 'production_hold' then 70
    when 'ready_for_final_qc' then 90
    when 'production_complete' then 100
    else 0
  end as progress_percent,
  gb.customer_company_id,
  co.name as customer_company_name,
  gb.customer_contact_id,
  nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as customer_contact_name,
  gb.sales_deal_id,
  d.name as sales_deal_name,
  gb.chassis_equipment_id,
  chassis.name as chassis_equipment_name,
  chassis.asset_tag as chassis_asset_tag,
  chassis.serial_number as chassis_serial_number,
  gb.finished_equipment_id,
  finished.name as finished_equipment_name,
  finished.asset_tag as finished_asset_tag,
  gb.assigned_lead_id,
  coalesce(nullif(lead_profile.full_name, ''), lead_profile.email) as assigned_lead_name,
  gb.assigned_builder_id,
  coalesce(nullif(builder_profile.full_name, ''), builder_profile.email) as assigned_builder_name,
  gb.target_start_date,
  gb.target_completion_date,
  gb.actual_started_at,
  gb.actual_completed_at,
  gb.current_stage_entered_at,
  tl.days_in_current_stage,
  case
    when gb.status = 'completed' and gb.production_stage = 'production_complete' then 'complete'
    when gb.production_stage = 'ready_for_final_qc' and gate.ok then 'ready_for_release'
    when gb.production_stage = 'ready_for_final_qc' then 'awaiting_final_qc'
    when gb.target_completion_date is null then 'no_target'
    when gb.target_completion_date < current_date then 'overdue'
    when gb.target_completion_date <= current_date + 3 then 'due_soon'
    else 'on_track'
  end as timeline_health,
  tl.timeline_started_at,
  tl.timeline_completed_at,
  tl.total_duration_seconds,
  tl.total_duration_hours,
  tl.stage_durations,
  latest_event.event_type as latest_event_type,
  latest_event.from_stage as latest_event_from_stage,
  latest_event.to_stage as latest_event_to_stage,
  latest_event.note as latest_event_note,
  latest_event.created_at as latest_event_at,
  gate.ok as final_qc_release_ready,
  gate.code as final_qc_release_code,
  gate.reason as final_qc_release_reason,
  gate.missing as final_qc_release_missing,
  gb.hold_reason,
  gb.production_notes,
  gb.created_at,
  gb.updated_at
from public.grapple_builds gb
left join public.qrm_companies co on co.id = gb.customer_company_id
left join public.qrm_contacts ct on ct.id = gb.customer_contact_id
left join public.qrm_deals d on d.id = gb.sales_deal_id
left join public.qrm_equipment chassis on chassis.id = gb.chassis_equipment_id
left join public.qrm_equipment finished on finished.id = gb.finished_equipment_id
left join public.profiles lead_profile on lead_profile.id = gb.assigned_lead_id
left join public.profiles builder_profile on builder_profile.id = gb.assigned_builder_id
left join public.v_grapple_build_timeline tl on tl.build_id = gb.id
left join lateral (
  select ev.event_type, ev.from_stage, ev.to_stage, ev.note, ev.created_at
  from public.grapple_build_stage_events ev
  where ev.build_id = gb.id
    and ev.workspace_id = gb.workspace_id
  order by ev.created_at desc, ev.id desc
  limit 1
) latest_event on true
left join lateral public.grapple_build_final_qc_release_gate(gb.id) gate on true
where gb.deleted_at is null
  and public.grapple_build_can_read_progress(gb.workspace_id)
  and ((select auth.role()) = 'service_role' or gb.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_progress_sheets is
  'I5.1 read-only sales/service progress-sheet view: stage, status, progress percent, latest event, timeline durations, and final-QC release readiness. It does not grant build management.';

-- ── Production/QC read views --------------------------------------------------

create or replace view public.v_grapple_build_final_qc_checklists
  with (security_invoker = true) as
select
  c.id,
  c.workspace_id,
  c.build_id,
  gb.build_number,
  c.checklist_number,
  c.status,
  c.overall_result,
  c.qc_performed_by,
  coalesce(nullif(qc_profile.full_name, ''), qc_profile.email) as qc_performed_by_name,
  c.qc_performed_at,
  c.completed_by,
  coalesce(nullif(completer.full_name, ''), completer.email) as completed_by_name,
  c.completed_at,
  c.lead_signed_by,
  coalesce(nullif(lead_signer.full_name, ''), lead_signer.email) as lead_signed_by_name,
  c.lead_signed_at,
  c.lead_signature_name,
  c.lead_signature_statement,
  c.item_count,
  c.passed_item_count,
  c.failed_item_count,
  c.rework_required_count,
  c.unchecked_item_count,
  c.notes,
  c.metadata,
  c.created_at,
  c.updated_at
from public.grapple_build_final_qc_checklists c
join public.grapple_builds gb
  on gb.id = c.build_id
 and gb.workspace_id = c.workspace_id
left join public.profiles qc_profile on qc_profile.id = c.qc_performed_by
left join public.profiles completer on completer.id = c.completed_by
left join public.profiles lead_signer on lead_signer.id = c.lead_signed_by
where c.deleted_at is null
  and gb.deleted_at is null
  and public.grapple_build_child_can_read(c.workspace_id, c.build_id)
  and ((select auth.role()) = 'service_role' or c.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_final_qc_checklists is
  'I6.1 security_invoker view for final QC checklist headers attached to grapple builds.';

create or replace view public.v_grapple_build_final_qc_items
  with (security_invoker = true) as
select
  i.id,
  i.workspace_id,
  i.build_id,
  gb.build_number,
  i.checklist_id,
  c.checklist_number,
  i.section_key,
  i.item_key,
  i.display_order,
  i.prompt,
  i.result,
  i.measured_value,
  i.notes,
  i.defect_severity,
  i.rework_required,
  i.checked_by,
  coalesce(nullif(checker.full_name, ''), checker.email) as checked_by_name,
  i.checked_at,
  i.metadata,
  i.created_at,
  i.updated_at
from public.grapple_build_final_qc_items i
join public.grapple_build_final_qc_checklists c
  on c.id = i.checklist_id
 and c.workspace_id = i.workspace_id
join public.grapple_builds gb
  on gb.id = i.build_id
 and gb.workspace_id = i.workspace_id
left join public.profiles checker on checker.id = i.checked_by
where i.deleted_at is null
  and c.deleted_at is null
  and gb.deleted_at is null
  and public.grapple_build_child_can_read(i.workspace_id, i.build_id)
  and ((select auth.role()) = 'service_role' or i.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_final_qc_items is
  'I6.1 security_invoker view for final QC checklist line items.';

-- ── Grants -------------------------------------------------------------------

grant select, insert, update, delete on public.grapple_build_final_qc_checklists to authenticated, service_role;
grant select, insert, update, delete on public.grapple_build_final_qc_items to authenticated, service_role;
grant select on public.grapple_build_stage_events to authenticated, service_role;

grant select on public.v_grapple_build_timeline to authenticated, service_role;
grant select on public.v_grapple_build_progress_sheets to authenticated, service_role;
grant select on public.v_grapple_build_final_qc_checklists to authenticated, service_role;
grant select on public.v_grapple_build_final_qc_items to authenticated, service_role;

revoke execute on function public.grapple_build_final_qc_item_sync_parent() from public;
revoke execute on function public.grapple_build_final_qc_recalculate(uuid) from public;
revoke execute on function public.grapple_build_final_qc_items_after_change() from public;
revoke execute on function public.grapple_build_final_qc_guard_signed_checklist() from public;
revoke execute on function public.grapple_build_final_qc_guard_signed_items() from public;
revoke execute on function public.enforce_grapple_build_final_qc_release() from public;
revoke execute on function public.grapple_build_final_qc_release_gate(uuid) from public;
revoke execute on function public.sign_grapple_build_final_qc(uuid, text, text, text) from public;

grant execute on function public.grapple_build_final_qc_release_gate(uuid) to authenticated, service_role;
grant execute on function public.sign_grapple_build_final_qc(uuid, text, text, text) to authenticated, service_role;
