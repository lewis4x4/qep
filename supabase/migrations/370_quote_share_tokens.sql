-- ──────────────────────────────────────────────────────────────────────────
-- 370_quote_share_tokens.sql
-- Slice 2 of the quote deal-room moonshot: per-quote public share URL.
--
-- Adds a one-way opaque token to quote_packages so reps can send the
-- customer a magic link that loads /q/:token without requiring portal
-- auth. The token is the sole authorization for the public-read path;
-- regenerating invalidates the prior URL. The edge function serves a
-- customer-safe subset (no margin, no internal notes) for any row whose
-- token matches, so RLS on the table stays intact for every other read
-- path.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.quote_packages
  add column if not exists share_token text,
  add column if not exists share_token_created_at timestamptz;

-- Enforce uniqueness only on present tokens so null rows (unshared
-- quotes) don't clash. A partial unique index gives us O(1) lookup on
-- /q/:token without forcing every row to carry one.
create unique index if not exists quote_packages_share_token_uidx
  on public.quote_packages (share_token)
  where share_token is not null;

comment on column public.quote_packages.share_token is
  'Opaque URL-safe token for the /q/:token public deal room. Null until a rep shares. Regenerating rotates the URL and invalidates the old one.';
comment on column public.quote_packages.share_token_created_at is
  'Timestamp the current share_token was issued. Drives expiry policy when we add one.';
