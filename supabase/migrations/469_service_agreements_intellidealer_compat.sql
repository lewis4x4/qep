-- 469_service_agreements_intellidealer_compat.sql
--
-- Wave 1 held-conflict resolution for
-- docs/intellidealer-gap-audit/phase-4-service.yaml#service_agreement.agreement_number.
--
-- Decision: public.service_agreements already exists from 349_service_agreements.sql.
-- Do not recreate or rename it. Existing contract_number/starts_on/expires_on/
-- billing_cycle/estimated_contract_value satisfy the audit's agreement_number,
-- effective_date, expiry_date, billing_schedule, and contract value concepts.
-- This migration adds only missing IntelliDealer compatibility fields.
--
-- Rollback notes:
--   drop index if exists public.idx_service_agreements_program;
--   alter table public.service_agreements drop column if exists deleted_at;
--   alter table public.service_agreements drop column if exists escalation_pct;
--   alter table public.service_agreements drop column if exists labor_rate_override_cents;
--   alter table public.service_agreements drop column if exists included_parts_value_cents;
--   alter table public.service_agreements drop column if exists included_hours;
--   alter table public.service_agreements drop column if exists total_contract_value_cents;
--   alter table public.service_agreements drop column if exists billing_schedule;
--   alter table public.service_agreements drop column if exists program_id;

alter table public.service_agreements
  add column program_id uuid references public.service_agreement_programs(id) on delete set null,
  add column billing_schedule text,
  add column total_contract_value_cents bigint check (total_contract_value_cents is null or total_contract_value_cents >= 0),
  add column included_hours numeric(8, 2) check (included_hours is null or included_hours >= 0),
  add column included_parts_value_cents bigint check (included_parts_value_cents is null or included_parts_value_cents >= 0),
  add column labor_rate_override_cents bigint check (labor_rate_override_cents is null or labor_rate_override_cents >= 0),
  add column escalation_pct numeric(5, 2),
  add column deleted_at timestamptz;

comment on column public.service_agreements.contract_number is
  'Existing QEP service agreement identifier; satisfies IntelliDealer agreement_number without adding a divergent duplicate column.';
comment on column public.service_agreements.starts_on is
  'Existing QEP effective/start date; satisfies IntelliDealer effective_date.';
comment on column public.service_agreements.expires_on is
  'Existing QEP expiry date; satisfies IntelliDealer expiry_date and renewal alerts.';
comment on column public.service_agreements.billing_cycle is
  'Existing QEP billing cadence; satisfies IntelliDealer billing_schedule where no freeform schedule detail is needed.';
comment on column public.service_agreements.estimated_contract_value is
  'Existing QEP decimal contract value. total_contract_value_cents is added for IntelliDealer cent-precision imports.';
comment on column public.service_agreements.program_id is
  'Optional FK to the Wave 1 service_agreement_programs catalog; program_name remains for legacy/freeform labels.';
comment on column public.service_agreements.billing_schedule is
  'Freeform IntelliDealer billing schedule detail when billing_cycle is insufficient.';
comment on column public.service_agreements.total_contract_value_cents is
  'IntelliDealer total contract value in cents for lossless accounting imports.';
comment on column public.service_agreements.included_hours is
  'Included labor/PM hours under the service agreement.';
comment on column public.service_agreements.included_parts_value_cents is
  'Included parts allowance in cents under the service agreement.';
comment on column public.service_agreements.labor_rate_override_cents is
  'Agreement-specific labor rate override in cents.';
comment on column public.service_agreements.escalation_pct is
  'Contract escalation percentage for renewal or term pricing.';
comment on column public.service_agreements.deleted_at is
  'Soft-delete marker added for IntelliDealer Wave 1 compatibility.';

create index idx_service_agreements_program
  on public.service_agreements (workspace_id, program_id, status, expires_on)
  where program_id is not null and deleted_at is null;
comment on index public.idx_service_agreements_program is
  'Purpose: Service Agreements page filters and customer portal SAM contract rollups by program.';
