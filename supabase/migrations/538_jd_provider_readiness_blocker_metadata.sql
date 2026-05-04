-- Migration 538: JD provider readiness blocker metadata
--
-- JAR-104 provider-neutral closeout hardening. This does not create JD Quote II,
-- JD PO, or JD Proactive Jobs contracts/adapters/fixtures; it records the exact
-- workbook rows and stop conditions on the existing readiness-only registry row
-- so generic quote/PO/provider evidence cannot be mistaken for BUILT parity.

do $$
declare
  updated_count integer;
begin
  update public.integration_status
  set
    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'decision_packet', 'docs/IntelliDealer/_Manifests/QEP_JD_PROVIDER_DECISION_PACKET_2026-05-04.md',
      'linear_issue', 'JAR-104',
      'workbook_status_target_until_decision', 'GAP',
      'governed_workbook_rows', jsonb_build_array(
        'Field Parity Matrix: Phase-1_CRM / Prospect Board / JDQuote is selected in this',
        'Action & Button Parity: Phase-1_CRM / Prospect Board / John Deere Quote Upload',
        'Action & Button Parity: Phase-2_Sales-Intelligence / Equipment Invoicing / Access JD POs',
        'Action & Button Parity: Phase-2_Sales-Intelligence / Equipment Invoicing / JD Proactive Jobs'
      ),
      'jd_closure_paths_required', jsonb_build_array(
        'live_provider_scope_with_contracts_and_fixtures',
        'source_controlled_de_scope_or_replacement_decision'
      ),
      'live_scope_blockers', jsonb_build_array(
        'jd_affiliated_dealer_scope',
        'jd_quote_ii_license_api_sso_xml_pdf_contract',
        'sandbox_credentials_or_authorized_fixture_exports',
        'jd_quote_ii_and_po_authorization_model',
        'jd_proactive_jobs_behavior_decision',
        'payload_retention_retry_audit_owner_approval'
      ),
      'provider_neutral_guardrails', jsonb_build_array(
        'do_not_mark_built_from_generic_quote_packages',
        'do_not_mark_built_from_generic_vendor_purchase_orders',
        'do_not_mark_built_from_integrationhub_readiness_rows',
        'do_not_mark_built_from_mock_provider_descriptions',
        'do_not_store_hardcoded_credentials'
      ),
      'access_jd_pos_authorization_required', true,
      'proactive_jobs_decision_required', true
    ),
    updated_at = now()
  where integration_key = 'jd_quote_ii';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'JAR-104 JD readiness metadata expected existing jd_quote_ii integration_status rows from migration 535';
  end if;
end $$;
