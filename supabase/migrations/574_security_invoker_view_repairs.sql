-- Repair Supabase advisor findings for views that should evaluate caller RLS.
-- View definitions are unchanged; security_invoker makes the caller's rights
-- apply so rows are not exposed via the view owner's privileges through REST.

alter view public.crm_deal_stage_groups set (security_invoker = true);
alter view public.oem_portal_credentials_safe set (security_invoker = true);
alter view public.pdi_average_by_model set (security_invoker = true);

comment on view public.crm_deal_stage_groups is
  '21-stage pipeline collapsed into 5 operator buckets. SECURITY INVOKER so qrm_deal_stages RLS applies to the caller.';

comment on view public.oem_portal_credentials_safe is
  'Operator-safe projection of oem_portal_credentials metadata only. SECURITY INVOKER preserves base-table RLS and avoids ciphertext exposure through owner privileges.';

comment on view public.pdi_average_by_model is
  'Workspace-scoped rolling average PDI cost by make/model for quote prefill. SECURITY INVOKER so pdi_actuals RLS applies to the caller.';
