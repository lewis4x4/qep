/**
 * Post-Sale Parts Playbook — Slice 3.6.
 *
 * Claude Sonnet 4.6 reads sold equipment, machine profiles, and customer
 * context to draft a 30/60/90-day parts maintenance plan.
 *
 * Request body:
 *   { deal_id: uuid, equipment_id: uuid, refresh?: boolean }
 *     — OR —
 *   { batch: true, limit?: integer }   (cron path: process eligible deals)
 *
 * Auth: admin/manager/owner OR rep who owns the deal.
 */
import { handlePostSalePartsPlaybook } from "./handler.ts";

Deno.serve((req) => handlePostSalePartsPlaybook(req));
