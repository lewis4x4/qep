-- 482_service_job_wave2_columns.sql
-- Wave 2 column extensions for service_jobs from Phase-4 and Phase-9.

alter table public.service_jobs
  add column if not exists wo_number text,
  add column if not exists po_number text,
  add column if not exists ship_via text,
  add column if not exists machine_down boolean not null default false,
  add column if not exists machine_down_at timestamptz,
  add column if not exists sold_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists ship_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists pricing_group_override text,
  add column if not exists tax_code_parts_1 text,
  add column if not exists tax_code_parts_2 text,
  add column if not exists tax_code_parts_3 text,
  add column if not exists tax_code_parts_4 text,
  add column if not exists tax_code_labor_1 text,
  add column if not exists tax_code_labor_2 text,
  add column if not exists discount_parts text,
  add column if not exists discount_labor text,
  add column if not exists pickup_required boolean not null default false,
  add column if not exists delivery_required boolean not null default false,
  add column if not exists job_jacket_id uuid references public.job_jackets(id) on delete set null;

comment on column public.service_jobs.wo_number is 'IntelliDealer Work Order reference number; tracking_token remains the legacy QEP reference.';
comment on column public.service_jobs.machine_down is 'Machine-down flag from Work Order header.';
comment on column public.service_jobs.sold_to_address_id is 'Sold-to address from Wave 1 qrm_company_ship_to_addresses.';
comment on column public.service_jobs.job_jacket_id is 'Optional Account 360 job-jacket history linkage from Phase-9.';

create unique index if not exists idx_service_jobs_wo_number
  on public.service_jobs (workspace_id, wo_number)
  where wo_number is not null;
comment on index public.idx_service_jobs_wo_number is 'Purpose: Work Order Listing exact WO reference lookup.';

create index if not exists idx_service_jobs_po_number
  on public.service_jobs (workspace_id, po_number)
  where po_number is not null;
comment on index public.idx_service_jobs_po_number is 'Purpose: Work Order Listing customer PO search.';

create index if not exists idx_service_jobs_machine_down
  on public.service_jobs (workspace_id, machine_down_at desc)
  where machine_down;
comment on index public.idx_service_jobs_machine_down is 'Purpose: dispatch and machine-down escalation queue.';

create index if not exists idx_service_jobs_ship_to_address
  on public.service_jobs (workspace_id, ship_to_address_id)
  where ship_to_address_id is not null;
comment on index public.idx_service_jobs_ship_to_address is 'Purpose: service tax/traffic routing by ship-to address.';
