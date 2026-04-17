-- ============================================================================
-- Migration 291: QB Price Sheet — column additions for Slice 04 ingestion
--
-- qb_price_sheets:      add sheet_type (routes extract-price-sheet to the
--                       correct Claude prompt)
-- qb_price_sheet_items: add extraction_metadata (raw Claude response + parsed
--                       JSON for admin debugging), diff (field-level diff for
--                       review UI)
-- ============================================================================

alter table public.qb_price_sheets
  add column if not exists sheet_type text
    check (sheet_type in ('price_book','retail_programs','both','other'));

comment on column public.qb_price_sheets.sheet_type is
  'Determines which Claude prompt template extract-price-sheet uses. '
  'price_book → model/attachment/freight extraction. '
  'retail_programs → program extraction. '
  'both → two-pass extraction.';

alter table public.qb_price_sheet_items
  add column if not exists extraction_metadata jsonb,
  add column if not exists diff               jsonb;

comment on column public.qb_price_sheet_items.extraction_metadata is
  'Raw Claude response (text) + parsed JSON stored per-item for debugging bad parses. '
  'Schema: { raw_response: string, parsed: unknown, model: string, input_tokens: int, output_tokens: int }';

comment on column public.qb_price_sheet_items.diff is
  'Field-level diff for update items. '
  'Schema: { field: { old: unknown, new: unknown } }. Null for create/no_change/skip.';
