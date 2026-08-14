-- 835_vendor_profiles_parts_scorecard_grants.sql
-- Parts Command Center (/parts) VendorMetricsCard selects operational scoring
-- columns added in 139_parts_autonomous_operations.sql. Migration 488 locked down
-- vendor_profiles to non-PII columns but omitted these scorecard fields, so
-- authenticated clients hit "permission denied for table vendor_profiles".
-- Grant only operational metrics — not tin, tin_type, or w9_document_url.

grant select (
  fill_rate,
  price_competitiveness,
  composite_score,
  machine_down_priority,
  score_computed_at
) on table public.vendor_profiles to authenticated;

grant select (
  fill_rate,
  price_competitiveness,
  composite_score,
  machine_down_priority,
  score_computed_at
) on table public.vendor_profiles to service_role;

comment on column public.vendor_profiles.fill_rate is
  'Fraction of orders shipped complete (0–1). Readable by authenticated workspace members for parts scorecards.';
comment on column public.vendor_profiles.composite_score is
  'Weighted vendor score for parts routing. Readable by authenticated workspace members for parts scorecards.';

-- Idempotent: safe to re-run if grants already exist.
