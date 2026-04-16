-- ============================================================================
-- Migration 285: QB Programs
--
-- qb_programs               — manufacturer program definitions (CIL, financing, GMU, etc.)
-- qb_program_stacking_rules — which program types can combine (bidirectional rules)
-- ============================================================================

create table public.qb_programs (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',
  brand_id              uuid not null references public.qb_brands(id),
  program_code          text not null,
  program_type          text not null check (program_type in (
    'cash_in_lieu',
    'low_rate_financing',
    'gmu_rebate',
    'aged_inventory',
    'bridge_rent_to_sales',
    'additional_rebate',
    'other'
  )),
  name                  text not null,
  effective_from        date not null,
  effective_to          date not null,
  -- Flexible payload per program_type. Schemas documented in Slice 01 spec.
  details               jsonb not null,
  source_document_url   text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (workspace_id, brand_id, program_code)
);

create index idx_qb_programs_workspace     on public.qb_programs(workspace_id);
create index idx_qb_programs_brand_active  on public.qb_programs(brand_id, active, effective_from, effective_to);
create index idx_qb_programs_type          on public.qb_programs(program_type);

create trigger set_qb_programs_updated_at
  before update on public.qb_programs
  for each row execute function public.set_updated_at();

-- ── qb_program_stacking_rules ────────────────────────────────────────────────

create table public.qb_program_stacking_rules (
  id              uuid primary key default gen_random_uuid(),
  program_type_a  text not null,
  program_type_b  text not null,
  can_combine     boolean not null,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (program_type_a, program_type_b)
);

-- Seed confirmed ASV/Yanmar Q1 2026 stacking rules.
-- The program engine checks both (A,B) and (B,A) so rules stored one-way.
insert into public.qb_program_stacking_rules
  (program_type_a, program_type_b, can_combine, notes)
values
  ('cash_in_lieu',          'low_rate_financing',    false, 'Pick one: CIL or low-rate financing'),
  ('cash_in_lieu',          'aged_inventory',        true,  'Aged inventory stacks with CIL'),
  ('low_rate_financing',    'aged_inventory',        true,  'Aged inventory stacks with financing'),
  ('gmu_rebate',            'cash_in_lieu',          false, 'GMU cannot stack with retail incentives'),
  ('gmu_rebate',            'low_rate_financing',    false, 'GMU cannot stack with retail incentives'),
  ('gmu_rebate',            'aged_inventory',        false, 'GMU cannot stack with retail incentives'),
  ('bridge_rent_to_sales',  'cash_in_lieu',          false, 'Bridge cannot combine with anything'),
  ('bridge_rent_to_sales',  'low_rate_financing',    false, 'Bridge cannot combine with anything'),
  ('bridge_rent_to_sales',  'aged_inventory',        false, 'Bridge cannot combine with anything'),
  ('bridge_rent_to_sales',  'gmu_rebate',            false, 'Bridge cannot combine with anything');
