-- ============================================================================
-- Migration 836: RF-001 idempotency hardening — one parts order per accepted quote
--
-- N2.1 materializes accepted quote part lines into parts_orders via
-- quote_package_id. Application-level probes already guard replays; this
-- unique partial index makes concurrent accepts atomic at the database.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_orders_quote_package_unique
  ON public.parts_orders (quote_package_id)
  WHERE quote_package_id IS NOT NULL;

COMMENT ON INDEX public.idx_parts_orders_quote_package_unique IS
  'RF-001/N2.1: at most one staged counter order per accepted quote package.';

COMMIT;
