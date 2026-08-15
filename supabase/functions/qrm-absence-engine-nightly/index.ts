import { handleAbsenceEngineNightly } from "./handler.ts";

Deno.serve((req) => handleAbsenceEngineNightly(req));
