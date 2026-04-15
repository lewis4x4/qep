-- ============================================================================
-- Migration 256: Quote package viewed_at + state-machine audit (Slice 2.1h)
--
-- The roadmap spec for Track 2 Slice 2.1h calls for an e-signature state
-- machine `draft → sent → viewed → signed`. The existing schema already
-- supports that transition set via the `status` check constraint on
-- `quote_packages` (draft, ready, sent, viewed, accepted, rejected, expired),
-- but there was no `viewed_at` timestamp column to pair with the `viewed`
-- state the way `sent_at` pairs with `sent`. This migration closes that gap.
--
-- Idempotent: both column + index are guarded.
-- ============================================================================

alter table public.quote_packages
  add column if not exists viewed_at timestamptz;

comment on column public.quote_packages.viewed_at is
  'Timestamp the customer first opened the quote package (state: sent → viewed). Set by quote-builder-v2 mark-viewed action.';

-- Partial index — nearly every row has viewed_at null until the customer opens,
-- so skip NULLs to keep the index tight.
create index if not exists idx_quote_packages_viewed_at
  on public.quote_packages (viewed_at)
  where viewed_at is not null;

-- Rollback (manual):
--   drop index if exists public.idx_quote_packages_viewed_at;
--   alter table public.quote_packages drop column if exists viewed_at;
