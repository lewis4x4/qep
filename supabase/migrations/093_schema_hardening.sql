-- ============================================================================
-- Migration 093: Schema Hardening
--
-- Fixes integrity issues found in the April 4 code audit:
-- 1. Add NOT NULL to quote_packages.deal_id (nullable breaks upsert logic)
-- 2. Add missing indexes on hot query paths
-- 3. Add CHECK constraint on telematics_feeds (must have equipment or subscription)
-- 4. Add updated_at to quote_signatures (missing from 087)
-- 5. Fix deposit tier function volatility (IMMUTABLE → STABLE)
-- 6. Add cron NULL guards for post-sale automation
--
-- Audit ref: QEP-OS-Code-Audit-Report.md, Sprint 1 items
-- ============================================================================

-- ── 1. quote_packages.deal_id NOT NULL ─────────────────────────────────────
-- The upsert in quote-builder-v2 edge function depends on the unique index
-- (091), but nullable deal_id means NULLs aren't covered by the unique index.
-- Any existing NULL rows need to be cleaned first.

delete from public.quote_packages where deal_id is null;

alter table public.quote_packages
  alter column deal_id set not null;

-- ── 2. Missing indexes ─────────────────────────────────────────────────────

-- quote_packages by created_by (dashboard queries)
create index if not exists idx_quote_packages_created_by
  on public.quote_packages(created_by) where created_by is not null;

-- catalog_entries by external_id (IntelliDealer sync lookup)
create index if not exists idx_catalog_entries_external_id
  on public.catalog_entries(external_id) where external_id is not null;

-- needs_assessments by verified_by (QA reporting)
create index if not exists idx_needs_assessments_verified_by
  on public.needs_assessments(verified_by) where verified_by is not null;

-- quote_signatures by quote_package_id (join path)
create index if not exists idx_quote_signatures_package
  on public.quote_signatures(quote_package_id);

-- ── 3. telematics_feeds must have either equipment or subscription ──────────

alter table public.telematics_feeds
  add constraint telematics_feeds_has_target
  check (equipment_id is not null or subscription_id is not null);

-- ── 4. Add updated_at to quote_signatures ──────────────────────────────────

alter table public.quote_signatures
  add column if not exists updated_at timestamptz not null default now();

-- ── 5. Fix deposit tier function volatility ────────────────────────────────
-- get_deposit_tier was marked IMMUTABLE but reads table data.
-- This can cause stale results in query plans.

create or replace function public.get_deposit_tier(p_amount numeric)
returns text
language sql
stable -- was IMMUTABLE, fixed to STABLE since it references table conventions
set search_path = ''
as $$
  select case
    when p_amount >= 5000 then 'high'
    when p_amount >= 1000 then 'standard'
    else 'low'
  end;
$$;

-- ── 6. Cron NULL guards ────────────────────────────────────────────────────
-- The 2PM nudge cron (088) uses current_setting() without NULL checks.
-- If settings are unset, the cron silently fails.
-- We re-create the cron job with a NULL guard.

select cron.unschedule('prospecting-nudge-2pm');

select cron.schedule(
  'prospecting-nudge-2pm',
  '0 19 * * 1-5',
  $$
  do $$
  declare
    v_url text;
    v_key text;
  begin
    v_url := current_setting('app.settings.supabase_url', true);
    v_key := current_setting('app.settings.service_role_key', true);
    if v_url is null or v_key is null then
      raise notice 'nudge-scheduler: app.settings not configured, skipping';
      return;
    end if;
    perform net.http_post(
      url := v_url || '/functions/v1/nudge-scheduler',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := '{"source": "cron"}'::jsonb
    );
  end $$;
  $$
);
