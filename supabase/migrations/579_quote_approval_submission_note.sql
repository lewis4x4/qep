-- ============================================================================
-- Migration 579: rep-supplied submission note on quote approval cases
-- ============================================================================

alter table public.quote_approval_cases
  add column if not exists submission_note text;

comment on column public.quote_approval_cases.submission_note is
  'Optional rep-supplied justification for an approval submission — primarily filled when the quote is below margin floor or above amount ceiling.';
