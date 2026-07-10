import { createAdminClient } from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { fail, ok, optionsResponse } from "../_shared/dge-http.ts";
import { runNextDgeRefreshJob } from "../_shared/dge-refresh-worker.ts";

Deno.serve(async (req): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for DGE refresh worker invocations.",
    });
  }

  if (!isServiceRoleCaller(req)) {
    return fail({
      origin,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Worker requires valid service credentials.",
    });
  }

  try {
    const result = await runNextDgeRefreshJob(createAdminClient());
    return ok(result, { origin });
  } catch (error) {
    return fail({
      origin,
      status: 500,
      code: "WORKER_FAILED",
      message: "DGE refresh worker execution failed.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
