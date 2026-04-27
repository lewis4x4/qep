-- 468_parts_invoice_lines_customer_invoices.sql
--
-- Wave 1 held-conflict resolution for
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#parts_invoice.qty_ladder.
--
-- Decision: QEP does not have public.parts_invoices. The canonical invoice
-- parent is public.customer_invoices, already used by parts orders and portal
-- payment flows. Create the audit-required parts_invoice_lines detail table
-- against customer_invoices rather than creating a duplicate parts invoice
-- header table.
--
-- Rollback notes:
--   drop trigger if exists set_parts_invoice_lines_updated_at on public.parts_invoice_lines;
--   drop policy if exists "parts_invoice_lines_portal_select" on public.parts_invoice_lines;
--   drop policy if exists "parts_invoice_lines_rep_scope" on public.parts_invoice_lines;
--   drop policy if exists "parts_invoice_lines_all_elevated" on public.parts_invoice_lines;
--   drop policy if exists "parts_invoice_lines_service_all" on public.parts_invoice_lines;
--   drop table if exists public.parts_invoice_lines;
--   alter table public.customer_invoices drop constraint if exists customer_invoices_workspace_id_id_uniq;

alter table public.customer_invoices
  add constraint customer_invoices_workspace_id_id_uniq unique (workspace_id, id);

create table public.parts_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  customer_invoice_id uuid not null,
  sort_order integer not null default 1,
  cash_code text,
  part_catalog_id uuid references public.parts_catalog(id) on delete set null,
  part_number text not null,
  description text,
  bin_location text,
  ofc text,
  qty_ordered integer not null default 0 check (qty_ordered >= 0),
  qty_issued integer not null default 0 check (qty_issued >= 0),
  qty_shipped integer not null default 0 check (qty_shipped >= 0),
  qty_invoiced integer not null default 0 check (qty_invoiced >= 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_pct numeric(5, 2) check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100)),
  tax_applies boolean not null default true,
  extended_price_cents bigint not null check (extended_price_cents >= 0),
  substituted_part_id uuid references public.parts_catalog(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, customer_invoice_id, sort_order),
  constraint parts_invoice_lines_invoice_workspace_fkey
    foreign key (workspace_id, customer_invoice_id)
    references public.customer_invoices(workspace_id, id) on delete cascade
);

comment on table public.parts_invoice_lines is
  'IntelliDealer parts invoice line details for customer_invoices. This intentionally references customer_invoices, not a duplicate parts_invoices header.';
comment on column public.parts_invoice_lines.customer_invoice_id is
  'Canonical QEP invoice header. Reconciles the audit parts_invoices reference to existing customer_invoices.';
comment on column public.parts_invoice_lines.qty_ordered is
  'IntelliDealer quantity ladder: quantity ordered by the customer.';
comment on column public.parts_invoice_lines.qty_issued is
  'IntelliDealer quantity ladder: quantity issued/pulled from bin.';
comment on column public.parts_invoice_lines.qty_shipped is
  'IntelliDealer quantity ladder: quantity shipped to the customer.';
comment on column public.parts_invoice_lines.qty_invoiced is
  'IntelliDealer quantity ladder: quantity invoiced.';

create index idx_parts_invoice_lines_invoice
  on public.parts_invoice_lines (workspace_id, customer_invoice_id, sort_order)
  where deleted_at is null;
comment on index public.idx_parts_invoice_lines_invoice is
  'Purpose: render Parts Invoice Detail line grid from a customer invoice header.';

create index idx_parts_invoice_lines_part
  on public.parts_invoice_lines (workspace_id, part_catalog_id, created_at desc)
  where part_catalog_id is not null and deleted_at is null;
comment on index public.idx_parts_invoice_lines_part is
  'Purpose: recent invoiced-part history and backorder analysis by part.';

alter table public.parts_invoice_lines enable row level security;

create policy "parts_invoice_lines_service_all"
  on public.parts_invoice_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "parts_invoice_lines_all_elevated"
  on public.parts_invoice_lines for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "parts_invoice_lines_rep_scope"
  on public.parts_invoice_lines for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.customer_invoices ci
      where ci.id = customer_invoice_id
        and ci.workspace_id = workspace_id
        and (
          ci.crm_company_id is null
          or public.crm_rep_can_access_company(ci.crm_company_id)
        )
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.customer_invoices ci
      where ci.id = customer_invoice_id
        and ci.workspace_id = workspace_id
        and (
          ci.crm_company_id is null
          or public.crm_rep_can_access_company(ci.crm_company_id)
        )
    )
  );

create policy "parts_invoice_lines_portal_select"
  on public.parts_invoice_lines for select
  using (
    exists (
      select 1
      from public.customer_invoices ci
      where ci.id = customer_invoice_id
        and ci.workspace_id = workspace_id
        and ci.portal_customer_id = public.get_portal_customer_id()
    )
  );

create trigger set_parts_invoice_lines_updated_at
  before update on public.parts_invoice_lines
  for each row execute function public.set_updated_at();
