import { handlePrepSheet } from "./handler.ts";

Deno.serve((req) => handlePrepSheet(req));
