-- 612_oem_master_schema_resolver.sql
--
-- C2.1 / QEP-69 — Slice 5.1 OEM master schema + resolver.
-- Establishes the canonical OEM master table, links uploaded price sheets to
-- OEMs, and exposes an effective-dated dealer-cost resolver for quote/import
-- flows. Existing oem_dealer_cost_tiers from migration 541 remains the source
-- of truth for discount tiers.

create table if not exists public.oems (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  oem_key text not null,
  parent_oem_key text,
  display_name text not null,
  category text check (category in ('construction', 'forestry', 'parts', 'rental', 'other')),
  source_format text not null default 'unknown' check (source_format in ('pdf', 'xlsx', 'xls', 'csv', 'email', 'portal', 'api', 'unknown')),
  price_sheet_cadence text not null default 'unknown' check (price_sheet_cadence in ('monthly', 'quarterly', 'semi_annual', 'annual', 'ad_hoc', 'unknown')),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, oem_key)
);

comment on table public.oems is
  'Canonical OEM master records used by price-sheet ingestion, dealer-cost resolution, and quote repricing workflows.';
comment on column public.oems.oem_key is
  'Lowercase canonical OEM key used for resolver joins, e.g. ycena, asv, yanmar, bandit.';
comment on column public.oems.parent_oem_key is
  'Optional parent OEM key for brand surfaces. ASV and Yanmar resolve under YCENA dealer-cost tiers.';
comment on column public.oems.source_format is
  'Default expected price-sheet source format for the OEM.';
comment on column public.oems.price_sheet_cadence is
  'Expected price-sheet refresh cadence for monitoring and admin triage.';

create index if not exists idx_oems_workspace_active
  on public.oems (workspace_id, active, oem_key)
  where deleted_at is null;

create index if not exists idx_oems_parent
  on public.oems (workspace_id, parent_oem_key)
  where parent_oem_key is not null and deleted_at is null;

alter table public.oems enable row level security;

drop policy if exists "oems_service_all" on public.oems;
create policy "oems_service_all"
  on public.oems for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "oems_elevated_all" on public.oems;
create policy "oems_elevated_all"
  on public.oems for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

drop policy if exists "oems_workspace_member_select" on public.oems;
create policy "oems_workspace_member_select"
  on public.oems for select
  using (
    auth.uid() is not null
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

drop trigger if exists set_oems_updated_at on public.oems;
create trigger set_oems_updated_at
  before update on public.oems
  for each row execute function public.set_updated_at();

alter table public.qb_price_sheets
  add column if not exists oem_id uuid references public.oems(id) on delete set null,
  add column if not exists oem_key text,
  add column if not exists source_format text,
  add column if not exists source_cadence text,
  add column if not exists resolver_metadata jsonb not null default '{}'::jsonb;

alter table public.qb_price_sheets
  drop constraint if exists qb_price_sheets_source_format_chk;
alter table public.qb_price_sheets
  add constraint qb_price_sheets_source_format_chk
  check (source_format is null or source_format in ('pdf', 'xlsx', 'xls', 'csv', 'email', 'portal', 'api', 'unknown'));

alter table public.qb_price_sheets
  drop constraint if exists qb_price_sheets_source_cadence_chk;
alter table public.qb_price_sheets
  add constraint qb_price_sheets_source_cadence_chk
  check (source_cadence is null or source_cadence in ('monthly', 'quarterly', 'semi_annual', 'annual', 'ad_hoc', 'unknown'));

comment on column public.qb_price_sheets.oem_id is
  'Canonical OEM master record for this uploaded or auto-ingested price sheet.';
comment on column public.qb_price_sheets.oem_key is
  'Snapshot OEM key retained for import/resolver flows and historical sheets.';
comment on column public.qb_price_sheets.source_format is
  'Observed source format for this price sheet; can differ from the OEM default.';
comment on column public.qb_price_sheets.source_cadence is
  'Observed or expected refresh cadence for this sheet.';
comment on column public.qb_price_sheets.resolver_metadata is
  'Structured metadata emitted by price-sheet parsing and dealer-cost resolution.';

create index if not exists idx_qb_price_sheets_oem
  on public.qb_price_sheets (workspace_id, oem_key, status, effective_from desc)
  where oem_key is not null;

create index if not exists idx_qb_price_sheets_oem_id
  on public.qb_price_sheets (oem_id)
  where oem_id is not null;

with workspaces as (
  select distinct workspace_id from public.integration_status where workspace_id is not null
  union
  select distinct workspace_id from public.qb_brands where workspace_id is not null
  union
  select 'default'::text
), oem_seed as (
  select *
  from (values
    ('ycena', null::text, 'Yanmar Compact Equipment North America', 'construction', 'pdf', 'ad_hoc', true, '{"notes":"Parent OEM for ASV and Yanmar Compact Equipment price-book surfaces."}'::jsonb),
    ('asv', 'ycena', 'ASV', 'construction', 'pdf', 'ad_hoc', true, '{"dealer_cost_policy":"YCENA tier: 30% off list from supplied 2026-04-15 price book."}'::jsonb),
    ('yanmar', 'ycena', 'Yanmar Compact Equipment', 'construction', 'pdf', 'ad_hoc', true, '{"dealer_cost_policy":"YCENA tier: 30% off list from supplied 2026-04-15 price book."}'::jsonb),
    ('develon', null::text, 'Develon', 'construction', 'unknown', 'unknown', true, '{}'::jsonb),
    ('bandit', null::text, 'Bandit', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('barko', null::text, 'Barko', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('prinoth', null::text, 'Prinoth', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('lamtrac', null::text, 'Lamtrac', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('shearex', null::text, 'Shearex', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('denis_cimaf', null::text, 'Denis Cimaf', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('supertrak', null::text, 'Supertrak', 'forestry', 'unknown', 'unknown', true, '{}'::jsonb),
    ('cmi', null::text, 'CMI', 'other', 'unknown', 'unknown', true, '{}'::jsonb),
    ('serco', null::text, 'Serco', 'other', 'unknown', 'unknown', true, '{}'::jsonb),
    ('diamond_z', null::text, 'Diamond Z', 'other', 'unknown', 'unknown', true, '{}'::jsonb)
  ) as seed(oem_key, parent_oem_key, display_name, category, source_format, price_sheet_cadence, active, metadata)
)
insert into public.oems (
  workspace_id,
  oem_key,
  parent_oem_key,
  display_name,
  category,
  source_format,
  price_sheet_cadence,
  active,
  metadata
)
select
  w.workspace_id,
  s.oem_key,
  s.parent_oem_key,
  s.display_name,
  s.category,
  s.source_format,
  s.price_sheet_cadence,
  s.active,
  s.metadata
from workspaces w
cross join oem_seed s
on conflict (workspace_id, oem_key) do update
set
  parent_oem_key = excluded.parent_oem_key,
  display_name = excluded.display_name,
  category = excluded.category,
  source_format = excluded.source_format,
  price_sheet_cadence = excluded.price_sheet_cadence,
  active = excluded.active,
  metadata = public.oems.metadata || excluded.metadata,
  deleted_at = null,
  updated_at = now();

alter table public.oem_dealer_cost_tiers
  add column if not exists oem_id uuid references public.oems(id) on delete set null;

comment on column public.oem_dealer_cost_tiers.oem_id is
  'Optional canonical OEM master link for this effective-dated dealer-cost tier.';

create index if not exists idx_oem_dealer_cost_tiers_oem_id
  on public.oem_dealer_cost_tiers (oem_id)
  where oem_id is not null and deleted_at is null;

update public.oem_dealer_cost_tiers tier
set oem_id = o.id
from public.oems o
where tier.oem_id is null
  and tier.workspace_id = o.workspace_id
  and tier.brand_key = o.oem_key;

update public.qb_price_sheets ps
set oem_key = regexp_replace(lower(b.code), '[^a-z0-9]+', '_', 'g')
from public.qb_brands b
where ps.brand_id = b.id
  and ps.oem_key is null;

update public.qb_price_sheets ps
set
  oem_id = o.id,
  source_format = coalesce(ps.source_format, o.source_format),
  source_cadence = coalesce(ps.source_cadence, o.price_sheet_cadence)
from public.oems o
where ps.oem_id is null
  and ps.workspace_id = o.workspace_id
  and ps.oem_key = o.oem_key;

create or replace function public.resolve_oem_cost(
  p_oem_key text,
  p_brand_key text,
  p_list_price_cents bigint,
  p_effective_on date default current_date,
  p_workspace_id text default null
)
returns table (
  dealer_cost_cents bigint,
  discount_off_list_pct numeric,
  tier_id uuid,
  oem_id uuid,
  parent_oem_key text,
  brand_key text,
  effective_from date,
  effective_to date,
  source_reference text
)
language sql
stable
security definer
set search_path = ''
as $$
  with args as (
    select
      coalesce(nullif(p_workspace_id, ''), public.get_my_workspace(), 'default') as workspace_id,
      nullif(regexp_replace(lower(coalesce(p_oem_key, '')), '[^a-z0-9]+', '_', 'g'), '') as oem_key,
      nullif(regexp_replace(lower(coalesce(p_brand_key, '')), '[^a-z0-9]+', '_', 'g'), '') as brand_key,
      greatest(coalesce(p_list_price_cents, 0), 0)::numeric as list_price_cents,
      coalesce(p_effective_on, current_date) as effective_on
  ), candidates as (
    select
      t.*,
      case
        when t.brand_key = args.brand_key then 0
        when t.brand_key = args.oem_key then 1
        when t.parent_oem_key = args.oem_key then 2
        when t.parent_oem_key = args.brand_key then 3
        else 9
      end as match_rank,
      args.list_price_cents
    from args
    join public.oem_dealer_cost_tiers t
      on t.workspace_id = args.workspace_id
     and t.deleted_at is null
     and t.effective_from <= args.effective_on
     and (t.effective_to is null or t.effective_to >= args.effective_on)
     and (
       t.brand_key = args.brand_key
       or t.brand_key = args.oem_key
       or t.parent_oem_key = args.oem_key
       or t.parent_oem_key = args.brand_key
     )
  )
  select
    round(c.list_price_cents * (1 - (c.discount_off_list_pct / 100.0)))::bigint as dealer_cost_cents,
    c.discount_off_list_pct,
    c.id as tier_id,
    c.oem_id,
    c.parent_oem_key,
    c.brand_key,
    c.effective_from,
    c.effective_to,
    c.source_reference
  from candidates c
  order by c.match_rank, c.effective_from desc, c.created_at desc
  limit 1;
$$;

comment on function public.resolve_oem_cost(text, text, bigint, date, text) is
  'Resolves effective dealer cost from list price using OEM dealer-cost tiers. Prefer exact brand tier, then OEM/parent tier, scoped by workspace and effective date.';

revoke all on function public.resolve_oem_cost(text, text, bigint, date, text) from public;
grant execute on function public.resolve_oem_cost(text, text, bigint, date, text) to authenticated, service_role;
