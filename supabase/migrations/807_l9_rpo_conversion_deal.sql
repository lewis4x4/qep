-- 807_l9_rpo_conversion_deal.sql
-- L9.3 — RPO conversion creates the deal; Conversion Engine reads rental
-- truth (RF-024: accrued credit dead-ended in a follow-up task — which
-- itself failed on a null activity anchor, so the sales motion never
-- landed at all).
--
-- 1. qrm_deals.rental_contract_id — provenance FK for RPO conversion
--    deals, with a partial unique index so the flow action and the
--    operator button are idempotent on the same contract.
-- 2. rental_conversion_signals(p_company_id) — the rental-truth board
--    read: contract counts, trailing-90-day billed cents, and active RPO
--    accrual per contract, all by qrm_company_id (the join path proven by
--    get_account_360's rental arm, m801).

BEGIN;

alter table public.qrm_deals
  add column if not exists rental_contract_id uuid references public.rental_contracts(id) on delete set null;

comment on column public.qrm_deals.rental_contract_id is
  'Provenance: the rental contract this deal converts (L9.3 RPO conversion). One conversion deal per contract.';

create unique index if not exists uq_qrm_deals_rental_contract
  on public.qrm_deals (rental_contract_id)
  where rental_contract_id is not null and deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- Rental-truth signals for the Conversion Engine board
-- (invoker + RLS: same posture as the page's direct reads today)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.rental_conversion_signals(p_company_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
select jsonb_build_object(
  'contract_count', (
    select count(*) from public.rental_contracts rc
    where rc.qrm_company_id = p_company_id and rc.deleted_at is null
  ),
  'open_contract_count', (
    select count(*) from public.rental_contracts rc
    where rc.qrm_company_id = p_company_id and rc.deleted_at is null
      and rc.closed_at is null
      and rc.lifecycle_state in ('reserved', 'on_rent', 'off_rent')
  ),
  'trailing_90d_billed_cents', (
    select coalesce(sum(ri.total_cents), 0)
    from public.rental_invoices ri
    join public.rental_contracts rc on rc.id = ri.rental_contract_id
    where rc.qrm_company_id = p_company_id
      and ri.deleted_at is null
      and ri.reversal_of_invoice_id is null
      and ri.period_start >= (current_date - 90)
  ),
  'active_rpo', coalesce((
    select jsonb_agg(jsonb_build_object(
      'contract_id', rc.id,
      'contract_number', rc.contract_number,
      'lifecycle_state', rc.lifecycle_state,
      'accrued_cents', coalesce(rc.rpo_credit_accrued_cents, 0),
      'purchase_price_cents', rc.rpo_purchase_price_cents,
      'exercise_deadline', rc.rpo_exercise_deadline,
      'conversion_deal_id', (
        select d.id from public.qrm_deals d
        where d.rental_contract_id = rc.id and d.deleted_at is null
        limit 1
      )
    ) order by coalesce(rc.rpo_credit_accrued_cents, 0) desc)
    from public.rental_contracts rc
    where rc.qrm_company_id = p_company_id
      and rc.deleted_at is null
      and rc.rpo_eligible = true
  ), '[]'::jsonb)
);
$$;

revoke all on function public.rental_conversion_signals(uuid) from public;
grant execute on function public.rental_conversion_signals(uuid) to authenticated, service_role;

COMMIT;
