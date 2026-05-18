-- ============================================================================
-- Migration 581: Deprecate qb_quotes (metadata only — no drops, no data moves)
--
-- Phase 4 of the quote-approval feedback-loop work (wave-approval-loop).
-- Phases 1-3 (commits 65f2dc3d, 5a71d2ad, cfbee67b) shipped the rep feedback
-- loop, surface points, and manager polish entirely against quote_packages.
-- An audit confirmed qb_quotes is structurally orphaned:
--   • zero edge functions in supabase/functions/quote-builder-v2/* or
--     supabase/functions/quote-api*/* write to it
--   • the only frontend reference is admin AI-log enrichment in
--     apps/web/src/features/admin/lib/ai-log-api.ts, which READS for
--     time-to-quote stats and already queries quote_packages in parallel
--   • the four approval columns (requires_approval, approval_reason,
--     approved_by, approved_at) declared in migration 286 were superseded
--     before they were ever wired — quote_approval_cases (migration 363)
--     owns the entire approval lifecycle now
--
-- This migration is pure metadata: it stamps the table and orphan columns
-- with deprecation comments so anyone running `\d qb_quotes` in psql or
-- introspecting the schema sees the warning. No rows move. No columns drop.
-- The actual table drop is a future release after a quiet cycle, once
-- ai-log-api.ts has stopped reading from qb_quotes for legacy enrichment.
--
-- Idempotent by construction — `comment on …` overwrites.
-- ============================================================================

-- ── 1. Table-level deprecation banner ───────────────────────────────────────
comment on table public.qb_quotes is
  'DEPRECATED 2026-05 — superseded by public.quote_packages. The quote approval flow (Phases 1-4 of wave-approval-loop) reads and writes quote_packages exclusively. Do not write new code targeting this table. Scheduled for drop in a follow-up release after a quiet cycle. See migration 581 for context.';

-- ── 2. Column-level pointers to the replacement schema ─────────────────────
comment on column public.qb_quotes.requires_approval is
  'DEPRECATED — superseded by the quote_approval_cases table. Was never wired by the approval flow.';

comment on column public.qb_quotes.approval_reason is
  'DEPRECATED — superseded by quote_approval_cases.submission_note and quote_approval_cases.decision_note.';

comment on column public.qb_quotes.approved_by is
  'DEPRECATED — superseded by quote_approval_cases.decided_by.';

comment on column public.qb_quotes.approved_at is
  'DEPRECATED — superseded by quote_approval_cases.decided_at.';
