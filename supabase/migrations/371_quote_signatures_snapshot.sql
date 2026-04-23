-- ──────────────────────────────────────────────────────────────────────────
-- 371_quote_signatures_snapshot.sql
-- Slice 8 of the deal-room moonshot: capture the exact configuration the
-- customer accepted on the /q/:token deal room. Rep-side signatures write
-- signature_image_url + document_hash; deal-room accepts additionally
-- write the live configuration (attachments toggled, cash-down, term,
-- selected scenario, trade credit) so the accepted row is reviewable
-- without replaying the deal-room state.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.quote_signatures
  add column if not exists signed_snapshot jsonb,
  add column if not exists signed_via text;

comment on column public.quote_signatures.signed_snapshot is
  'jsonb blob the customer actually accepted — attachment keys, cash_down, term_months, selected scenario, trade_credit, customer_total, amount_financed, monthly_payment. document_hash is SHA-256 of its canonical JSON for integrity verification.';
comment on column public.quote_signatures.signed_via is
  'Origin channel: deal_room (customer tap-to-sign from /q/:token), portal (authenticated PortalQuoteRoomPage), rep (in-person rep capture). Null for legacy rows.';
