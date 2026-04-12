import { createAdminClient } from "../_shared/dge-auth.ts";
import { fail, ok, optionsResponse } from "../_shared/dge-http.ts";
import { runNextDgeRefreshJob } from "../_shared/dge-refresh-worker.ts";

const INTERNAL_SECRET = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");

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

  const secret = req.headers.get("x-internal-service-secret");
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return fail({
      origin,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Worker requires the internal service secret.",
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
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
});
