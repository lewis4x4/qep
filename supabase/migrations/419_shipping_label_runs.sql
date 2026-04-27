-- 419_shipping_label_runs.sql
--
-- Wave 1B: IntelliDealer UPS WorldShip / shipping label run ledger from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#parts_invoice.ups_worldship_import.
-- Current schema conflict: audit references public.parts_invoices(id), but
-- this repo has no parts_invoices table. Preserve parts_invoice_id as a held
-- reconciliation UUID without FK; wire the FK after the parts invoice model is
-- reconciled. This does not implement held parts_invoice_lines.
--
-- Rollback notes:
--   drop trigger if exists set_shipping_label_runs_updated_at on public.shipping_label_runs;
--   drop policy if exists "shipping_label_runs_rep_scope" on public.shipping_label_runs;
--   drop policy if exists "shipping_label_runs_all_elevated" on public.shipping_label_runs;
--   drop policy if exists "shipping_label_runs_service_all" on public.shipping_label_runs;
--   drop table if exists public.shipping_label_runs;

create table public.shipping_label_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  parts_invoice_id uuid,
  carrier text not null,
  tracking_number text,
  label_url text,
  cost_cents bigint,
  ran_by uuid references public.profiles(id) on delete set null default auth.uid(),
  ran_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shipping_label_runs is
  'Ledger of shipping-label generation runs for parts invoice shipments; parts_invoice_id FK is held until invoice reconciliation.';
comment on column public.shipping_label_runs.parts_invoice_id is
  'Held UUID reference to the future/reconciled parts invoice record; no FK because public.parts_invoices is absent in Wave 1B.';

create index idx_shipping_label_runs_invoice
  on public.shipping_label_runs (workspace_id, parts_invoice_id, ran_at desc)
  where parts_invoice_id is not null;
comment on index public.idx_shipping_label_runs_invoice is
  'Purpose: retrieve shipping label history for a parts invoice after invoice-model reconciliation.';

create index idx_shipping_label_runs_tracking
  on public.shipping_label_runs (workspace_id, carrier, tracking_number)
  where tracking_number is not null;
comment on index public.idx_shipping_label_runs_tracking is
  'Purpose: lookup label run by carrier tracking number for counter staff and shipping reconciliation.';

alter table public.shipping_label_runs enable row level security;

create policy "shipping_label_runs_service_all"
  on public.shipping_label_runs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "shipping_label_runs_all_elevated"
  on public.shipping_label_runs for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "shipping_label_runs_rep_scope"
  on public.shipping_label_runs for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_shipping_label_runs_updated_at
  before update on public.shipping_label_runs
  for each row execute function public.set_updated_at();
