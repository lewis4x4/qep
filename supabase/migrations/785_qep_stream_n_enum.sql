-- ============================================================================
-- Migration 785: add 'N' (Seam Completion) to qep_roadmap_stream
-- Enum-only migration: ALTER TYPE ... ADD VALUE cannot be USED in the same
-- transaction that adds it, and db-push wraps each file in one BEGIN..COMMIT,
-- so the label lands here and the seed rows ride the next migration.
-- Source: docs/reviews/2026-07-08-full-codebase-review.md (red-lined + approved
-- 2026-07-08); drafts formerly at docs/reviews/drafts/stream-n-seed.sql.
-- Safety envelope: append-only; adds enum label 'N' only.
-- ============================================================================

ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'N' AFTER 'M';

-- Final stream map after Stream N promotion.
COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation · F=Decision Velocity · G=Parts Department · H=Service Department · I=Grapple-Truck Production · J=Workforce · K=Financials Re-architecture · L=Rental Department · M=Revenue Convergence · N=Seam Completion';
