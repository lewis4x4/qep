-- 663_finance_foundation_intellidealer_master_match_dry_run.sql
--
-- Finance foundation Part 9: IntelliDealer master-match dry-run harness.
--
-- Rollback notes:
--   drop function if exists public.run_intellidealer_master_match_dry_run(text, uuid);
--   drop table if exists public.intellidealer_master_match_candidates;
--   drop table if exists public.intellidealer_master_match_dry_runs;
--   drop function if exists public.qep_normalize_intellidealer_account_number(text);
--   alter table public.qrm_intellidealer_customer_master_stage drop column if exists match_key_intellidealer_account_number;
--   alter table public.vendor_profiles drop column if exists intellidealer_account_number;
--   alter table public.qrm_companies drop column if exists intellidealer_account_number;

create or replace function public.qep_normalize_intellidealer_account_number(
  p_value text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(upper(trim(coalesce(p_value, ''))), '[^A-Z0-9]+', '', 'g'), '');
$$;

comment on function public.qep_normalize_intellidealer_account_number(text) is
  'Normalizes IntelliDealer customer/vendor account numbers for dry-run matching. Preserves leading zeroes while removing punctuation and whitespace.';

revoke execute on function public.qep_normalize_intellidealer_account_number(text) from public;
grant execute on function public.qep_normalize_intellidealer_account_number(text) to authenticated;
grant execute on function public.qep_normalize_intellidealer_account_number(text) to service_role;

alter table public.qrm_companies
  add column if not exists intellidealer_account_number text;

update public.qrm_companies
set intellidealer_account_number = legacy_customer_number
where intellidealer_account_number is null
  and legacy_customer_number is not null;

comment on column public.qrm_companies.intellidealer_account_number is
  'Shared IntelliDealer customer master account number used by finance master-match dry runs. Backfilled from legacy_customer_number.';

create unique index if not exists idx_qrm_companies_intellidealer_account_number
  on public.qrm_companies (workspace_id, intellidealer_account_number)
  where intellidealer_account_number is not null;

alter table public.vendor_profiles
  add column if not exists intellidealer_account_number text;

update public.vendor_profiles
set intellidealer_account_number = vendor_number
where intellidealer_account_number is null
  and vendor_number is not null;

comment on column public.vendor_profiles.intellidealer_account_number is
  'Shared IntelliDealer vendor account number used by finance master-match dry runs. Backfilled from vendor_number.';

create unique index if not exists idx_vendor_profiles_intellidealer_account_number
  on public.vendor_profiles (workspace_id, intellidealer_account_number)
  where intellidealer_account_number is not null;

grant select (intellidealer_account_number) on table public.vendor_profiles to authenticated;
grant select (intellidealer_account_number) on table public.vendor_profiles to service_role;

alter table public.qrm_intellidealer_customer_master_stage
  add column if not exists match_key_intellidealer_account_number text;

update public.qrm_intellidealer_customer_master_stage
set match_key_intellidealer_account_number = public.qep_normalize_intellidealer_account_number(customer_number)
where match_key_intellidealer_account_number is null
  and customer_number is not null;

comment on column public.qrm_intellidealer_customer_master_stage.match_key_intellidealer_account_number is
  'Normalized dry-run match key derived from customer_number. No live canonical load is triggered by this column.';

create index if not exists idx_qrm_id_customer_master_stage_match_key
  on public.qrm_intellidealer_customer_master_stage (workspace_id, match_key_intellidealer_account_number)
  where match_key_intellidealer_account_number is not null;

create table if not exists public.intellidealer_master_match_dry_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source_run_id uuid references public.qrm_intellidealer_customer_import_runs(id) on delete set null,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  live_load_status text not null default 'PARKED' check (live_load_status = 'PARKED'),
  row_count integer not null default 0,
  matched_existing_uuid_count integer not null default 0,
  ambiguous_duplicate_count integer not null default 0,
  new_master_count integer not null default 0,
  cross_master_collision_count integer not null default 0,
  duplicate_account_number_count integer not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  initiated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.intellidealer_master_match_dry_runs is
  'Dry-run audit headers for IntelliDealer customer/vendor master matching. This table never performs canonical live load.';
comment on column public.intellidealer_master_match_dry_runs.live_load_status is
  '[PARKED] Live customer/vendor master load remains disabled until owner authorization.';

create table if not exists public.intellidealer_master_match_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  dry_run_id uuid not null references public.intellidealer_master_match_dry_runs(id) on delete cascade,
  source_stage_id uuid references public.qrm_intellidealer_customer_master_stage(id) on delete set null,
  source_row_number integer,
  source_customer_name text,
  source_account_number text,
  normalized_account_number text,
  candidate_status text not null check (candidate_status in ('matched_existing_uuid', 'ambiguous_duplicate', 'new_master')),
  matched_customer_company_id uuid references public.qrm_companies(id) on delete set null,
  matched_vendor_profile_id uuid references public.vendor_profiles(id) on delete set null,
  customer_match_count integer not null default 0,
  vendor_match_count integer not null default 0,
  cross_master_collision boolean not null default false,
  would_create_new_qep_uuid boolean not null default false,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.intellidealer_master_match_candidates is
  'Per-row dry-run candidate classification. New-master rows intentionally do not persist a generated UUID; they only flag that a fresh QEP UUID would be created in a future authorized live load.';

create index if not exists idx_intellidealer_master_match_candidates_run
  on public.intellidealer_master_match_candidates (dry_run_id, candidate_status, normalized_account_number);

alter table public.intellidealer_master_match_dry_runs enable row level security;
alter table public.intellidealer_master_match_candidates enable row level security;

create policy "intellidealer_master_match_dry_runs_service_all"
  on public.intellidealer_master_match_dry_runs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "intellidealer_master_match_dry_runs_elevated_all"
  on public.intellidealer_master_match_dry_runs for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create policy "intellidealer_master_match_candidates_service_all"
  on public.intellidealer_master_match_candidates for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "intellidealer_master_match_candidates_elevated_all"
  on public.intellidealer_master_match_candidates for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create or replace function public.run_intellidealer_master_match_dry_run(
  p_workspace_id text default public.get_my_workspace(),
  p_source_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := coalesce(p_workspace_id, public.get_my_workspace());
  v_source_run_id uuid := p_source_run_id;
  v_dry_run_id uuid;
  v_row_count integer := 0;
  v_matched_count integer := 0;
  v_ambiguous_count integer := 0;
  v_new_count integer := 0;
  v_cross_collision_count integer := 0;
  v_duplicate_count integer := 0;
begin
  if (select auth.role()) <> 'service_role'
     and coalesce((select public.get_my_role())::text, '') not in ('admin', 'manager', 'owner', 'finance_admin') then
    raise exception 'VALIDATION_INTELLIDEALER_MASTER_MATCH_ELEVATED_ROLE_REQUIRED';
  end if;

  if v_source_run_id is null then
    select r.id into v_source_run_id
    from public.qrm_intellidealer_customer_import_runs r
    where r.workspace_id = v_workspace_id
    order by r.created_at desc
    limit 1;
  end if;

  if v_source_run_id is null then
    raise exception 'VALIDATION_INTELLIDEALER_SOURCE_RUN_REQUIRED';
  end if;

  insert into public.intellidealer_master_match_dry_runs (
    workspace_id,
    source_run_id,
    notes,
    metadata
  ) values (
    v_workspace_id,
    v_source_run_id,
    '[PARKED] Dry run only. Live load remains disabled; do not run commit scripts or --commit flags from this function.',
    jsonb_build_object(
      'live_load_parked', true,
      'forbidden_commands', jsonb_build_array('--commit', '--commit-canonical', 'commit-intellidealer-customer-import.mjs'),
      'match_key', 'qep_normalize_intellidealer_account_number(customer_number/vendor_number)'
    )
  )
  returning id into v_dry_run_id;

  update public.qrm_intellidealer_customer_master_stage s
  set match_key_intellidealer_account_number = public.qep_normalize_intellidealer_account_number(s.customer_number)
  where s.workspace_id = v_workspace_id
    and s.run_id = v_source_run_id
    and s.match_key_intellidealer_account_number is null;

  insert into public.intellidealer_master_match_candidates (
    workspace_id,
    dry_run_id,
    source_stage_id,
    source_row_number,
    source_customer_name,
    source_account_number,
    normalized_account_number,
    candidate_status,
    matched_customer_company_id,
    matched_vendor_profile_id,
    customer_match_count,
    vendor_match_count,
    cross_master_collision,
    would_create_new_qep_uuid,
    reason,
    metadata
  )
  select
    s.workspace_id,
    v_dry_run_id,
    s.id,
    s.row_number,
    s.customer_name,
    s.customer_number,
    normalized.match_key,
    case
      when coalesce(cm.customer_match_count, 0) + coalesce(vm.vendor_match_count, 0) = 0 then 'new_master'
      when coalesce(cm.customer_match_count, 0) + coalesce(vm.vendor_match_count, 0) = 1 then 'matched_existing_uuid'
      else 'ambiguous_duplicate'
    end as candidate_status,
    case
      when coalesce(cm.customer_match_count, 0) = 1 and coalesce(vm.vendor_match_count, 0) = 0 then cm.customer_company_id
      else null::uuid
    end as matched_customer_company_id,
    case
      when coalesce(vm.vendor_match_count, 0) = 1 and coalesce(cm.customer_match_count, 0) = 0 then vm.vendor_profile_id
      else null::uuid
    end as matched_vendor_profile_id,
    coalesce(cm.customer_match_count, 0),
    coalesce(vm.vendor_match_count, 0),
    coalesce(cm.customer_match_count, 0) > 0 and coalesce(vm.vendor_match_count, 0) > 0,
    coalesce(cm.customer_match_count, 0) + coalesce(vm.vendor_match_count, 0) = 0,
    case
      when normalized.match_key is null then 'missing_account_number'
      when coalesce(cm.customer_match_count, 0) = 0 and coalesce(vm.vendor_match_count, 0) = 0 then 'new master; future live load would create a fresh QEP UUID'
      when coalesce(cm.customer_match_count, 0) > 0 and coalesce(vm.vendor_match_count, 0) > 0 then 'account number appears in both customer and vendor masters; manual cross-reference decision required'
      when coalesce(cm.customer_match_count, 0) + coalesce(vm.vendor_match_count, 0) > 1 then 'duplicate account number; manual dedup required'
      else 'exact normalized account-number match'
    end,
    jsonb_build_object(
      'company_code', s.company_code,
      'division_code', s.division_code,
      'source_sheet', s.source_sheet,
      'live_load_parked', true
    )
  from public.qrm_intellidealer_customer_master_stage s
  cross join lateral (
    select public.qep_normalize_intellidealer_account_number(coalesce(s.match_key_intellidealer_account_number, s.customer_number)) as match_key
  ) normalized
  left join lateral (
    select count(*)::integer as customer_match_count, min(c.id) as customer_company_id
    from public.qrm_companies c
    where c.workspace_id = s.workspace_id
      and public.qep_normalize_intellidealer_account_number(coalesce(c.intellidealer_account_number, c.legacy_customer_number)) = normalized.match_key
  ) cm on true
  left join lateral (
    select count(*)::integer as vendor_match_count, min(v.id) as vendor_profile_id
    from public.vendor_profiles v
    where v.workspace_id = s.workspace_id
      and public.qep_normalize_intellidealer_account_number(coalesce(v.intellidealer_account_number, v.vendor_number)) = normalized.match_key
  ) vm on true
  where s.workspace_id = v_workspace_id
    and s.run_id = v_source_run_id;

  get diagnostics v_row_count = row_count;

  select
    count(*) filter (where candidate_status = 'matched_existing_uuid')::integer,
    count(*) filter (where candidate_status = 'ambiguous_duplicate')::integer,
    count(*) filter (where candidate_status = 'new_master')::integer,
    count(*) filter (where cross_master_collision)::integer,
    count(*) filter (
      where normalized_account_number in (
        select normalized_account_number
        from public.intellidealer_master_match_candidates
        where dry_run_id = v_dry_run_id
          and normalized_account_number is not null
        group by normalized_account_number
        having count(*) > 1
      )
    )::integer
  into
    v_matched_count,
    v_ambiguous_count,
    v_new_count,
    v_cross_collision_count,
    v_duplicate_count
  from public.intellidealer_master_match_candidates c
  where c.dry_run_id = v_dry_run_id;

  update public.intellidealer_master_match_dry_runs r
  set
    row_count = v_row_count,
    matched_existing_uuid_count = coalesce(v_matched_count, 0),
    ambiguous_duplicate_count = coalesce(v_ambiguous_count, 0),
    new_master_count = coalesce(v_new_count, 0),
    cross_master_collision_count = coalesce(v_cross_collision_count, 0),
    duplicate_account_number_count = coalesce(v_duplicate_count, 0)
  where r.id = v_dry_run_id;

  return jsonb_build_object(
    'dry_run_id', v_dry_run_id,
    'source_run_id', v_source_run_id,
    'live_load_status', 'PARKED',
    'row_count', v_row_count,
    'matched_existing_uuid_count', coalesce(v_matched_count, 0),
    'ambiguous_duplicate_count', coalesce(v_ambiguous_count, 0),
    'new_master_count', coalesce(v_new_count, 0),
    'cross_master_collision_count', coalesce(v_cross_collision_count, 0),
    'duplicate_account_number_count', coalesce(v_duplicate_count, 0),
    'forbidden_live_load_actions', jsonb_build_array('--commit', '--commit-canonical', 'commit-intellidealer-customer-import.mjs')
  );
end;
$$;

revoke execute on function public.run_intellidealer_master_match_dry_run(text, uuid) from public;
grant execute on function public.run_intellidealer_master_match_dry_run(text, uuid) to authenticated;
grant execute on function public.run_intellidealer_master_match_dry_run(text, uuid) to service_role;

insert into public.finance_foundation_config (
  workspace_id,
  config_key,
  config_value,
  safe_default,
  authorizing_question,
  note
)
values (
  'default',
  'intellidealer_master_live_load_status',
  '{"status": "PARKED", "allowed": false}'::jsonb,
  '{"status": "PARKED", "allowed": false}'::jsonb,
  'Round 3 open item: live IntelliDealer customer/vendor master load authorization',
  '[PARKED] Dry-run harness is available, but live load remains disabled until explicit owner authorization.'
)
on conflict (workspace_id, (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)), config_key)
where deleted_at is null
do update set
  config_value = excluded.config_value,
  safe_default = excluded.safe_default,
  authorizing_question = excluded.authorizing_question,
  note = excluded.note,
  updated_at = now();
