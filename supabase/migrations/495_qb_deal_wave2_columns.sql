-- 495_qb_deal_wave2_columns.sql
-- Wave 2 qb_deals warranty-registration extensions from Phase-2.

alter table public.qb_deals
  add column if not exists warranty_registration_confirmation text,
  add column if not exists warranty_registration_payload jsonb;

comment on column public.qb_deals.warranty_registration_confirmation is 'OEM warranty registration confirmation/reference from Sales Support Portal.';
comment on column public.qb_deals.warranty_registration_payload is 'Raw warranty-registration response payload for audit/retry support.';
