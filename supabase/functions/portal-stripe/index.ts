/** Portal Stripe routes authenticate customers/staff and verify signed callbacks in the handler. */
import { handlePortalStripeRequest } from "./handler.ts";
Deno.serve((req) => handlePortalStripeRequest(req));
