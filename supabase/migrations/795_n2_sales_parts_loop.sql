-- ============================================================================
-- Migration 795: N2.1 — Sales↔Parts loop
--
--   Stream N seam completion (RF-001/RF-014/RF-015). Three dead seams:
--
--   1. Accepted quote part lines were invisible to the parts module — quote
--      acceptance (both public deal-room accept and staff sign) now
--      materializes line_type='part' rows into a draft parts_orders row via
--      _shared/quote-parts-materializer.ts. Schema here: the FK back to the
--      quote package + 'quote' as an order_source.
--
--   2. Quote-side part pricing now routes through parts_resolve_priced_line
--      (m676 governed pricing) at save AND at materialization — same price
--      at the counter and in the quote. (Code-only; no schema.)
--
--   3. The m280 post-sale-parts-playbook batch (designed, never scheduled)
--      gets its pg_cron: daily at 06:10 UTC, vault-backed secret (the edge
--      fn now also accepts x-internal-service-secret). Batch limit 5 keeps
--      LLM spend bounded per run; eligible_deals_for_playbook drains the
--      backlog across days.
-- ============================================================================

BEGIN;

-- ── 1. Quote → counter order linkage ────────────────────────────────────────
ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS quote_package_id uuid REFERENCES public.quote_packages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.parts_orders.quote_package_id is
  'N2.1: the accepted quote this order was staged from (order_source=''quote''). One order per quote package (materializer is idempotent on this FK).';

CREATE INDEX IF NOT EXISTS idx_parts_orders_quote_package
  ON public.parts_orders (quote_package_id)
  WHERE quote_package_id IS NOT NULL;

-- order_source CHECK (supersedes m675's list)
ALTER TABLE public.parts_orders DROP CONSTRAINT IF EXISTS parts_orders_order_source_check;
ALTER TABLE public.parts_orders ADD CONSTRAINT parts_orders_order_source_check
  CHECK (order_source IN (
    'portal', 'counter', 'phone', 'email', 'online', 'transfer',
    'voice', 'photo', 'predictive', 'auto_replenish',
    'quote'
  ));

-- ── 3. Post-sale parts playbook batch cron ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping post-sale-playbook cron: pg_cron not available.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'INTERNAL_SERVICE_SECRET') THEN
    RAISE NOTICE 'Skipping post-sale-playbook cron: INTERNAL_SERVICE_SECRET not in vault.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-sale-playbook-batch') THEN
    PERFORM cron.unschedule('post-sale-playbook-batch');
  END IF;

  PERFORM cron.schedule(
    'post-sale-playbook-batch',
    '10 6 * * *',
    $job$select net.http_post(
    url := 'https://iciddijgonywtxoelous.supabase.co/functions/v1/post-sale-parts-playbook',
    headers := jsonb_build_object('x-internal-service-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'INTERNAL_SERVICE_SECRET'), 'Content-Type', 'application/json'),
    body := '{"batch": true, "limit": 5}'::jsonb,
    timeout_milliseconds := 120000
  )$job$);
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping post-sale-playbook cron: %', SQLERRM;
END $$;

COMMIT;
