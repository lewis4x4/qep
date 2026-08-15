/**
 * Demo Manager Edge Function
 *
 * Full demo lifecycle: qualification check, approval routing, hour tracking,
 * cost allocation, follow-up scheduling.
 *
 * GET:    ?deal_id=... → list demos for deal
 * POST:   Request a demo (qualification gate applied)
 * PUT:    Update demo status/data (approval, scheduling, completion)
 *
 * Auth: rep/admin/manager/owner (JWT-only; workspace-bound)
 */
import { handleDemoManager } from "./handler.ts";

Deno.serve((req) => handleDemoManager(req));
