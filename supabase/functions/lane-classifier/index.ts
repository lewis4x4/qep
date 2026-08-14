/**
 * lane-classifier — internal decision lane heuristic classifier.
 *
 * Auth: service-role-only (x-internal-service-secret or Bearer service_role
 * key). verify_jwt=false on deploy. See cron-auth.ts.
 */
import { handleLaneClassifier } from "./handler.ts";

Deno.serve((req) => handleLaneClassifier(req));
