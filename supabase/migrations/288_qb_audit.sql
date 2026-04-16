-- ============================================================================
-- Migration 288: QB Audit Tables
--
-- One audit companion per mutable price-sensitive table.
-- All use record_id uuid (not a per-table named FK) so the generic trigger
-- stays simple. Writes happen only through the qb_log_audit() trigger.
--
-- Audited: qb_brands, qb_equipment_models, qb_attachments, qb_programs,
--          qb_price_sheets, qb_quotes, qb_deals
-- ============================================================================

-- ── Generic audit trigger function ───────────────────────────────────────────

create or replace function public.qb_log_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_table text := tg_table_name || '_audit';
  changed     jsonb := null;
  snap        jsonb;
  rec_id      uuid;
begin
  if tg_op = 'DELETE' then
    snap   := to_jsonb(old);
    rec_id := old.id;
  else
    snap   := to_jsonb(new);
    rec_id := new.id;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('old', old_val, 'new', new_val))
    into changed
    from (
      select key, old_row.value as old_val, new_row.value as new_val
      from jsonb_each(to_jsonb(old)) old_row
      join jsonb_each(to_jsonb(new)) new_row using (key)
      where old_row.value is distinct from new_row.value
        and key not in ('updated_at')
    ) diff;
  end if;

  execute format(
    'insert into public.%I (record_id, action, actor_id, changed_fields, snapshot, created_at)
     values ($1, $2, $3, $4, $5, now())',
    audit_table
  ) using rec_id, lower(tg_op), auth.uid(), changed, snap;

  return coalesce(new, old);
end;
$$;

-- ── Audit tables — identical shape per source table ──────────────────────────

create table public.qb_quotes_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_quotes_audit_record on public.qb_quotes_audit(record_id, created_at desc);

create table public.qb_deals_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_deals_audit_record on public.qb_deals_audit(record_id, created_at desc);

create table public.qb_brands_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_brands_audit_record on public.qb_brands_audit(record_id, created_at desc);

create table public.qb_equipment_models_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_equipment_models_audit_record on public.qb_equipment_models_audit(record_id, created_at desc);

create table public.qb_attachments_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_attachments_audit_record on public.qb_attachments_audit(record_id, created_at desc);

create table public.qb_programs_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_programs_audit_record on public.qb_programs_audit(record_id, created_at desc);

create table public.qb_price_sheets_audit (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  actor_id uuid,
  changed_fields jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index idx_qb_price_sheets_audit_record on public.qb_price_sheets_audit(record_id, created_at desc);

-- ── Attach triggers ──────────────────────────────────────────────────────────

create trigger qb_quotes_audit_trigger
  after insert or update or delete on public.qb_quotes
  for each row execute function public.qb_log_audit();

create trigger qb_deals_audit_trigger
  after insert or update or delete on public.qb_deals
  for each row execute function public.qb_log_audit();

create trigger qb_brands_audit_trigger
  after insert or update or delete on public.qb_brands
  for each row execute function public.qb_log_audit();

create trigger qb_equipment_models_audit_trigger
  after insert or update or delete on public.qb_equipment_models
  for each row execute function public.qb_log_audit();

create trigger qb_attachments_audit_trigger
  after insert or update or delete on public.qb_attachments
  for each row execute function public.qb_log_audit();

create trigger qb_programs_audit_trigger
  after insert or update or delete on public.qb_programs
  for each row execute function public.qb_log_audit();

create trigger qb_price_sheets_audit_trigger
  after insert or update or delete on public.qb_price_sheets
  for each row execute function public.qb_log_audit();
