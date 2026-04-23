-- ──────────────────────────────────────────────────────────────────────────
-- 381_quote_packages_accepted_at.sql
--
-- The Quotes list needs a first-class accepted timestamp for Wins MTD.
-- Historically the canonical timestamp lived on quote_signatures.signed_at,
-- which made the list metric require a join and left accepted package rows
-- without a direct lifecycle field.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.quote_packages
  add column if not exists accepted_at timestamptz;

update public.quote_packages qp
set accepted_at = sig.first_signed_at
from (
  select quote_package_id, min(signed_at) as first_signed_at
  from public.quote_signatures
  where is_valid = true
  group by quote_package_id
) sig
where qp.id = sig.quote_package_id
  and qp.accepted_at is null
  and qp.status = 'accepted';

create index if not exists idx_quote_packages_accepted_at_desc
  on public.quote_packages(accepted_at desc)
  where accepted_at is not null;

comment on column public.quote_packages.accepted_at is
  'First accepted timestamp for quote list Wins MTD metrics. Backfilled from the first valid quote_signatures.signed_at.';
