-- ============================================================================
-- Migration 091: Audit Round 3 — Missing UNIQUE Constraints
--
-- 1. quote_packages needs UNIQUE(deal_id) for upsert to work
-- 2. eaas_usage_records needs UNIQUE(subscription_id, period_start) for upsert
-- ============================================================================

-- Fix 1: quote_packages upsert requires unique constraint on deal_id
create unique index if not exists uq_quote_packages_deal
  on public.quote_packages(deal_id) where deal_id is not null;

-- Fix 2: eaas_usage_records upsert requires composite unique
alter table public.eaas_usage_records
  add constraint uq_usage_subscription_period unique (subscription_id, period_start);
