/**
 * auto-triage-pipeline — internal decision draft builder.
 *
 * Auth: service-role-only (x-internal-service-secret or Bearer service_role
 * key). verify_jwt=false on deploy. See cron-auth.ts.
 */
import { handleAutoTriagePipeline } from "./handler.ts";

Deno.serve((req) => handleAutoTriagePipeline(req));
