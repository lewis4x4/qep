/**
 * M365 mailbox sync.
 *
 * Reads recent Microsoft Graph inbox messages for connected advisors
 * and feeds them into the existing provider-neutral inbound_email signal path.
 * Zero-blocking: rows with missing/expired/under-scoped tokens are skipped and
 * recorded on mailbox-specific health fields.
 *
 * Auth: service_role (cron) or admin/manager/owner (manual).
 * JWT callers are always bound to profile.active_workspace_id; forged
 * body.workspace / body.workspace_id is ignored. Service-role may pass
 * workspace hints or sweep all shops when unscoped.
 */
import { handleM365MailboxSync } from "./handler.ts";

Deno.serve((req) => handleM365MailboxSync(req));
