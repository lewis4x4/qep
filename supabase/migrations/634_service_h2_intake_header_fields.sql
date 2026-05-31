-- ============================================================================
-- Migration 634: H2 work-order intake header hardening
--
-- Uses enum values added in 633 only indirectly through existing enum-typed
-- service_jobs columns. Adds nullable header columns so existing work orders do
-- not break; the service intake/router layer enforces H2 completeness for new
-- jobs.
-- ============================================================================

alter table public.service_jobs
  add column if not exists hour_meter_reading numeric(12, 1),
  add column if not exists odometer_miles numeric(12, 1),
  add column if not exists machine_make text,
  add column if not exists machine_model text,
  add column if not exists machine_serial_number text,
  add column if not exists machine_year integer,
  add column if not exists complaint text,
  add column if not exists cause text,
  add column if not exists correction text,
  add column if not exists field_site_location text,
  add column if not exists field_site_contact_name text,
  add column if not exists field_site_contact_phone text,
  add column if not exists field_site_conditions_access_notes text;

comment on column public.service_jobs.hour_meter_reading is
  'H2 required intake hour-meter reading captured on the work-order header. Nullable for legacy rows; required by service intake/router for new rows.';
comment on column public.service_jobs.odometer_miles is
  'H2 intake miles/odometer reading. Required by service intake/router when the machine is identified as a grapple truck; optional otherwise.';
comment on column public.service_jobs.machine_make is
  'H2 intake machine make snapshot copied from crm_equipment when the work order is created.';
comment on column public.service_jobs.machine_model is
  'H2 intake machine model snapshot copied from crm_equipment when the work order is created.';
comment on column public.service_jobs.machine_serial_number is
  'H2 intake machine serial-number snapshot copied from crm_equipment when the work order is created.';
comment on column public.service_jobs.machine_year is
  'H2 intake machine year snapshot copied from crm_equipment when the work order is created.';
comment on column public.service_jobs.complaint is
  'H2 Three-Cs header: customer complaint/problem statement captured before a work order can be created.';
comment on column public.service_jobs.cause is
  'H2 Three-Cs header: initial cause/known cause captured before a work order can be created.';
comment on column public.service_jobs.correction is
  'H2 Three-Cs header: planned/requested correction captured before a work order can be created.';
comment on column public.service_jobs.field_site_location is
  'H2 road-job header: field service site location required when shop_or_field = field.';
comment on column public.service_jobs.field_site_contact_name is
  'H2 road-job header: field service site contact name required when shop_or_field = field.';
comment on column public.service_jobs.field_site_contact_phone is
  'H2 road-job header: field service site contact phone required when shop_or_field = field.';
comment on column public.service_jobs.field_site_conditions_access_notes is
  'H2 road-job header: site conditions and access notes required when shop_or_field = field.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_jobs_hour_meter_nonnegative_chk') then
    alter table public.service_jobs
      add constraint service_jobs_hour_meter_nonnegative_chk
      check (hour_meter_reading is null or hour_meter_reading >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_odometer_miles_nonnegative_chk') then
    alter table public.service_jobs
      add constraint service_jobs_odometer_miles_nonnegative_chk
      check (odometer_miles is null or odometer_miles >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_machine_year_range_chk') then
    alter table public.service_jobs
      add constraint service_jobs_machine_year_range_chk
      check (machine_year is null or (machine_year >= 1900 and machine_year <= 2100)) not valid;
  end if;
end $$;

create index if not exists idx_service_jobs_promised_at_open
  on public.service_jobs(workspace_id, promised_at)
  where closed_at is null and deleted_at is null and promised_at is not null;
comment on index public.idx_service_jobs_promised_at_open is
  'Supports H2 promised-date queue and overdue intake checks for open service work orders.';

create index if not exists idx_service_jobs_request_type_open
  on public.service_jobs(workspace_id, request_type)
  where closed_at is null and deleted_at is null;
comment on index public.idx_service_jobs_request_type_open is
  'Supports H2 seven-type work-order filtering for open service jobs.';
