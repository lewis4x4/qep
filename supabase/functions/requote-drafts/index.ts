/**
 * Requote Drafts Edge Function
 *
 * Moonshot 2 gap closure: One-click requote for quotes affected by
 * price changes. Generates an updated quote snapshot + auto-drafted
 * email for rep review.
 *
 * Routes:
 * GET  /impact — list open quotes with stale pricing sorted by dollar exposure
 * POST /draft — generate requote + email draft for a specific quote
 * POST /batch — bulk-draft requotes for many quotes at once
 *
 * Auth: rep/admin/manager/owner (workspace-scoped via auth.workspaceId)
 */
import { handleRequoteDraftsRequest } from "./handler.ts";

Deno.serve((req) => handleRequoteDraftsRequest(req));
