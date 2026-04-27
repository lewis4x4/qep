-- 478_parts_catalog_wave2_columns.sql
-- Wave 2 column extensions for parts_catalog from Phase-3 Parts.

alter table public.parts_catalog
  add column if not exists requires_label boolean not null default false,
  add column if not exists in_transit integer not null default 0,
  add column if not exists maximum_discount_code text,
  add column if not exists maximum_discount_pct numeric(5, 2),
  add column if not exists tax_1_applies boolean not null default true,
  add column if not exists tax_2_applies boolean not null default true,
  add column if not exists tax_3_applies boolean not null default true,
  add column if not exists tax_4_applies boolean not null default true,
  add column if not exists amax_apr_code text,
  add column if not exists amax_apr_source text,
  add column if not exists season_code text,
  add column if not exists season_length_months integer,
  add column if not exists effectual_pct numeric(5, 2),
  add column if not exists protect_months integer,
  add column if not exists protect_quantity integer,
  add column if not exists protect_code text,
  add column if not exists do_not_order boolean not null default false,
  add column if not exists do_not_order_set_at date,
  add column if not exists do_not_order_reason text,
  add column if not exists lost_sale_frequency integer not null default 0,
  add column if not exists lost_sale_quantity integer not null default 0,
  add column if not exists special_order_frequency integer not null default 0,
  add column if not exists special_order_quantity integer not null default 0,
  add column if not exists last_customer_order_number text,
  add column if not exists last_customer_order_type text,
  add column if not exists ofc_reclass_from text,
  add column if not exists ofc_reclass_to text,
  add column if not exists ofc_reclass_at date,
  add column if not exists suppress_portal_pricing boolean not null default false,
  add column if not exists price_update_type text,
  add column if not exists is_reman boolean not null default false,
  add column if not exists core_charge_cents bigint,
  add column if not exists core_part_id uuid references public.parts_catalog(id) on delete set null,
  add column if not exists central_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists use_central_order boolean not null default false;

comment on column public.parts_catalog.requires_label is 'IntelliDealer Parts Profile label-required flag.';
comment on column public.parts_catalog.in_transit is 'Quantity currently in transit from vendor/branch transfer.';
comment on column public.parts_catalog.suppress_portal_pricing is 'Hide MyDealer/portal price for this part.';
comment on column public.parts_catalog.is_reman is 'Remanufactured part flag; core charge fields apply when true.';
comment on column public.parts_catalog.central_branch_id is 'Central ordering branch for parts with centralized replenishment.';

create index if not exists idx_parts_catalog_central_branch
  on public.parts_catalog (workspace_id, central_branch_id)
  where central_branch_id is not null;
comment on index public.idx_parts_catalog_central_branch is 'Purpose: central-order replenishment grouping by branch.';

create index if not exists idx_parts_catalog_core_part
  on public.parts_catalog (workspace_id, core_part_id)
  where core_part_id is not null;
comment on index public.idx_parts_catalog_core_part is 'Purpose: reman/core-part relationship lookup.';
