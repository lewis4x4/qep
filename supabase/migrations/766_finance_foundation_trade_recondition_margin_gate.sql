-- 766_finance_foundation_trade_recondition_margin_gate.sql
--
-- Finance foundation Part 10: trade-in over-allowance and
-- reconditioning margin gate.
--
-- Rollback notes:
--   drop trigger if exists trg_trade_recondition_sync_from_valuation on public.trade_valuations;
--   drop trigger if exists trg_trade_recondition_sync_from_trade_in on public.qb_trade_ins;
--   drop trigger if exists trg_qb_trade_ins_guard_recondition_approval_state on public.qb_trade_ins;
--   drop trigger if exists trg_trade_valuations_guard_expected_margin on public.trade_valuations;
--   drop function if exists public.qep_trade_recondition_sync_from_valuation();
--   drop function if exists public.qep_trade_recondition_sync_from_trade_in();
--   drop function if exists public.record_trade_recondition_manager_approval(uuid, uuid, text, jsonb);
--   drop function if exists public.qep_trade_sync_recondition_state(uuid);
--   drop function if exists public.qep_is_trade_recondition_manager_approver(uuid);
--   drop trigger if exists trade_recondition_approval_audit_append_only on public.trade_recondition_approval_audit;
--   drop function if exists public.prevent_trade_recondition_approval_audit_mutation();
--   drop function if exists public.qb_trade_ins_guard_recondition_approval_state_write();
--   drop function if exists public.trade_valuations_guard_expected_margin_write();
--   drop function if exists public.qep_trade_recondition_material_change(text, numeric, numeric);
--   drop function if exists public.qep_trade_recondition_margin_floor_pct(text, text);
--   drop function if exists public.qep_trade_recondition_approval_state(uuid);
--   drop function if exists public.qep_trade_expected_gross_margin_visible(uuid);
--   drop function if exists public.qep_find_trade_brand(text, text);
--   drop function if exists public.qep_trade_expected_margin_pct(numeric, numeric, numeric);
--   drop function if exists public.qep_normalize_trade_brand_token(text);
--   drop table if exists public.trade_recondition_approval_audit;
--   alter table public.qb_trade_ins drop constraint if exists qb_trade_ins_reconditioning_approval_status_chk;
--   alter table public.qb_trade_ins drop constraint if exists qb_trade_ins_trade_valuation_id_fkey;
--   alter table public.qb_trade_ins drop column if exists reconditioning_approval_reason;
--   alter table public.qb_trade_ins drop column if exists reconditioning_approved_at;
--   alter table public.qb_trade_ins drop column if exists reconditioning_approved_by;
--   alter table public.qb_trade_ins drop column if exists reconditioning_approval_status;
--   alter table public.qb_trade_ins drop column if exists reconditioning_requires_manager_approval;
--   alter table public.qb_trade_ins drop column if exists trade_valuation_id;
--   alter table public.trade_valuations drop column if exists expected_gross_margin_pct;
--   alter table public.qb_brands drop column if exists represented_for_retail_trade;

alter table public.qb_brands
  add column if not exists represented_for_retail_trade boolean not null default false;

comment on column public.qb_brands.represented_for_retail_trade is
  'Config flag for Part 10 trade gates. True means the brand is eligible for keep-and-recondition retail trade handling without hard-coding brand names in gate logic.';

update public.qb_brands
set represented_for_retail_trade = true
where workspace_id = 'default'
  and code in ('ASV', 'YANMAR', 'DEVELON', 'BANDIT')
  and represented_for_retail_trade = false;

insert into public.finance_foundation_config (
  workspace_id,
  config_key,
  config_value,
  safe_default,
  authorizing_question,
  note
)
values
  (
    'default',
    'trade_recondition_material_change_threshold',
    '{"percent_delta": 0.10, "amount_delta": 2500, "basis": "either"}'::jsonb,
    '{"percent_delta": 0.10, "amount_delta": 2500, "basis": "either"}'::jsonb,
    'Round 3 open item: material recon change threshold',
    'Safe default forces re-approval when recon estimate moves by 10% or $2,500, whichever hits first.'
  ),
  (
    'default',
    'trade_nonrepresented_discount_band',
    '{"min_discount_pct": 8, "max_discount_pct": 10, "default_discount_pct": 8}'::jsonb,
    '{"min_discount_pct": 8, "max_discount_pct": 10, "default_discount_pct": 8}'::jsonb,
    'Ryan 2026-07-03: non-represented trade valuation band',
    'Non-represented brands should be valued around auction less 8-10%; logic reads this config instead of hard-coded brand names.'
  ),
  (
    'default',
    'trade_valuation_guardrail',
    '{"max_trade_cost_pct_of_auction_value": 1.0, "approval_required_above_guardrail": true}'::jsonb,
    '{"max_trade_cost_pct_of_auction_value": 1.0, "approval_required_above_guardrail": true}'::jsonb,
    'Ryan 2026-07-03: trade valuation guardrail',
    'Safe default holds keep-and-recondition true trade cost at auction value or less.'
  )
on conflict do nothing;

create or replace function public.qep_normalize_trade_brand_token(
  p_value text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(upper(trim(coalesce(p_value, ''))), '[^A-Z0-9]+', '', 'g'), '');
$$;

comment on function public.qep_normalize_trade_brand_token(text) is
  'Normalizes free-text trade make strings and qb_brand labels to a compact uppercase token for Part 10 represented-brand matching.';

revoke execute on function public.qep_normalize_trade_brand_token(text) from public;
grant execute on function public.qep_normalize_trade_brand_token(text) to authenticated;
grant execute on function public.qep_normalize_trade_brand_token(text) to service_role;

create or replace function public.qep_trade_expected_margin_pct(
  p_trade_cost numeric,
  p_reconditioning_estimate numeric,
  p_expected_sale_price numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_expected_sale_price is null or p_expected_sale_price <= 0 then null::numeric
    else round(
      (
        (
          p_expected_sale_price
          - coalesce(p_trade_cost, 0)
          - coalesce(p_reconditioning_estimate, 0)
        ) / p_expected_sale_price
      ) * 100.0,
      2
    )
  end;
$$;

comment on function public.qep_trade_expected_margin_pct(numeric, numeric, numeric) is
  'Expected gross margin percent for keep-and-recondition trades: expected sale price minus true trade cost and recon, divided by expected sale price.';

revoke execute on function public.qep_trade_expected_margin_pct(numeric, numeric, numeric) from public;
grant execute on function public.qep_trade_expected_margin_pct(numeric, numeric, numeric) to authenticated;
grant execute on function public.qep_trade_expected_margin_pct(numeric, numeric, numeric) to service_role;

create or replace function public.qep_find_trade_brand(
  p_workspace_id text,
  p_make text
)
returns table (
  brand_id uuid,
  code text,
  name text,
  represented_for_retail_trade boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with normalized_input as (
    select public.qep_normalize_trade_brand_token(p_make) as make_token
  ),
  ranked_brand as (
    select
      b.id as brand_id,
      b.code,
      b.name,
      b.represented_for_retail_trade,
      case
        when public.qep_normalize_trade_brand_token(b.code) = ni.make_token then 1
        when public.qep_normalize_trade_brand_token(b.name) = ni.make_token then 2
        when ni.make_token like public.qep_normalize_trade_brand_token(b.code) || '%' then 3
        when ni.make_token like public.qep_normalize_trade_brand_token(b.name) || '%' then 4
        else 9
      end as match_rank
    from public.qb_brands b
    cross join normalized_input ni
    where b.workspace_id = p_workspace_id
      and ni.make_token is not null
      and (
        public.qep_normalize_trade_brand_token(b.code) = ni.make_token
        or public.qep_normalize_trade_brand_token(b.name) = ni.make_token
        or ni.make_token like public.qep_normalize_trade_brand_token(b.code) || '%'
        or ni.make_token like public.qep_normalize_trade_brand_token(b.name) || '%'
      )
  )
  select
    rb.brand_id,
    rb.code,
    rb.name,
    rb.represented_for_retail_trade
  from ranked_brand rb
  order by rb.match_rank, rb.represented_for_retail_trade desc, rb.name asc
  limit 1;
$$;

comment on function public.qep_find_trade_brand(text, text) is
  'Best-effort brand resolver for Part 10 trade gates. Uses qb_brands rows and represented_for_retail_trade instead of hard-coded brand literals.';

revoke execute on function public.qep_find_trade_brand(text, text) from public;
grant execute on function public.qep_find_trade_brand(text, text) to authenticated;
grant execute on function public.qep_find_trade_brand(text, text) to service_role;

create or replace function public.qep_trade_recondition_margin_floor_pct(
  p_workspace_id text,
  p_make text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with matched_brand as (
    select fb.brand_id
    from public.qep_find_trade_brand(p_workspace_id, p_make) fb
    limit 1
  ),
  threshold_row as (
    select t.min_margin_pct
    from public.qb_margin_thresholds t
    left join matched_brand mb on true
    where t.workspace_id = p_workspace_id
      and (
        (mb.brand_id is not null and t.brand_id = mb.brand_id)
        or t.brand_id is null
      )
    order by
      case when t.brand_id is not null then 0 else 1 end,
      t.updated_at desc
    limit 1
  )
  select coalesce((select min_margin_pct from threshold_row), 15::numeric);
$$;

comment on function public.qep_trade_recondition_margin_floor_pct(text, text) is
  'Returns the Part 10 trade reconditioning margin floor. Reads qb_margin_thresholds when present and falls back to the seeded 15% floor.';

revoke execute on function public.qep_trade_recondition_margin_floor_pct(text, text) from public;
grant execute on function public.qep_trade_recondition_margin_floor_pct(text, text) to authenticated;
grant execute on function public.qep_trade_recondition_margin_floor_pct(text, text) to service_role;

create or replace function public.qep_trade_recondition_material_change(
  p_workspace_id text,
  p_previous_reconditioning_estimate numeric,
  p_current_reconditioning_estimate numeric
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold jsonb := coalesce(
    public.qep_finance_config_value('trade_recondition_material_change_threshold', p_workspace_id),
    '{"percent_delta": 0.10, "amount_delta": 2500, "basis": "either"}'::jsonb
  );
  v_previous numeric := coalesce(p_previous_reconditioning_estimate, 0);
  v_current numeric := coalesce(p_current_reconditioning_estimate, 0);
  v_delta numeric := abs(v_current - v_previous);
  v_amount_threshold numeric := coalesce((v_threshold->>'amount_delta')::numeric, 2500);
  v_percent_threshold numeric := coalesce((v_threshold->>'percent_delta')::numeric, 0.10);
begin
  if p_previous_reconditioning_estimate is null and p_current_reconditioning_estimate is null then
    return false;
  end if;

  if p_previous_reconditioning_estimate is null or p_current_reconditioning_estimate is null then
    return true;
  end if;

  if v_delta >= v_amount_threshold then
    return true;
  end if;

  if v_previous > 0 and (v_delta / v_previous) >= v_percent_threshold then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.qep_trade_recondition_material_change(text, numeric, numeric) is
  'Returns true when a recon estimate moved enough to invalidate a prior manager approval, using the workspace config threshold from finance_foundation_config.';

revoke execute on function public.qep_trade_recondition_material_change(text, numeric, numeric) from public;
grant execute on function public.qep_trade_recondition_material_change(text, numeric, numeric) to authenticated;
grant execute on function public.qep_trade_recondition_material_change(text, numeric, numeric) to service_role;

alter table public.trade_valuations
  add column if not exists expected_gross_margin_pct numeric;

comment on column public.trade_valuations.expected_gross_margin_pct is
  'Expected gross margin percent for trade reconditioning: expected sale price minus true trade cost and recon, divided by expected sale price. Finance-sensitive.';

alter table public.qb_trade_ins
  add column if not exists trade_valuation_id uuid,
  add column if not exists reconditioning_requires_manager_approval boolean not null default false,
  add column if not exists reconditioning_approval_status text not null default 'not_required',
  add column if not exists reconditioning_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists reconditioning_approved_at timestamptz,
  add column if not exists reconditioning_approval_reason text;

comment on column public.qb_trade_ins.trade_valuation_id is
  'Optional Part 10 link to the canonical trade_valuations row used for keep-and-recondition margin gating.';
comment on column public.qb_trade_ins.reconditioning_requires_manager_approval is
  'True when keep-and-recondition trade economics require manager approval because the margin floor, valuation guardrail, or material recon-change gate fired.';
comment on column public.qb_trade_ins.reconditioning_approval_status is
  'Part 10 approval lifecycle for keep-and-recondition trades: not_required, pending, approved, stale, or rejected.';

do $$
declare
  v_has_trade_valuation_fk boolean;
begin
  -- Migration 497 intentionally drops the temporary qep_column_has_fk helper
  -- after use, so keep this guard self-contained for production replays.
  select exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.qb_trade_ins'::regclass
      and c.contype = 'f'
      and a.attname = 'trade_valuation_id'
  )
    into v_has_trade_valuation_fk;

  if not v_has_trade_valuation_fk then
    alter table public.qb_trade_ins
      add constraint qb_trade_ins_trade_valuation_id_fkey
      foreign key (trade_valuation_id) references public.trade_valuations(id) on delete set null not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qb_trade_ins_reconditioning_approval_status_chk'
  ) then
    alter table public.qb_trade_ins
      add constraint qb_trade_ins_reconditioning_approval_status_chk
      check (
        reconditioning_approval_status in (
          'not_required',
          'pending',
          'approved',
          'stale',
          'rejected'
        )
      );
  end if;
end $$;

alter table public.qb_trade_ins
  drop constraint if exists qb_trade_ins_disposition_wave3_chk;

alter table public.qb_trade_ins
  add constraint qb_trade_ins_disposition_wave3_chk
  check (
    disposition is null or disposition in (
      'pending', 'inventory', 'retail', 'wholesale', 'auction',
      'rental_fleet', 'return_to_customer', 'scrap', 'keep_recondition'
    )
  ) not valid;

grant select (
  expected_gross_margin_pct
) on table public.trade_valuations to service_role;
grant select on table public.trade_valuations to service_role;

grant select (
  trade_valuation_id,
  reconditioning_requires_manager_approval,
  reconditioning_approval_status,
  reconditioning_approved_by,
  reconditioning_approved_at,
  reconditioning_approval_reason
) on table public.qb_trade_ins to service_role;
grant select on table public.qb_trade_ins to service_role;

do $$
declare
  v_safe_columns text;
begin
  revoke select on table public.trade_valuations from authenticated;
  revoke select (expected_gross_margin_pct) on table public.trade_valuations from authenticated;

  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_safe_columns
  from pg_attribute a
  where a.attrelid = 'public.trade_valuations'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'expected_gross_margin_pct';

  if v_safe_columns is not null then
    execute format('grant select (%s) on table public.trade_valuations to authenticated', v_safe_columns);
  end if;
end $$;

do $$
declare
  v_safe_columns text;
begin
  revoke select on table public.qb_trade_ins from authenticated;
  revoke select (
    trade_valuation_id,
    reconditioning_requires_manager_approval,
    reconditioning_approval_status,
    reconditioning_approved_by,
    reconditioning_approved_at,
    reconditioning_approval_reason,
    payoff_amount_cents,
    payoff_good_through_date,
    lien_holder_name,
    lien_holder_address,
    lien_holder_account_number,
    lien_release_received_at,
    title_received_at
  ) on table public.qb_trade_ins from authenticated;

  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_safe_columns
  from pg_attribute a
  where a.attrelid = 'public.qb_trade_ins'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname not in (
      'trade_valuation_id',
      'reconditioning_requires_manager_approval',
      'reconditioning_approval_status',
      'reconditioning_approved_by',
      'reconditioning_approved_at',
      'reconditioning_approval_reason',
      'payoff_amount_cents',
      'payoff_good_through_date',
      'lien_holder_name',
      'lien_holder_address',
      'lien_holder_account_number',
      'lien_release_received_at',
      'title_received_at'
    );

  if v_safe_columns is not null then
    execute format('grant select (%s) on table public.qb_trade_ins to authenticated', v_safe_columns);
  end if;
end $$;

create or replace function public.qep_trade_expected_gross_margin_visible(
  p_trade_valuation_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.role()) = 'service_role'
      or public.qep_finance_can_read()
      or coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
    then (
      select tv.expected_gross_margin_pct
      from public.trade_valuations tv
      where tv.id = p_trade_valuation_id
        and (
          (select auth.role()) = 'service_role'
          or tv.workspace_id = (select public.get_my_workspace())
        )
      limit 1
    )
    else null::numeric
  end;
$$;

comment on function public.qep_trade_expected_gross_margin_visible(uuid) is
  'Finance-gated accessor for trade_valuations.expected_gross_margin_pct. Raw column SELECT is revoked from authenticated to keep margin out of rep reads.';

revoke execute on function public.qep_trade_expected_gross_margin_visible(uuid) from public;
grant execute on function public.qep_trade_expected_gross_margin_visible(uuid) to authenticated;
grant execute on function public.qep_trade_expected_gross_margin_visible(uuid) to service_role;

create or replace function public.qep_trade_recondition_approval_state(
  p_qb_trade_in_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.role()) = 'service_role'
      or public.qep_finance_can_read()
      or coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
    then (
      select jsonb_build_object(
        'trade_valuation_id', t.trade_valuation_id,
        'requires_manager_approval', t.reconditioning_requires_manager_approval,
        'approval_status', t.reconditioning_approval_status,
        'approved_by', t.reconditioning_approved_by,
        'approved_at', t.reconditioning_approved_at,
        'approval_reason', t.reconditioning_approval_reason
      )
      from public.qb_trade_ins t
      where t.id = p_qb_trade_in_id
        and (
          (select auth.role()) = 'service_role'
          or t.workspace_id = (select public.get_my_workspace())
        )
      limit 1
    )
    else null::jsonb
  end;
$$;

comment on function public.qep_trade_recondition_approval_state(uuid) is
  'Finance-gated accessor for keep-and-recondition approval state on qb_trade_ins. Raw approval columns remain hidden from authenticated table reads.';

revoke execute on function public.qep_trade_recondition_approval_state(uuid) from public;
grant execute on function public.qep_trade_recondition_approval_state(uuid) to authenticated;
grant execute on function public.qep_trade_recondition_approval_state(uuid) to service_role;

create or replace function public.trade_valuations_guard_expected_margin_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'service_role'
     or current_setting('qep.trade_recondition_sync_active', true) = 'on' then
    return new;
  end if;

  if (tg_op = 'INSERT' and new.expected_gross_margin_pct is not null)
     or (tg_op = 'UPDATE' and new.expected_gross_margin_pct is distinct from old.expected_gross_margin_pct) then
    raise exception 'FORBIDDEN_TRADE_RECONDITION_EXPECTED_MARGIN_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.trade_valuations_guard_expected_margin_write() is
  'Blocks direct authenticated writes to trade_valuations.expected_gross_margin_pct. The value is recomputed only by the internal Part 10 sync path or service role.';

revoke execute on function public.trade_valuations_guard_expected_margin_write() from public;

create or replace function public.qb_trade_ins_guard_recondition_approval_state_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'service_role'
     or current_setting('qep.trade_recondition_sync_active', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.reconditioning_requires_manager_approval, false) is distinct from false
       or coalesce(new.reconditioning_approval_status, 'not_required') <> 'not_required'
       or new.reconditioning_approved_by is not null
       or new.reconditioning_approved_at is not null
       or new.reconditioning_approval_reason is not null then
      raise exception 'FORBIDDEN_TRADE_RECONDITION_APPROVAL_STATE_WRITE'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.reconditioning_requires_manager_approval is distinct from old.reconditioning_requires_manager_approval
     or new.reconditioning_approval_status is distinct from old.reconditioning_approval_status
     or new.reconditioning_approved_by is distinct from old.reconditioning_approved_by
     or new.reconditioning_approved_at is distinct from old.reconditioning_approved_at
     or new.reconditioning_approval_reason is distinct from old.reconditioning_approval_reason then
    raise exception 'FORBIDDEN_TRADE_RECONDITION_APPROVAL_STATE_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.qb_trade_ins_guard_recondition_approval_state_write() is
  'Blocks direct authenticated writes to Part 10 trade reconditioning approval state. Only service role and the internal qep_trade_sync_recondition_state path may mutate these audit-backed fields.';

revoke execute on function public.qb_trade_ins_guard_recondition_approval_state_write() from public;

create table if not exists public.trade_recondition_approval_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  qb_trade_in_id uuid references public.qb_trade_ins(id) on delete set null,
  trade_valuation_id uuid references public.trade_valuations(id) on delete set null,
  deal_id uuid references public.qb_deals(id) on delete set null,
  approval_type text not null default 'trade_recondition_margin_approval'
    check (approval_type in ('trade_recondition_margin_approval')),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_by_role text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_by_role text,
  reason text not null,
  source_function text not null default 'record_trade_recondition_manager_approval',
  approved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.trade_recondition_approval_audit is
  'Append-only who/why/when approval evidence for keep-and-recondition trade gates. Mirrors equipment_reversal_approval_audit while adding trade and valuation references.';
comment on column public.trade_recondition_approval_audit.reason is
  'Business reason supplied by the approving sales manager for a keep-and-recondition trade exception.';

create index if not exists idx_trade_recondition_approval_trade
  on public.trade_recondition_approval_audit (workspace_id, qb_trade_in_id, approved_at desc)
  where qb_trade_in_id is not null;

create index if not exists idx_trade_recondition_approval_valuation
  on public.trade_recondition_approval_audit (workspace_id, trade_valuation_id, approved_at desc)
  where trade_valuation_id is not null;

alter table public.trade_recondition_approval_audit enable row level security;

drop policy if exists "trade_recondition_approval_audit_service_all" on public.trade_recondition_approval_audit;
create policy "trade_recondition_approval_audit_service_all"
  on public.trade_recondition_approval_audit for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "trade_recondition_approval_audit_finance_read" on public.trade_recondition_approval_audit;
create policy "trade_recondition_approval_audit_finance_read"
  on public.trade_recondition_approval_audit for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      public.qep_finance_can_read()
      or coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
    )
  );

drop policy if exists "trade_recondition_approval_audit_elevated_insert" on public.trade_recondition_approval_audit;
create policy "trade_recondition_approval_audit_elevated_insert"
  on public.trade_recondition_approval_audit for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create or replace function public.prevent_trade_recondition_approval_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'VALIDATION_TRADE_RECONDITION_APPROVAL_AUDIT_APPEND_ONLY';
end;
$$;

drop trigger if exists trade_recondition_approval_audit_append_only on public.trade_recondition_approval_audit;
create trigger trade_recondition_approval_audit_append_only
  before update or delete on public.trade_recondition_approval_audit
  for each row execute function public.prevent_trade_recondition_approval_audit_mutation();

create or replace function public.qep_is_trade_recondition_manager_approver(
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
	    select 1
	    from public.profiles p
	    where p.id = p_profile_id
	      and (
	        (select auth.role()) = 'service_role'
	        or p.workspace_id = (select public.get_my_workspace())
	      )
	      and (
	        p.role::text = 'manager'
	        or p.iron_role = 'iron_manager'
	      )
	  );
$$;

comment on function public.qep_is_trade_recondition_manager_approver(uuid) is
  'Returns true for sales-manager approvers, including owner profiles mapped to iron_manager. Part 10 routes low-margin keep-and-recondition trades to this path.';

revoke execute on function public.qep_is_trade_recondition_manager_approver(uuid) from public;
grant execute on function public.qep_is_trade_recondition_manager_approver(uuid) to authenticated;
grant execute on function public.qep_is_trade_recondition_manager_approver(uuid) to service_role;

create or replace function public.trade_valuation_auto_calc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discount_band jsonb;
  v_brand_represented boolean := false;
  v_min_discount numeric;
  v_default_discount numeric;
  v_cost_basis numeric;
  v_expected_sale_price numeric;
begin
  select fb.represented_for_retail_trade
    into v_brand_represented
  from public.qep_find_trade_brand(coalesce(NEW.workspace_id, public.get_my_workspace()), NEW.make);

  if NEW.auction_value is not null then
    v_discount_band := coalesce(
      public.qep_finance_config_value(
        'trade_nonrepresented_discount_band',
        coalesce(NEW.workspace_id, public.get_my_workspace())
      ),
      '{"min_discount_pct": 8, "max_discount_pct": 10, "default_discount_pct": 8}'::jsonb
    );
    v_min_discount := coalesce((v_discount_band->>'min_discount_pct')::numeric, 8);
    v_default_discount := coalesce((v_discount_band->>'default_discount_pct')::numeric, v_min_discount);

    if coalesce(v_brand_represented, false) = false
       and (NEW.discount_percentage is null or NEW.discount_percentage < v_min_discount) then
      NEW.discount_percentage := v_default_discount;
    end if;

    NEW.discounted_value := NEW.auction_value * (1 - coalesce(NEW.discount_percentage, 8) / 100);
    NEW.preliminary_value := NEW.discounted_value - coalesce(NEW.reconditioning_estimate, 0);
    NEW.suggested_resale_price := NEW.preliminary_value / (1 - 0.225); -- midpoint of 20-25%

    v_cost_basis := coalesce(NEW.final_value, NEW.discounted_value, NEW.auction_value);
    v_expected_sale_price := coalesce(NEW.suggested_resale_price, NEW.auction_value);
    NEW.expected_gross_margin_pct := public.qep_trade_expected_margin_pct(
      v_cost_basis,
      NEW.reconditioning_estimate,
      v_expected_sale_price
    );

    if NEW.final_value is not null and NEW.preliminary_value > 0 then
      NEW.over_allowance := (NEW.final_value > NEW.preliminary_value * 1.10);
      if NEW.over_allowance and NEW.status = 'preliminary' then
        NEW.status := 'manager_review';
      end if;
    end if;
  else
    NEW.expected_gross_margin_pct := public.qep_trade_expected_margin_pct(
      coalesce(NEW.final_value, NEW.discounted_value, NEW.auction_value),
      NEW.reconditioning_estimate,
      coalesce(NEW.suggested_resale_price, NEW.auction_value)
    );
  end if;

  return NEW;
end;
$$;

create or replace function public.qep_trade_sync_recondition_state(
  p_qb_trade_in_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade public.qb_trade_ins%rowtype;
  v_valuation public.trade_valuations%rowtype;
  v_workspace_id text;
  v_discount_band jsonb;
  v_guardrail jsonb;
  v_brand_id uuid;
  v_brand_represented boolean := false;
  v_floor_pct numeric := 15;
  v_trade_cost numeric;
  v_expected_sale_price numeric;
  v_expected_margin_pct numeric;
  v_latest_approval_id uuid;
  v_latest_approved_by uuid;
  v_latest_approved_at timestamptz;
  v_latest_reason text;
  v_latest_approved_reconditioning_estimate numeric;
  v_material_change boolean := false;
  v_guardrail_breach boolean := false;
  v_discount_floor_breach boolean := false;
  v_requires_approval boolean := false;
  v_new_status text := 'not_required';
  v_new_approved_by uuid;
  v_new_approved_at timestamptz;
  v_new_reason text;
  v_target_trade_status text;
  v_guardrail_max numeric := 1.0;
  v_min_discount numeric := 8;
begin
  select t.workspace_id
    into v_workspace_id
  from public.qb_trade_ins t
  where t.id = p_qb_trade_in_id;

  if v_workspace_id is null then
    raise exception 'VALIDATION_QB_TRADE_IN_NOT_FOUND';
  end if;

  if coalesce((select auth.role()), '') = 'authenticated'
     and v_workspace_id is distinct from (select public.get_my_workspace()) then
    raise exception 'VALIDATION_TRADE_RECONDITION_WORKSPACE_SCOPE_REQUIRED'
      using errcode = '42501';
  end if;

  select *
    into v_trade
  from public.qb_trade_ins t
  where t.id = p_qb_trade_in_id
    and t.workspace_id = v_workspace_id
  for update;

  v_workspace_id := coalesce(v_trade.workspace_id, v_workspace_id, public.get_my_workspace());

  if v_trade.trade_valuation_id is not null then
    select *
      into v_valuation
    from public.trade_valuations tv
    where tv.id = v_trade.trade_valuation_id
      and tv.workspace_id = v_workspace_id
    for update;
  end if;

  if v_trade.disposition is distinct from 'keep_recondition' or v_valuation.id is null then
    perform set_config('qep.trade_recondition_sync_active', 'on', true);

    update public.qb_trade_ins t
    set
      reconditioning_requires_manager_approval = false,
      reconditioning_approval_status = 'not_required',
      reconditioning_approved_by = null,
      reconditioning_approved_at = null,
      reconditioning_approval_reason = null
    where t.id = v_trade.id
      and (
        t.reconditioning_requires_manager_approval is distinct from false
        or t.reconditioning_approval_status is distinct from 'not_required'
        or t.reconditioning_approved_by is not null
        or t.reconditioning_approved_at is not null
        or t.reconditioning_approval_reason is not null
      );

    perform set_config('qep.trade_recondition_sync_active', 'off', true);

    if v_valuation.id is not null then
      update public.trade_valuations tv
      set
        status = case when tv.status = 'manager_review' then 'preliminary' else tv.status end,
        approved_by = case when tv.status = 'manager_review' then null else tv.approved_by end,
        approval_notes = case when tv.status = 'manager_review' then null else tv.approval_notes end,
        updated_at = now()
      where tv.id = v_valuation.id
        and (
          tv.status = 'manager_review'
          or tv.approved_by is not null
          or tv.approval_notes is not null
        );
    end if;

    return jsonb_build_object(
      'trade_in_id', v_trade.id,
      'approval_required', false,
      'approval_status', 'not_required'
    );
  end if;

  select
    fb.brand_id,
    fb.represented_for_retail_trade
    into v_brand_id, v_brand_represented
  from public.qep_find_trade_brand(v_workspace_id, coalesce(v_valuation.make, v_trade.make)) as fb;

  v_discount_band := coalesce(
    public.qep_finance_config_value('trade_nonrepresented_discount_band', v_workspace_id),
    '{"min_discount_pct": 8, "max_discount_pct": 10, "default_discount_pct": 8}'::jsonb
  );
  v_guardrail := coalesce(
    public.qep_finance_config_value('trade_valuation_guardrail', v_workspace_id),
    '{"max_trade_cost_pct_of_auction_value": 1.0, "approval_required_above_guardrail": true}'::jsonb
  );

  v_floor_pct := public.qep_trade_recondition_margin_floor_pct(v_workspace_id, coalesce(v_valuation.make, v_trade.make));
  v_trade_cost := coalesce(
    nullif(v_trade.book_value_cents, 0)::numeric / 100.0,
    v_valuation.final_value,
    v_valuation.discounted_value,
    v_valuation.auction_value
  );
  v_expected_sale_price := coalesce(v_valuation.suggested_resale_price, v_valuation.auction_value);
  v_expected_margin_pct := public.qep_trade_expected_margin_pct(
    v_trade_cost,
    v_valuation.reconditioning_estimate,
    v_expected_sale_price
  );

  v_guardrail_max := coalesce((v_guardrail->>'max_trade_cost_pct_of_auction_value')::numeric, 1.0);
  v_min_discount := coalesce((v_discount_band->>'min_discount_pct')::numeric, 8);

  v_guardrail_breach := coalesce((v_guardrail->>'approval_required_above_guardrail')::boolean, true)
    and v_valuation.auction_value is not null
    and v_trade_cost is not null
    and v_trade_cost > (v_valuation.auction_value * v_guardrail_max);

  v_discount_floor_breach := coalesce(v_brand_represented, false) = false
    and coalesce(v_valuation.discount_percentage, v_min_discount) < v_min_discount;

  select
    a.id,
    a.approved_by,
    a.approved_at,
    a.reason,
    (a.metadata->>'approved_reconditioning_estimate')::numeric as approved_reconditioning_estimate
    into v_latest_approval_id,
         v_latest_approved_by,
         v_latest_approved_at,
         v_latest_reason,
         v_latest_approved_reconditioning_estimate
  from public.trade_recondition_approval_audit a
  where a.workspace_id = v_workspace_id
    and (
      a.qb_trade_in_id = v_trade.id
      or (v_trade.trade_valuation_id is not null and a.trade_valuation_id = v_trade.trade_valuation_id)
    )
  order by a.approved_at desc
  limit 1;

  if v_latest_approval_id is not null then
    v_material_change := public.qep_trade_recondition_material_change(
      v_workspace_id,
      v_latest_approved_reconditioning_estimate,
      v_valuation.reconditioning_estimate
    );
  end if;

  v_requires_approval := (
    v_expected_margin_pct is null
    or v_expected_margin_pct < v_floor_pct
    or v_guardrail_breach
    or v_discount_floor_breach
  );

  if v_material_change then
    v_new_status := 'stale';
  elsif v_requires_approval and v_latest_approval_id is not null then
    v_new_status := 'approved';
    v_new_approved_by := v_latest_approved_by;
    v_new_approved_at := v_latest_approved_at;
    v_new_reason := v_latest_reason;
  elsif v_requires_approval then
    v_new_status := 'pending';
  else
    v_new_status := 'not_required';
  end if;

  perform set_config('qep.trade_recondition_sync_active', 'on', true);

  update public.qb_trade_ins t
  set
    reconditioning_requires_manager_approval = (v_requires_approval or v_material_change),
    reconditioning_approval_status = v_new_status,
    reconditioning_approved_by = case when v_new_status = 'approved' then v_new_approved_by else null end,
    reconditioning_approved_at = case when v_new_status = 'approved' then v_new_approved_at else null end,
    reconditioning_approval_reason = case when v_new_status = 'approved' then v_new_reason else null end
  where t.id = v_trade.id
    and (
      t.reconditioning_requires_manager_approval is distinct from (v_requires_approval or v_material_change)
      or t.reconditioning_approval_status is distinct from v_new_status
      or t.reconditioning_approved_by is distinct from case when v_new_status = 'approved' then v_new_approved_by else null end
      or t.reconditioning_approved_at is distinct from case when v_new_status = 'approved' then v_new_approved_at else null end
      or t.reconditioning_approval_reason is distinct from case when v_new_status = 'approved' then v_new_reason else null end
    );

  v_target_trade_status := v_valuation.status;
  if v_new_status in ('pending', 'stale') then
    v_target_trade_status := 'manager_review';
  elsif v_new_status = 'approved' and v_valuation.status <> 'rejected' then
    v_target_trade_status := 'approved';
  elsif v_new_status = 'not_required' and v_valuation.status = 'manager_review' then
    v_target_trade_status := 'preliminary';
  end if;

  update public.trade_valuations tv
  set
    expected_gross_margin_pct = v_expected_margin_pct,
    status = v_target_trade_status,
    approved_by = case
      when v_new_status = 'approved' then v_new_approved_by
      when v_new_status in ('pending', 'stale') then null
      else tv.approved_by
    end,
    approval_notes = case
      when v_new_status = 'approved' then coalesce(v_new_reason, tv.approval_notes)
      when v_new_status in ('pending', 'stale') then null
      else tv.approval_notes
    end,
    updated_at = now()
  where tv.id = v_valuation.id
    and (
      tv.expected_gross_margin_pct is distinct from v_expected_margin_pct
      or tv.status is distinct from v_target_trade_status
      or tv.approved_by is distinct from case
        when v_new_status = 'approved' then v_new_approved_by
        when v_new_status in ('pending', 'stale') then null
        else tv.approved_by
      end
      or tv.approval_notes is distinct from case
        when v_new_status = 'approved' then coalesce(v_new_reason, tv.approval_notes)
        when v_new_status in ('pending', 'stale') then null
        else tv.approval_notes
      end
	    );

  perform set_config('qep.trade_recondition_sync_active', 'off', true);

  return jsonb_build_object(
    'trade_in_id', v_trade.id,
    'trade_valuation_id', v_valuation.id,
    'brand_id', v_brand_id,
    'represented_for_retail_trade', coalesce(v_brand_represented, false),
    'expected_gross_margin_pct', v_expected_margin_pct,
    'margin_floor_pct', v_floor_pct,
    'guardrail_breach', v_guardrail_breach,
    'discount_floor_breach', v_discount_floor_breach,
    'material_change', v_material_change,
    'approval_required', (v_requires_approval or v_material_change),
    'approval_status', v_new_status
  );
end;
$$;

comment on function public.qep_trade_sync_recondition_state(uuid) is
  'Synchronizes Part 10 keep-and-recondition approval state across qb_trade_ins and trade_valuations. Computes expected margin, applies the 15% floor, re-checks guardrails, and reopens approval when recon materially changes.';

revoke execute on function public.qep_trade_sync_recondition_state(uuid) from public;
revoke execute on function public.qep_trade_sync_recondition_state(uuid) from authenticated;
grant execute on function public.qep_trade_sync_recondition_state(uuid) to service_role;

create or replace function public.record_trade_recondition_manager_approval(
  p_qb_trade_in_id uuid,
  p_approved_by uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade public.qb_trade_ins%rowtype;
  v_valuation public.trade_valuations%rowtype;
  v_workspace_id text;
  v_actor uuid := auth.uid();
  v_actor_role text := coalesce((select public.get_my_role())::text, '');
  v_reason text := nullif(trim(p_reason), '');
  v_approver_role text;
  v_audit_id uuid;
  v_snapshot jsonb;
begin
  if (select auth.role()) <> 'service_role'
     and v_actor_role not in ('admin', 'manager', 'owner', 'finance_admin') then
    raise exception 'VALIDATION_TRADE_RECONDITION_APPROVAL_ELEVATED_ROLE_REQUIRED';
  end if;

  if p_qb_trade_in_id is null then
    raise exception 'VALIDATION_QB_TRADE_IN_ID_REQUIRED';
  end if;
  if p_approved_by is null then
    raise exception 'VALIDATION_MANAGER_APPROVER_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_MANAGER_APPROVAL_REASON_REQUIRED';
  end if;

  select t.workspace_id
    into v_workspace_id
  from public.qb_trade_ins t
  where t.id = p_qb_trade_in_id;

  if v_workspace_id is null then
    raise exception 'VALIDATION_QB_TRADE_IN_NOT_FOUND';
  end if;

  if coalesce((select auth.role()), '') = 'authenticated'
     and v_workspace_id is distinct from (select public.get_my_workspace()) then
    raise exception 'VALIDATION_TRADE_RECONDITION_WORKSPACE_SCOPE_REQUIRED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_approved_by
      and p.workspace_id = v_workspace_id
  ) then
    raise exception 'VALIDATION_SALES_MANAGER_APPROVER_WORKSPACE_REQUIRED'
      using errcode = '42501';
  end if;

  select *
    into v_trade
  from public.qb_trade_ins t
  where t.id = p_qb_trade_in_id
    and t.workspace_id = v_workspace_id
  for update;

  if not public.qep_is_trade_recondition_manager_approver(p_approved_by) then
    raise exception 'VALIDATION_SALES_MANAGER_APPROVER_REQUIRED';
  end if;

  if v_trade.disposition is distinct from 'keep_recondition' then
    raise exception 'VALIDATION_KEEP_RECONDITION_DISPOSITION_REQUIRED';
  end if;
  if v_trade.trade_valuation_id is null then
    raise exception 'VALIDATION_TRADE_VALUATION_LINK_REQUIRED';
  end if;

  select *
    into v_valuation
  from public.trade_valuations tv
  where tv.id = v_trade.trade_valuation_id
    and tv.workspace_id = v_workspace_id
  for update;

  if v_valuation.id is null then
    raise exception 'VALIDATION_TRADE_VALUATION_NOT_FOUND';
  end if;

  select p.role::text
    into v_approver_role
  from public.profiles p
  where p.id = p_approved_by
    and p.workspace_id = v_workspace_id;

  v_snapshot := public.qep_trade_sync_recondition_state(v_trade.id);

  insert into public.trade_recondition_approval_audit (
    workspace_id,
    qb_trade_in_id,
    trade_valuation_id,
    deal_id,
    approved_by,
    approved_by_role,
    requested_by,
    requested_by_role,
    reason,
    metadata
  ) values (
    v_trade.workspace_id,
    v_trade.id,
    v_trade.trade_valuation_id,
    v_trade.deal_id,
    p_approved_by,
    v_approver_role,
    v_actor,
    v_actor_role,
    v_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'expected_gross_margin_pct', v_snapshot->'expected_gross_margin_pct',
      'margin_floor_pct', v_snapshot->'margin_floor_pct',
      'guardrail_breach', v_snapshot->'guardrail_breach',
      'discount_floor_breach', v_snapshot->'discount_floor_breach',
	      'trade_cost', coalesce(nullif(v_trade.book_value_cents, 0)::numeric / 100.0, v_valuation.final_value, v_valuation.discounted_value, v_valuation.auction_value),
	      'trade_cost_basis', case
	        when nullif(v_trade.book_value_cents, 0) is not null then 'qb_trade_ins.book_value_cents'
	        when v_valuation.final_value is not null then 'trade_valuations.final_value'
	        when v_valuation.discounted_value is not null then 'trade_valuations.discounted_value'
	        else 'trade_valuations.auction_value'
	      end,
	      'customer_allowance', nullif(v_trade.allowance_cents, 0)::numeric / 100.0,
	      'over_under_cents', v_trade.over_under_cents,
	      'expected_sale_price', coalesce(v_valuation.suggested_resale_price, v_valuation.auction_value),
      'approved_reconditioning_estimate', v_valuation.reconditioning_estimate,
      'represented_for_retail_trade', v_snapshot->'represented_for_retail_trade',
      'material_change_threshold', public.qep_finance_config_value('trade_recondition_material_change_threshold', v_trade.workspace_id)
    )
  )
  returning id into v_audit_id;

  perform public.qep_trade_sync_recondition_state(v_trade.id);

  return v_audit_id;
end;
$$;

comment on function public.record_trade_recondition_manager_approval(uuid, uuid, text, jsonb) is
  'Records immutable sales-manager approval evidence for a keep-and-recondition trade and re-syncs the Part 10 gate state.';

revoke execute on function public.record_trade_recondition_manager_approval(uuid, uuid, text, jsonb) from public;
grant execute on function public.record_trade_recondition_manager_approval(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.record_trade_recondition_manager_approval(uuid, uuid, text, jsonb) to service_role;

drop trigger if exists trg_trade_valuations_guard_expected_margin on public.trade_valuations;
create trigger trg_trade_valuations_guard_expected_margin
  before insert or update of expected_gross_margin_pct
  on public.trade_valuations
  for each row
  execute function public.trade_valuations_guard_expected_margin_write();

drop trigger if exists trg_qb_trade_ins_guard_recondition_approval_state on public.qb_trade_ins;
create trigger trg_qb_trade_ins_guard_recondition_approval_state
  before insert or update of
    reconditioning_requires_manager_approval,
    reconditioning_approval_status,
    reconditioning_approved_by,
    reconditioning_approved_at,
    reconditioning_approval_reason
  on public.qb_trade_ins
  for each row
  execute function public.qb_trade_ins_guard_recondition_approval_state_write();

create or replace function public.qep_trade_recondition_sync_from_trade_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  perform public.qep_trade_sync_recondition_state(NEW.id);
  return null;
end;
$$;

create or replace function public.qep_trade_recondition_sync_from_valuation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade_in_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  for v_trade_in_id in
    select t.id
    from public.qb_trade_ins t
    where t.trade_valuation_id = NEW.id
  loop
    perform public.qep_trade_sync_recondition_state(v_trade_in_id);
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_qb_trade_ins_sync_recondition_margin on public.qb_trade_ins;
create trigger trg_qb_trade_ins_sync_recondition_margin
  after insert or update of trade_valuation_id, disposition, book_value_cents, over_under_cents, allowance_cents
  on public.qb_trade_ins
  for each row
  execute function public.qep_trade_recondition_sync_from_trade_in();

drop trigger if exists trg_trade_recondition_sync_from_valuation on public.trade_valuations;
create trigger trg_trade_recondition_sync_from_valuation
  after insert or update of make, auction_value, discount_percentage, discounted_value, reconditioning_estimate, final_value, suggested_resale_price
  on public.trade_valuations
  for each row
  execute function public.qep_trade_recondition_sync_from_valuation();

insert into public.qb_margin_thresholds (
  workspace_id,
  brand_id,
  min_margin_pct,
  notes
)
select
  b.workspace_id,
  b.id,
  15::numeric,
  'Part 10 trade-recondition floor seeded from Ryan 2026-07-03 decision.'
from public.qb_brands b
where b.represented_for_retail_trade = true
  and not exists (
    select 1
    from public.qb_margin_thresholds t
    where t.workspace_id = b.workspace_id
      and t.brand_id = b.id
  );

update public.qb_margin_thresholds t
set
  min_margin_pct = greatest(coalesce(t.min_margin_pct, 0), 15),
  notes = coalesce(
    nullif(t.notes, ''),
    'Part 10 trade-recondition floor seeded from Ryan 2026-07-03 decision.'
  )
from public.qb_brands b
where b.id = t.brand_id
  and b.represented_for_retail_trade = true
  and t.workspace_id = b.workspace_id
  and (
    t.min_margin_pct < 15
    or t.notes is null
    or t.notes = ''
  );

do $$
declare
  v_trade_in_id uuid;
begin
  for v_trade_in_id in
    select id
    from public.qb_trade_ins
    where trade_valuation_id is not null
  loop
    perform public.qep_trade_sync_recondition_state(v_trade_in_id);
  end loop;
end $$;
