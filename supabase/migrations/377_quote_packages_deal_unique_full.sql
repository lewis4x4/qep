-- ──────────────────────────────────────────────────────────────────────────
-- 377_quote_packages_deal_unique_full.sql
--
-- Migration 376 added a partial unique index (WHERE deal_id IS NOT NULL)
-- thinking it'd satisfy the /save upsert's ON CONFLICT (deal_id). It
-- doesn't: Postgres only uses a partial unique index for ON CONFLICT
-- when the client passes an inference clause that includes the same
-- WHERE predicate, and supabase-js's { onConflict: "deal_id" } doesn't
-- expose the WHERE syntax. So the upsert kept failing with
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- even with 376 applied.
--
-- Drop the partial index and replace with a plain UNIQUE INDEX on
-- deal_id. Postgres's default NULLS DISTINCT semantics let multiple
-- NULL-deal_id rows coexist, which is what we want for walk-in quotes
-- that never got a CRM deal. The index is now inferable by the bare
-- ON CONFLICT (deal_id) clause the client sends.
-- ──────────────────────────────────────────────────────────────────────────

drop index if exists public.quote_packages_deal_id_uidx;

create unique index if not exists quote_packages_deal_id_uidx
  on public.quote_packages (deal_id);

comment on index public.quote_packages_deal_id_uidx is
  'One quote_package per deal_id; multiple NULL deal_id rows are allowed (walk-in quotes without a CRM deal). Inferable by supabase-js ON CONFLICT (deal_id).';
