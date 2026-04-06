/**
 * QRM Router Edge Function (Tier 4 rename — Phase 2)
 *
 * Per ownership decision: the product is QRM. This is the new canonical
 * name for what was crm-router. The implementation is identical — this
 * file re-imports the handler from ../crm-router/index.ts so there is
 * exactly one source of truth.
 *
 * The legacy crm-router URL remains deployed and functional for any
 * external caller that has not yet updated. A future cutover migration
 * will remove crm-router after every consumer is on qrm-router.
 *
 * Frontend callers should target /functions/v1/qrm-router going forward.
 * HubSpot webhook config + any other external integrations should be
 * updated at the next maintenance window.
 */
import "../crm-router/index.ts";
