import { handleOwnerAskAnything } from "./handler.ts";

Deno.serve((req) => handleOwnerAskAnything(req));
