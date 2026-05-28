-- ============================================================================
-- Migration 628: one active reprice draft per impact
-- Target: QEP Supabase project (iciddijgonywtxoelous)
--
-- oem-price-feeds handleDraft could insert multiple drafts for the same impact:
-- migration 610 created only a NON-unique index on (impact_id, created_at). A
-- double-submit / retry, or acting on a stale 'visible' impact, produced
-- duplicate drafts. This partial unique index allows at most one draft per
-- impact while it is still in flight; terminal drafts (applied / rejected /
-- withdrawn, once Phase-2 enables apply) leave the index and don't block a
-- fresh draft. Pairs with the server-side state guard + 23505→409 handling.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_quote_reprice_drafts_active_impact
  ON public.qb_quote_reprice_drafts (impact_id)
  WHERE status IN ('draft', 'approval_pending');

COMMIT;
