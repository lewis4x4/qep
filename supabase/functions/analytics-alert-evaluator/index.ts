import { handleAnalyticsAlertEvaluator } from "./handler.ts";

Deno.serve((req) => handleAnalyticsAlertEvaluator(req));
