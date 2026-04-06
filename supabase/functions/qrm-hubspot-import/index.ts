/**
 * QRM HubSpot Import Edge Function (Tier 4 rename — Phase 2)
 *
 * New canonical name for crm-hubspot-import. Re-imports the same handler
 * so there's one source of truth. The legacy crm-hubspot-import URL
 * remains live for HubSpot's webhook config until that's updated.
 */
import "../crm-hubspot-import/index.ts";
