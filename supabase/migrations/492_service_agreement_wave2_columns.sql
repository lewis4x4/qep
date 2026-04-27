-- 492_service_agreement_wave2_columns.sql
-- Wave 2 no-op/additive compatibility for service_agreements.
-- Wave 1 migration 469 already resolved the audit conflict by extending the
-- existing service_agreements table. This file is intentionally small to keep
-- the Wave 2 target group explicit and rerunnable-safe.

comment on table public.service_agreements is
  'Existing QEP service agreements table with IntelliDealer compatibility fields added in Wave 1 and retained for Wave 2 column-extension accounting.';
