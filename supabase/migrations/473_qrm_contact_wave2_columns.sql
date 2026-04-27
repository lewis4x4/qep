-- 473_qrm_contact_wave2_columns.sql
-- Wave 2 column extensions for qrm_contacts from Phase-1 and Phase-9.

alter table public.qrm_contacts
  add column if not exists cell text,
  add column if not exists portal_customer_id uuid references public.portal_customers(id) on delete set null,
  add column if not exists direct_phone text,
  add column if not exists birth_date date;

comment on column public.qrm_contacts.cell is 'IntelliDealer Customer Profile contact cell phone and Account 360 click-to-text mobile number.';
comment on column public.qrm_contacts.direct_phone is 'Direct line shown in Account 360 contact tile.';
comment on column public.qrm_contacts.birth_date is 'Used by Account 360 Contacts tile birthday badge.';

create index if not exists idx_qrm_contacts_portal_customer
  on public.qrm_contacts (workspace_id, portal_customer_id)
  where portal_customer_id is not null;
comment on index public.idx_qrm_contacts_portal_customer is 'Purpose: MyDealer/portal customer binding lookup from CRM contact.';
