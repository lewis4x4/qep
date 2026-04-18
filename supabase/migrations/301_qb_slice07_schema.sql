-- ============================================================================
-- Migration 301: Slice 07 schema additions
--
-- 1. qb_brands.discount_configured — update column comment to reflect
--    Deal Economics reframe from Slice 06. Column name unchanged (14
--    product-code files reference it, above the 10-file rename threshold).
--    UI surfaces this as "Deal Engine Enabled".
--
-- 2. qb_quotes.originating_log_id — FK to qb_ai_request_log(id) so the
--    AI Request Log page can compute real time-from-parse-to-quote-sent.
--    Null for manually created quotes.
-- ============================================================================

-- ── 1. Update column comment on qb_brands.discount_configured ───────────────

comment on column public.qb_brands.discount_configured is
  'True when this brand is fully configured for the deal engine '
  '(pricing inputs confirmed by admin). False for forestry and other brands '
  'pending Angela''s configuration. '
  'Surfaced in the UI as "Deal Engine Enabled". '
  'Column name predates the Slice 06 Deal Economics reframe — name is '
  'unchanged to avoid a blast-radius rename (14 product-code callsites).';

-- ── 2. qb_quotes: add originating_log_id FK ─────────────────────────────────

alter table public.qb_quotes
  add column if not exists originating_log_id uuid
    references public.qb_ai_request_log(id) on delete set null;

create index idx_qb_quotes_originating_log
  on public.qb_quotes(originating_log_id)
  where originating_log_id is not null;

comment on column public.qb_quotes.originating_log_id is
  'FK to the qb_ai_request_log row that triggered this quote via the '
  'Conversational Deal Engine. Null for manually-created quotes. '
  'Enables the time-from-AI-parse-to-quote-sent metric in AiRequestLogPage. '
  'Set by qb-ai-scenarios when a scenario session results in a quote.';
