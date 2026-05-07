-- 546_quote_packages_opportunity_description_schema_cache.sql
--
-- Repair migration for live Quote Builder saves that can fail with:
--   Could not find the 'opportunity_description' column of 'quote_packages' in the schema cache
--
-- Migration 382 introduced these columns, but this idempotent follow-up keeps
-- environments safe when the physical column or PostgREST schema cache drifted.

alter table public.quote_packages
  add column if not exists opportunity_description text,
  add column if not exists voice_transcript text;

comment on column public.quote_packages.opportunity_description is
  'Rep-authored or AI-chat opportunity description shown in the quote workspace.';
comment on column public.quote_packages.voice_transcript is
  'Voice-entry transcript when the quote originated from voice capture.';

-- Force PostgREST/Supabase API schema cache to recognize the repaired columns.
notify pgrst, 'reload schema';
