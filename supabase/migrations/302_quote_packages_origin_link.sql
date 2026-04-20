-- Migration 302: Link quote_packages to qb_ai_request_log
--
-- Slice 09 CP1: Lights up the dormant "Time to Quote" column shipped in
-- Slice 07 CP8 + Slice 08 observability. The original Slice-07 design
-- added `originating_log_id` to `qb_quotes`, but the live Quote Builder
-- V2 flow still writes to `quote_packages` (the cents-denominated pricing
-- breakdown qb_quotes requires isn't available at QuoteBuilderV2 save
-- time — that's a later, larger slice).
--
-- Minimal fix: add the same FK to quote_packages so CP8's read path can
-- join it today. No data migration; new quotes link going forward.
--
-- Semantics match the Slice-07 qb_quotes FK:
--   ON DELETE SET NULL — log rows may be purged (GDPR); quotes must survive.

alter table public.quote_packages
  add column if not exists originating_log_id uuid
    references public.qb_ai_request_log(id) on delete set null;

create index if not exists idx_quote_packages_originating_log
  on public.quote_packages(originating_log_id)
  where originating_log_id is not null;

comment on column public.quote_packages.originating_log_id is
  'FK to the qb_ai_request_log row that led to this quote, when the quote '
  'was built from an AI-assisted entry path. Null for manually-started quotes. '
  'Slice 09 minimal — parallels qb_quotes.originating_log_id, which will '
  'eventually replace this once the Quote Builder adopts rich pricing output.';
