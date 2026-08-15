/**
 * Portal Notification Refresh Edge Function (Cron or Manual)
 *
 * Scans customer_fleet and crm_equipment to insert portal customer
 * notifications for maintenance due and matching equipment arrivals.
 *
 * Auth: service_role (cron) or manager/owner (manual).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace / body.workspace_id is ignored. Service-role may pass
 * workspace hints or sweep all shops when unscoped.
 */
import { handlePortalNotificationRefresh } from "./handler.ts";

Deno.serve((req) => handlePortalNotificationRefresh(req));
