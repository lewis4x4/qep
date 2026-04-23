-- ──────────────────────────────────────────────────────────────────────────
-- 372_quote_packages_deal_unique.sql
-- The quote-builder-v2 save endpoint does upsert(..., { onConflict: "deal_id" })
-- and the lookup path uses .maybeSingle() on .eq("deal_id", id) — both
-- assume one quote per deal, but migration 087 never enforced it. Postgres
-- rejects the upsert with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification", meaning every save silently
-- 500s in production.
--
-- Partial unique index because deal_id is nullable: NULL rows (quotes
-- that landed before a CRM deal existed — rep-side walk-in flow) stay
-- unconstrained. Real deal_ids are forced to one quote each, matching
-- the upsert's intent and the existing read path.
-- ──────────────────────────────────────────────────────────────────────────

create unique index if not exists quote_packages_deal_id_uidx
  on public.quote_packages (deal_id)
  where deal_id is not null;

comment on index public.quote_packages_deal_id_uidx is
  'One quote_package per deal_id. Enforces the assumption the /save upsert and /public lookup both already made. Partial (deal_id IS NOT NULL) so walk-in quotes without a CRM deal still save.';
