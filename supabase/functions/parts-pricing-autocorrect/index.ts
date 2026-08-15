/**
 * Parts Pricing Autocorrect — Slice P2.5.
 *
 * Auth: service_role (cron) OR admin/manager/owner (manual trigger from UI).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace cannot widen or retarget pricing scope.
 */
import { handlePartsPricingAutocorrect } from "./handler.ts";

Deno.serve((req) => handlePartsPricingAutocorrect(req));
