-- 607_native_invoice_rental_signatures.sql
-- Native QEP portal signatures for invoices and rental contracts.

create table if not exists public.customer_invoice_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  signer_name text not null,
  signer_email text,
  signer_ip text,
  signer_user_agent text,
  signature_image_url text not null,
  signed_snapshot jsonb not null,
  signed_via text not null default 'portal' check (signed_via = 'portal'),
  document_hash text not null,
  is_valid boolean not null default true,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.customer_invoice_signatures is
  'Native QEP portal signature proof for customer invoices. Does not imply external VESign envelope status.';

create table if not exists public.rental_contract_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rental_contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  signer_name text not null,
  signer_email text,
  signer_ip text,
  signer_user_agent text,
  signature_image_url text not null,
  signed_snapshot jsonb not null,
  signed_via text not null default 'portal' check (signed_via = 'portal'),
  document_hash text not null,
  is_valid boolean not null default true,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.rental_contract_signatures is
  'Native QEP portal signature proof for rental contract terms. Does not imply external VESign envelope status.';

alter table public.customer_invoices
  add column if not exists native_signature_id uuid references public.customer_invoice_signatures(id) on delete set null;

alter table public.rental_contracts
  add column if not exists native_signature_id uuid references public.rental_contract_signatures(id) on delete set null,
  add column if not exists native_signed_at timestamptz,
  add column if not exists native_signer_name text;

comment on column public.customer_invoices.native_signature_id is
  'Latest valid native QEP portal invoice signature, distinct from provider e-sign compatibility fields.';
comment on column public.rental_contracts.native_signature_id is
  'Latest valid native QEP portal rental signature, distinct from signed_terms_url compatibility evidence.';
comment on column public.rental_contracts.native_signed_at is
  'Timestamp of the latest valid native QEP portal rental signature.';
comment on column public.rental_contracts.native_signer_name is
  'Signer name captured for the latest valid native QEP portal rental signature.';

create unique index if not exists idx_customer_invoice_signatures_one_valid
  on public.customer_invoice_signatures(invoice_id)
  where is_valid = true;
create index if not exists idx_customer_invoice_signatures_workspace
  on public.customer_invoice_signatures(workspace_id, invoice_id, signed_at desc);
create index if not exists idx_customer_invoice_signatures_customer
  on public.customer_invoice_signatures(portal_customer_id, signed_at desc);

create unique index if not exists idx_rental_contract_signatures_one_valid
  on public.rental_contract_signatures(rental_contract_id)
  where is_valid = true;
create index if not exists idx_rental_contract_signatures_workspace
  on public.rental_contract_signatures(workspace_id, rental_contract_id, signed_at desc);
create index if not exists idx_rental_contract_signatures_customer
  on public.rental_contract_signatures(portal_customer_id, signed_at desc);

alter table public.customer_invoice_signatures enable row level security;
alter table public.rental_contract_signatures enable row level security;

create policy "customer_invoice_signatures_internal" on public.customer_invoice_signatures for select
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));
create policy "customer_invoice_signatures_self" on public.customer_invoice_signatures for select
  using (portal_customer_id = public.get_portal_customer_id());
create policy "customer_invoice_signatures_service" on public.customer_invoice_signatures for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "rental_contract_signatures_internal" on public.rental_contract_signatures for select
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));
create policy "rental_contract_signatures_self" on public.rental_contract_signatures for select
  using (portal_customer_id = public.get_portal_customer_id());
create policy "rental_contract_signatures_service" on public.rental_contract_signatures for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
