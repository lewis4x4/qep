import { handleHealthScoreRefresh } from "./handler.ts";

Deno.serve((req) => handleHealthScoreRefresh(req));
