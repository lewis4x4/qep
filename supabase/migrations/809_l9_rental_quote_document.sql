-- 809_l9_rental_quote_document.sql
-- L9.5 — Rental quote document path: share, e-sign, approval (RF-025).
--
-- A rental "quote" was only a lifecycle state: no customer-facing
-- document, no share token, no e-signature at the quoted stage (the m607
-- native-sign path gates on approved/active), no win/loss analytics.
-- Design (cheapest faithful path, mapped 2026-07-09): reuse the working
-- rental_contract_signatures + native_* stack and copy the equipment
-- quote share-token blueprint (m370) one lifecycle stage earlier.
--
-- 1. rental_contracts.share_token — the tokened public-read authorization
--    for the /rq/:token page (same model as quote_packages.share_token;
--    RLS stays intact, the public edge fn serves a customer-safe subset).
-- 2. rental_contract_signatures.signed_via gains 'share_link' so quote
--    signatures carry honest provenance (m607 allowed only 'portal').
-- 3. Win/loss truth: transitions FROM 'quoted' emit rental.quote.won
--    (→ reserved) / rental.quote.lost (→ cancelled/declined/expired) on
--    the event fabric — the structural funnel the L-stream blueprint
--    called for, without a new outcomes table.

BEGIN;

alter table public.rental_contracts
  add column if not exists share_token text,
  add column if not exists share_token_created_at timestamptz;

comment on column public.rental_contracts.share_token is
  'Public rental-quote link token (L9.5). Sole authorization for the customer-facing quote read/sign path — rotate by re-issuing.';

create unique index if not exists uq_rental_contracts_share_token
  on public.rental_contracts (share_token)
  where share_token is not null;

-- signed_via provenance for tokened quote signatures
alter table public.rental_contract_signatures
  drop constraint if exists rental_contract_signatures_signed_via_check;
alter table public.rental_contract_signatures
  add constraint rental_contract_signatures_signed_via_check
  check (signed_via in ('portal', 'share_link'));

-- ─────────────────────────────────────────────────────────────────────────
-- Quote win/loss events
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_rental_quote_outcome_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lifecycle_state <> 'quoted' or new.lifecycle_state = old.lifecycle_state then
    return new;
  end if;

  if new.lifecycle_state = 'reserved' then
    perform public.emit_event(
      'rental.quote.won', 'rental', 'rental_contract', new.id::text,
      jsonb_build_object(
        'rental_id', new.id,
        'contract_number', new.contract_number,
        'company_id', new.qrm_company_id,
        'agreed_daily_rate', new.agreed_daily_rate,
        'agreed_weekly_rate', new.agreed_weekly_rate,
        'agreed_monthly_rate', new.agreed_monthly_rate),
      new.workspace_id);
  elsif new.lifecycle_state in ('cancelled', 'declined', 'expired') then
    perform public.emit_event(
      'rental.quote.lost', 'rental', 'rental_contract', new.id::text,
      jsonb_build_object(
        'rental_id', new.id,
        'contract_number', new.contract_number,
        'company_id', new.qrm_company_id,
        'outcome', new.lifecycle_state),
      new.workspace_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_rental_quote_outcome_emit on public.rental_contracts;
create trigger trg_rental_quote_outcome_emit
  after update of lifecycle_state on public.rental_contracts
  for each row execute function public.trg_rental_quote_outcome_emit();

COMMIT;
