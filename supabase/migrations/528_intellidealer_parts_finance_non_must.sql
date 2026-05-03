-- 528_intellidealer_parts_finance_non_must.sql
--
-- Non-must IntelliDealer gap cleanup for Worker C:
-- - Reconcile shipping-label runs to the canonical parts invoice header
--   (public.customer_invoices), without creating public.parts_invoices.
-- - Add billing queue purge support for Phase-8 housekeeping.
--
-- Rollback notes:
--   select cron.unschedule('billing-queue-purge');
--   drop function if exists public.purge_billing_queue(interval);
--   drop index if exists public.idx_shipping_label_runs_customer_invoice;
--   alter table public.shipping_label_runs drop column if exists customer_invoice_id;

alter table public.shipping_label_runs
  add column if not exists customer_invoice_id uuid references public.customer_invoices(id) on delete set null;

comment on column public.shipping_label_runs.customer_invoice_id is
  'Canonical QEP parts invoice header for UPS/label runs. Reconciles prior held parts_invoice_id references to customer_invoices.';

create index if not exists idx_shipping_label_runs_customer_invoice
  on public.shipping_label_runs (workspace_id, customer_invoice_id, ran_at desc)
  where customer_invoice_id is not null;

comment on index public.idx_shipping_label_runs_customer_invoice is
  'Purpose: retrieve shipping label history for canonical customer_invoices parts invoice headers.';

create or replace function public.purge_billing_queue(
  p_older_than interval default interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count integer;
begin
  delete from public.billing_queue
  where status in ('completed', 'failed')
    and submitted_at < now() - p_older_than;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

comment on function public.purge_billing_queue(interval) is
  'Purges completed/failed real-time billing queue rows older than the supplied interval; used by the weekly billing-queue-purge cron job.';

revoke execute on function public.purge_billing_queue(interval) from public;
grant execute on function public.purge_billing_queue(interval) to service_role;

do $$
begin
  if exists (
    select 1
    from pg_namespace
    where nspname = 'cron'
  ) then
    if exists (
      select 1
      from cron.job
      where jobname = 'billing-queue-purge'
    ) then
      perform cron.unschedule('billing-queue-purge');
    end if;

    perform cron.schedule(
      'billing-queue-purge',
      '0 2 * * 0',
      $sql$
        select public.purge_billing_queue(interval '30 days');
      $sql$
    );
  else
    raise notice 'Skipping billing-queue-purge cron job because pg_cron is not available in this environment.';
  end if;
end;
$$;
