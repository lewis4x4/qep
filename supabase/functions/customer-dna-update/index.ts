import { handleCustomerDnaUpdate } from "./handler.ts";

Deno.serve((req) => handleCustomerDnaUpdate(req));
