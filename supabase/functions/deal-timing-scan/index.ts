/**
 * Deal Timing Scan Edge Function (Cron or Manual)
 *
 * Moonshot 1: The Deal Timing Engine.
 * Scans fleet intelligence, budget cycles, price increases, seasonal
 * patterns, and trade-in interest to generate proactive timing alerts.
 *
 * Auth: service_role (cron) or manager/owner (manual).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace / body.workspace_id is ignored. Service-role may pass
 * workspace hints or use the documented cron default when unscoped.
 */
import { handleDealTimingScan } from "./handler.ts";

Deno.serve((req) => handleDealTimingScan(req));
