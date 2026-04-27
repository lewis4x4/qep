-- 486_job_code_wave2_columns.sql
-- Wave 2 manufacturer code extension for job_codes from Phase-4.

alter table public.job_codes
  add column if not exists manufacturer_code text;

comment on column public.job_codes.manufacturer_code is 'OEM/IntelliDealer job code number used on WO segment details.';

create index if not exists idx_job_codes_manufacturer_code
  on public.job_codes (workspace_id, make, manufacturer_code)
  where manufacturer_code is not null;
comment on index public.idx_job_codes_manufacturer_code is 'Purpose: job-code lookup by make/OEM manufacturer code.';
