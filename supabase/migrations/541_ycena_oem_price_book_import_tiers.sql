-- 541_ycena_oem_price_book_import_tiers.sql
--
-- JAR-105 follow-through for supplied ASV/Yanmar price books.
-- ASV and Yanmar are YCENA brand surfaces and QEP dealer cost is calculated
-- as list price less 30% unless a later effective-dated tier supersedes it.
-- Bobcat/Vermeer remain fixture-gated until current sample files are supplied.

alter table public.equipment_base_codes_import_runs
  drop constraint if exists equipment_base_codes_import_runs_manufacturer_chk;

alter table public.equipment_base_codes_import_runs
  add constraint equipment_base_codes_import_runs_manufacturer_chk
  check (manufacturer in ('bobcat', 'vermeer', 'jd', 'yanmar', 'asv', 'ycena', 'other'));

comment on column public.equipment_base_codes_import_runs.manufacturer is
  'OEM/source for Base & Options import. ASV and Yanmar are accepted as YCENA brand surfaces; Bobcat/Vermeer remain sample-file gated.';

create table if not exists public.oem_dealer_cost_tiers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  parent_oem_key text not null,
  brand_key text not null,
  display_name text not null,
  discount_off_list_pct numeric(7, 4) not null check (discount_off_list_pct >= 0 and discount_off_list_pct <= 100),
  effective_from date not null,
  effective_to date,
  source_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (effective_to is null or effective_to >= effective_from),
  unique (workspace_id, brand_key, effective_from)
);

comment on table public.oem_dealer_cost_tiers is
  'Effective-dated dealer cost tiers for OEM price books. YCENA/ASV/Yanmar use list less 30% from the 2026-04-15 supplied price books.';
comment on column public.oem_dealer_cost_tiers.parent_oem_key is
  'Parent OEM relationship key, e.g. ycena for both ASV and Yanmar brand surfaces.';
comment on column public.oem_dealer_cost_tiers.discount_off_list_pct is
  'Dealer cost discount off list price. Importers calculate cost_cents = list_price_cents * (1 - discount_off_list_pct/100).';

create index if not exists idx_oem_dealer_cost_tiers_active
  on public.oem_dealer_cost_tiers (workspace_id, parent_oem_key, brand_key, effective_from desc)
  where deleted_at is null;
comment on index public.idx_oem_dealer_cost_tiers_active is
  'Purpose: price-book parser/import lookup for effective dealer-cost tier by OEM brand.';

alter table public.oem_dealer_cost_tiers enable row level security;

drop policy if exists "oem_dealer_cost_tiers_service_all" on public.oem_dealer_cost_tiers;
create policy "oem_dealer_cost_tiers_service_all"
  on public.oem_dealer_cost_tiers for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "oem_dealer_cost_tiers_elevated_all" on public.oem_dealer_cost_tiers;
create policy "oem_dealer_cost_tiers_elevated_all"
  on public.oem_dealer_cost_tiers for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

drop policy if exists "oem_dealer_cost_tiers_rep_select" on public.oem_dealer_cost_tiers;
create policy "oem_dealer_cost_tiers_rep_select"
  on public.oem_dealer_cost_tiers for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

drop trigger if exists set_oem_dealer_cost_tiers_updated_at on public.oem_dealer_cost_tiers;
create trigger set_oem_dealer_cost_tiers_updated_at
  before update on public.oem_dealer_cost_tiers
  for each row execute function public.set_updated_at();

with workspaces as (
  select distinct workspace_id from public.integration_status where workspace_id is not null
  union
  select 'default'::text
), tiers as (
  select *
  from (values
    ('ycena', 'asv', 'ASV', 30.0000::numeric, '2026-04-15'::date, 'ASV-Price-Book-NA-EFF-14APR2026.pdf'),
    ('ycena', 'yanmar', 'Yanmar Compact Equipment', 30.0000::numeric, '2026-04-15'::date, 'Yanmar-CE-Price-Book-EFF-14APR2026_v2.pdf')
  ) as tier(parent_oem_key, brand_key, display_name, discount_off_list_pct, effective_from, source_reference)
)
insert into public.oem_dealer_cost_tiers (
  workspace_id,
  parent_oem_key,
  brand_key,
  display_name,
  discount_off_list_pct,
  effective_from,
  source_reference,
  notes
)
select
  w.workspace_id,
  t.parent_oem_key,
  t.brand_key,
  t.display_name,
  t.discount_off_list_pct,
  t.effective_from,
  t.source_reference,
  'QEP supplied YCENA price book policy: dealer cost is 30% off list. Parser records both list price and calculated cost.'
from workspaces w
cross join tiers t
on conflict (workspace_id, brand_key, effective_from) do update
set
  parent_oem_key = excluded.parent_oem_key,
  display_name = excluded.display_name,
  discount_off_list_pct = excluded.discount_off_list_pct,
  source_reference = excluded.source_reference,
  notes = excluded.notes,
  updated_at = now();

update public.integration_status
set
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'parity_blocker', 'JAR-105',
    'implementation_status', 'partial_parser_implemented',
    'asv_yanmar_parser', 'implemented_pdf_text_parser',
    'parent_oem', 'YCENA',
    'brand_surfaces', jsonb_build_array('ASV', 'Yanmar'),
    'dealer_cost_policy', '30% off list from supplied YCENA price books, effective 2026-04-15',
    'canonical_write_targets', jsonb_build_array('equipment_base_codes', 'equipment_options', 'equipment_base_codes_import_runs'),
    'bobcat_vermeer_status', 'pending_current_sample_files_or_contracts',
    'workbook_status_guardrail', 'Do not mark Bobcat/Vermeer or full OEM import workflow BUILT from ASV/Yanmar parser evidence alone.'
  ),
  updated_at = now()
where integration_key = 'oem_base_options_imports';
