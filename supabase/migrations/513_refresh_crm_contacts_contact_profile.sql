-- ============================================================================
-- Migration 513: Refresh CRM contact compatibility view for contact profile UI
--
-- The crm_contacts compatibility view was created before later qrm_contacts
-- columns such as cell, direct_phone, birth_date, and sms_opt_in existed.
-- Postgres expands SELECT * at view creation time, so refresh the view before
-- the QRM contact editor reads/writes those safe imported contact fields.
-- ============================================================================

create or replace view public.crm_contacts
  with (security_invoker = true)
  as
  select *
  from public.qrm_contacts;

comment on view public.crm_contacts is
  'DEPRECATED COMPATIBILITY VIEW (mig 170, refreshed mig 513). Reads/writes pass through to qrm_contacts. Includes safe contact profile fields used by the IntelliDealer contact editor.';
