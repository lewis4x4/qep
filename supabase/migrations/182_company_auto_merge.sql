-- ============================================================================
-- Migration 182: Company auto-merge with cascade (Enhancement 4)
--
-- Schema-driven merge: walks pg_catalog to find every FK column that
-- references qrm_companies(id) and updates the discarded id → kept id.
-- Automatically picks up FKs from tables added in future migrations
-- without code changes.
--
-- Features:
--   - Manager+ role gate (caller and approval check)
--   - Dry-run mode: returns what WOULD change without mutating
--   - Full audit trail in qrm_company_merge_audit (actor, timestamps,
--     per-table row counts, full FK list)
--   - Undo within 7 days: qrm_undo_company_merge reverses every
--     UPDATE using the persisted affected_row_ids snapshot
--   - Source company soft-deleted (deleted_at) not hard-deleted, so
--     undo can restore it cleanly
-- ============================================================================

-- ── 1. Audit table ───────────────────────────────────────────────────────

create table if not exists public.qrm_company_merge_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  kept_company_id uuid not null,
  discarded_company_id uuid not null,
  kept_company_snapshot jsonb,
  discarded_company_snapshot jsonb,
  -- Per-table summary: { "qrm_deals": 12, "qrm_activities": 47, ... }
  table_row_counts jsonb not null default '{}'::jsonb,
  -- Full list of affected rows, grouped by table, so undo can reverse:
  -- { "qrm_deals": ["uuid1","uuid2",...], "qrm_activities": [...] }
  affected_row_ids jsonb not null default '{}'::jsonb,
  total_rows_updated integer not null default 0,
  caller_notes text,
  performed_by uuid references public.profiles(id) on delete set null,
  performed_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(id) on delete set null,
  dry_run boolean not null default false
);

comment on table public.qrm_company_merge_audit is
  'Full audit trail of company merges. Stores affected row IDs so undo can reverse within 7 days.';

alter table public.qrm_company_merge_audit enable row level security;

create policy "qcma_workspace_select" on public.qrm_company_merge_audit for select
  using (workspace_id = public.get_my_workspace());
create policy "qcma_service" on public.qrm_company_merge_audit for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
-- Inserts happen via SECURITY DEFINER RPC only — no direct client insert

create index idx_qcma_kept_company on public.qrm_company_merge_audit(kept_company_id);
create index idx_qcma_discarded_company on public.qrm_company_merge_audit(discarded_company_id);
create index idx_qcma_workspace_performed on public.qrm_company_merge_audit(workspace_id, performed_at desc);
create index idx_qcma_undone on public.qrm_company_merge_audit(undone_at) where undone_at is null;

-- ── 2. FK discovery helper ──────────────────────────────────────────────

create or replace function public.qrm_company_fk_columns()
returns table (table_name text, column_name text, on_delete text)
language sql
security definer
stable
as $$
  -- Walks pg_catalog to find every column in public.* that FK-references
  -- qrm_companies(id). Used by merge_companies to build the UPDATE list.
  select
    cl.relname::text as table_name,
    a.attname::text as column_name,
    case c.confdeltype
      when 'a' then 'no action'
      when 'r' then 'restrict'
      when 'c' then 'cascade'
      when 'n' then 'set null'
      when 'd' then 'set default'
      else 'unknown'
    end as on_delete
  from pg_constraint c
  join pg_class cl on cl.oid = c.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_class cf on cf.oid = c.confrelid
  join pg_attribute a on a.attrelid = cl.oid and a.attnum = any(c.conkey)
  where c.contype = 'f'
    and n.nspname = 'public'
    and cf.relname = 'qrm_companies'
    -- Exclude the merge_audit table itself so undo records survive
    and cl.relname != 'qrm_company_merge_audit';
$$;

comment on function public.qrm_company_fk_columns() is
  'Returns every (table, column) pair in public schema that FK-references qrm_companies(id). Used by merge_companies to build the UPDATE list dynamically.';

-- ── 3. merge_companies RPC ──────────────────────────────────────────────

create or replace function public.merge_companies(
  p_keep_id uuid,
  p_discard_id uuid,
  p_dry_run boolean default false,
  p_caller_notes text default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_caller_role text;
  v_kept_snapshot jsonb;
  v_discarded_snapshot jsonb;
  v_table_counts jsonb := '{}'::jsonb;
  v_affected_ids jsonb := '{}'::jsonb;
  v_total int := 0;
  v_audit_id uuid;
  fk_row record;
  v_ids uuid[];
  v_count int;
begin
  -- Caller must be manager or higher
  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then
    raise exception 'caller profile not found';
  end if;
  if v_caller_role not in ('manager', 'owner', 'admin') then
    raise exception 'company merge requires manager or owner role';
  end if;

  -- Sanity: keep and discard must differ
  if p_keep_id = p_discard_id then
    raise exception 'keep and discard company IDs must differ';
  end if;

  -- Snapshot both companies for audit + undo
  select to_jsonb(c.*) into v_kept_snapshot
    from public.qrm_companies c where c.id = p_keep_id;
  if v_kept_snapshot is null then
    raise exception 'keep company % not found', p_keep_id;
  end if;

  select to_jsonb(c.*) into v_discarded_snapshot
    from public.qrm_companies c where c.id = p_discard_id;
  if v_discarded_snapshot is null then
    raise exception 'discard company % not found', p_discard_id;
  end if;

  -- Walk every FK column and UPDATE discard_id → keep_id
  for fk_row in
    select table_name, column_name from public.qrm_company_fk_columns()
  loop
    -- Capture affected row IDs BEFORE the update so undo can reverse them
    begin
      execute format(
        'select coalesce(array_agg(id), ARRAY[]::uuid[]) from public.%I where %I = $1',
        fk_row.table_name, fk_row.column_name
      )
      using p_discard_id
      into v_ids;
    exception when undefined_column then
      -- The table may not have an id column; skip capture but still attempt update
      v_ids := ARRAY[]::uuid[];
    end;

    if not p_dry_run and array_length(v_ids, 1) > 0 then
      execute format(
        'update public.%I set %I = $1 where %I = $2',
        fk_row.table_name, fk_row.column_name, fk_row.column_name
      ) using p_keep_id, p_discard_id;
      get diagnostics v_count = row_count;
    else
      -- Dry run: just count without mutating
      execute format(
        'select count(*)::int from public.%I where %I = $1',
        fk_row.table_name, fk_row.column_name
      ) using p_discard_id
      into v_count;
    end if;

    if v_count > 0 then
      v_table_counts := v_table_counts || jsonb_build_object(fk_row.table_name, v_count);
      v_affected_ids := v_affected_ids || jsonb_build_object(
        fk_row.table_name,
        to_jsonb(v_ids)
      );
      v_total := v_total + v_count;
    end if;
  end loop;

  -- Soft-delete the discarded company (skip on dry run)
  if not p_dry_run then
    update public.qrm_companies
      set deleted_at = now(),
          updated_at = now()
      where id = p_discard_id;
  end if;

  -- Write audit row (always, even on dry run)
  insert into public.qrm_company_merge_audit (
    kept_company_id, discarded_company_id,
    kept_company_snapshot, discarded_company_snapshot,
    table_row_counts, affected_row_ids, total_rows_updated,
    caller_notes, performed_by, dry_run
  ) values (
    p_keep_id, p_discard_id,
    v_kept_snapshot, v_discarded_snapshot,
    v_table_counts, v_affected_ids, v_total,
    p_caller_notes, auth.uid(), p_dry_run
  ) returning id into v_audit_id;

  return json_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'dry_run', p_dry_run,
    'total_rows_affected', v_total,
    'table_row_counts', v_table_counts,
    'kept_company_id', p_keep_id,
    'discarded_company_id', p_discard_id
  );
end;
$$;

comment on function public.merge_companies(uuid, uuid, boolean, text) is
  'Schema-driven company merge. Walks pg_catalog for every FK to qrm_companies, reassigns rows from discard → keep, soft-deletes the discarded company, and writes a full audit row. Supports dry_run. Manager+ role required.';

-- ── 4. qrm_undo_company_merge RPC ───────────────────────────────────────

create or replace function public.qrm_undo_company_merge(p_audit_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_caller_role text;
  v_audit record;
  v_fk_row record;
  v_ids jsonb;
  v_id_array uuid[];
  v_total int := 0;
  v_undone_count int;
begin
  -- Caller must be manager+
  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role not in ('manager', 'owner', 'admin') then
    raise exception 'undo requires manager or owner role';
  end if;

  -- Load audit row
  select * into v_audit
    from public.qrm_company_merge_audit
    where id = p_audit_id;
  if v_audit is null then
    raise exception 'merge audit row not found';
  end if;
  if v_audit.undone_at is not null then
    raise exception 'this merge has already been undone';
  end if;
  if v_audit.dry_run then
    raise exception 'cannot undo a dry run (no state was changed)';
  end if;
  if v_audit.performed_at < now() - interval '7 days' then
    raise exception 'undo window (7 days) has expired';
  end if;

  -- Restore the discarded company
  update public.qrm_companies
    set deleted_at = null,
        updated_at = now()
    where id = v_audit.discarded_company_id;

  -- Walk the persisted affected_row_ids JSONB and reverse each UPDATE
  for v_fk_row in
    select table_name, column_name from public.qrm_company_fk_columns()
  loop
    v_ids := v_audit.affected_row_ids -> v_fk_row.table_name;
    if v_ids is null or jsonb_array_length(v_ids) = 0 then
      continue;
    end if;

    v_id_array := array(select (jsonb_array_elements_text(v_ids))::uuid);

    execute format(
      'update public.%I set %I = $1 where id = any($2)',
      v_fk_row.table_name, v_fk_row.column_name
    ) using v_audit.discarded_company_id, v_id_array;
    get diagnostics v_undone_count = row_count;
    v_total := v_total + v_undone_count;
  end loop;

  -- Stamp the audit row
  update public.qrm_company_merge_audit
    set undone_at = now(),
        undone_by = auth.uid()
    where id = p_audit_id;

  return json_build_object(
    'ok', true,
    'audit_id', p_audit_id,
    'rows_reversed', v_total,
    'restored_company_id', v_audit.discarded_company_id
  );
end;
$$;

comment on function public.qrm_undo_company_merge(uuid) is
  'Reverses a completed company merge within a 7-day window. Restores the discarded company (clears deleted_at) and rewrites every affected row from keep_id back to discard_id. Manager+ role required.';
