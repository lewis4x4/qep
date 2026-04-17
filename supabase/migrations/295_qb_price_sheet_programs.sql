-- ============================================================================
-- Migration 292: QB Price Sheet Programs
--
-- qb_price_sheet_programs — extracted program rows from retail-program PDFs,
--   flowing through the same admin review pipeline as qb_price_sheet_items.
--   On publish, rows are applied to / update qb_programs.
--
-- Separate from qb_price_sheet_items because program structure is different
-- enough (no model/attachment/freight item_type overlap) to warrant its own
-- table with cleaner foreign-key semantics.
-- ============================================================================

create table public.qb_price_sheet_programs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        text not null default 'default',
  price_sheet_id      uuid not null references public.qb_price_sheets(id) on delete cascade,
  program_code        text not null,
  program_type        text not null check (program_type in (
    'cash_in_lieu','low_rate_financing','gmu_rebate',
    'aged_inventory','bridge_rent_to_sales','additional_rebate'
  )),
  extracted           jsonb not null,
  -- proposed link to existing program row (null = new)
  proposed_program_id uuid references public.qb_programs(id),
  action              text not null check (action in ('create','update','no_change','skip')),
  confidence          numeric(3,2),
  diff                jsonb,
  extraction_metadata jsonb,
  review_status       text not null default 'pending' check (review_status in (
    'pending','approved','rejected','modified'
  )),
  reviewer_notes      text,
  applied_at          timestamptz,
  created_at          timestamptz not null default now()
);

comment on table public.qb_price_sheet_programs is
  'Extracted program rows awaiting admin review before being written to qb_programs. '
  'Mirrors qb_price_sheet_items but typed for program payloads. '
  'On publish: create inserts, update patches, no_change skips, skip skips.';

comment on column public.qb_price_sheet_programs.extraction_metadata is
  'Raw Claude response + parsed JSON per program row for debugging. '
  'Schema: { raw_response: string, parsed: unknown, model: string, input_tokens: int, output_tokens: int }';

create index idx_qb_price_sheet_programs_sheet on public.qb_price_sheet_programs(price_sheet_id, review_status);
create index idx_qb_price_sheet_programs_type  on public.qb_price_sheet_programs(program_type, action);
