import { handleNewsMentionScan } from "./handler.ts";

Deno.serve((req) => handleNewsMentionScan(req));
