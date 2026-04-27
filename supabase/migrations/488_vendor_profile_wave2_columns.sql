-- 488_vendor_profile_wave2_columns.sql
-- Wave 2 vendor/AP extensions from Phase-8.

alter table public.vendor_profiles
  add column if not exists vendor_number text,
  add column if not exists is_1099_reportable boolean default false,
  add column if not exists form_1099_type text,
  add column if not exists form_1099_box text,
  add column if not exists tin text,
  add column if not exists tin_type text,
  add column if not exists w9_received_at date,
  add column if not exists w9_document_url text,
  add column if not exists backup_withholding boolean default false,
  add column if not exists payment_terms_id uuid references public.payment_terms(id) on delete set null,
  add column if not exists payment_terms_code text;

comment on column public.vendor_profiles.vendor_number is 'IntelliDealer/AP vendor number, unique per workspace when present.';
comment on column public.vendor_profiles.tin is 'Vendor Tax Identification Number (EIN/SSN). Sensitive PII protected by column-level grants.';
comment on column public.vendor_profiles.payment_terms_id is 'Default AP payment terms from Wave 1 payment_terms.';

-- Existing vendor_profiles RLS allows workspace-wide SELECT. Remove broad
-- table-level reads and grant back only non-sensitive columns so authenticated
-- clients cannot read raw TIN/W-9 values directly from the base table.
revoke select on table public.vendor_profiles from anon, authenticated;
grant select (
  id,
  workspace_id,
  name,
  supplier_type,
  category_support,
  avg_lead_time_hours,
  responsiveness_score,
  after_hours_contact,
  machine_down_escalation_path,
  notes,
  created_at,
  updated_at,
  vendor_number,
  is_1099_reportable,
  form_1099_type,
  form_1099_box,
  w9_received_at,
  backup_withholding,
  payment_terms_id,
  payment_terms_code
) on table public.vendor_profiles to authenticated;
grant select (tin, tin_type, w9_document_url)
  on table public.vendor_profiles to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_profiles_1099_type_chk') then
    alter table public.vendor_profiles
      add constraint vendor_profiles_1099_type_chk
      check (form_1099_type is null or form_1099_type in ('1099-NEC','1099-MISC','1099-INT','1099-DIV','1099-K','1099-R')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendor_profiles_tin_type_chk') then
    alter table public.vendor_profiles
      add constraint vendor_profiles_tin_type_chk
      check (tin_type is null or tin_type in ('EIN','SSN','ITIN','Other')) not valid;
  end if;
end $$;

create unique index if not exists idx_vendor_profiles_workspace_number
  on public.vendor_profiles (workspace_id, vendor_number)
  where vendor_number is not null;
comment on index public.idx_vendor_profiles_workspace_number is 'Purpose: AP vendor-number lookup and uniqueness during 1099/payment imports.';

create index if not exists idx_vendor_profiles_1099
  on public.vendor_profiles (workspace_id, is_1099_reportable)
  where is_1099_reportable;
comment on index public.idx_vendor_profiles_1099 is 'Purpose: 1099 vendor reporting worklist.';
