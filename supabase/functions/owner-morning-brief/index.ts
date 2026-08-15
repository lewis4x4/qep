import { handleOwnerMorningBrief } from "./handler.ts";

Deno.serve((req) => handleOwnerMorningBrief(req));
