import { handleDataQualityAudit } from "./handler.ts";

Deno.serve((req) => handleDataQualityAudit(req));
