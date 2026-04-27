-- 471_equipment_invoice_view.sql
--
-- Wave 1 held-conflict resolution for
-- docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer_portal_view.equipment_invoice_history.
--
-- Decision: do not create a duplicate equipment_invoices table. Add an
-- explicit customer_invoices.invoice_type discriminator, then expose
-- equipment_invoices as a security-invoker view over rows deliberately marked
-- invoice_type = 'equipment'. Existing rows are not heuristically backfilled.
--
-- Rollback notes:
--   drop view if exists public.equipment_invoices;
--   drop index if exists public.idx_customer_invoices_equipment_type;
--   alter table public.customer_invoices drop constraint if exists customer_invoices_invoice_type_chk;
--   alter table public.customer_invoices drop column if exists invoice_type;

alter table public.customer_invoices
  add column invoice_type text not null default 'general';

alter table public.customer_invoices
  add constraint customer_invoices_invoice_type_chk
  check (invoice_type in ('general', 'equipment', 'parts', 'service', 'rental'));

comment on column public.customer_invoices.invoice_type is
  'Explicit invoice discriminator for IntelliDealer compatibility. Equipment invoices are rows intentionally marked equipment; no fragile deal/parts/service heuristic is applied.';

create index idx_customer_invoices_equipment_type
  on public.customer_invoices (workspace_id, invoice_type, crm_company_id, invoice_date desc)
  where invoice_type = 'equipment';
comment on index public.idx_customer_invoices_equipment_type is
  'Purpose: Account 360 equipment invoice history via the equipment_invoices compatibility view.';

create or replace view public.equipment_invoices
  with (security_invoker = true) as
select
  ci.id,
  ci.workspace_id,
  ci.crm_company_id as company_id,
  ci.portal_customer_id,
  ci.deal_id,
  null::uuid as equipment_id,
  ci.invoice_number as reference_number,
  null::text as make,
  null::text as model,
  round(ci.total * 100)::bigint as invoice_total_cents,
  ci.invoice_date,
  ci.status,
  ci.created_at,
  ci.updated_at
from public.customer_invoices ci
where ci.invoice_type = 'equipment';

comment on view public.equipment_invoices is
  'IntelliDealer equipment invoice compatibility view over customer_invoices where invoice_type = equipment. No standalone equipment invoice table is created.';
comment on column public.equipment_invoices.equipment_id is
  'Reserved for future direct equipment linkage; current customer_invoices rows do not carry a safe equipment FK.';
comment on column public.equipment_invoices.reference_number is
  'Mapped from customer_invoices.invoice_number.';
comment on column public.equipment_invoices.invoice_total_cents is
  'Mapped from customer_invoices.total decimal amount to cents for audit compatibility.';
