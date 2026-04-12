import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  buildDgeRefreshDedupeKey,
  enqueueDgeRefreshJob,
  findOpenDgeRefreshJob,
  triggerDgeRefreshWorker,
} from "../_shared/dge-refresh-jobs.ts";
import { DEFAULT_ECONOMIC_INDICATORS } from "../_shared/economic-sync-refresh.ts";
import {
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";

interface EconomicSyncBody {
  indicators?: string[];
  force?: boolean;
}

Deno.serve(async (req): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for economic sync requests.",
    });
  }

  const adminClient = createAdminClient();

  try {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.isServiceRole && (!caller.userId || !caller.role)) {
      return fail({
        origin,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Missing or invalid authentication.",
      });
    }

    if (
      !caller.isServiceRole && caller.role !== "manager" &&
      caller.role !== "owner"
    ) {
      return fail({
        origin,
        status: 403,
        code: "FORBIDDEN",
        message: "Only manager/owner roles can trigger economic sync.",
      });
    }

    const rateLimit = checkRateLimit({
      key: caller.isServiceRole
        ? "economic-sync:service"
        : `economic-sync:${caller.userId}`,
      limit: caller.isServiceRole ? 300 : 30,
    });
    if (!rateLimit.allowed) {
      return fail({
        origin,
        status: 429,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: { retry_after_seconds: rateLimit.retryAfterSeconds },
      });
    }

    const body = await readJsonObject<EconomicSyncBody>(req);
    const indicators =
      Array.isArray(body?.indicators) && body.indicators.length > 0
        ? body.indicators.filter((item) =>
          typeof item === "string" && item.trim().length > 0
        )
        : DEFAULT_ECONOMIC_INDICATORS;
    const workspaceId = caller.workspaceId ?? "default";
    const dedupeKey = buildDgeRefreshDedupeKey(
      "economic_sync_refresh",
      indicators.slice().sort().join(","),
    );
    const existingJob = await findOpenDgeRefreshJob(adminClient, {
      workspaceId,
      dedupeKey,
    });

    if (existingJob) {
      return fail({
        origin,
        status: 409,
        code: "SYNC_ALREADY_RUNNING",
        message: "An economic sync refresh is already queued or running.",
        details: { job_id: existingJob.id },
      });
    }

    const enqueued = await enqueueDgeRefreshJob(adminClient, {
      workspaceId,
      jobType: "economic_sync_refresh",
      dedupeKey,
      requestPayload: { indicators, requested_by: caller.userId },
      requestedBy: caller.userId,
      priority: 20,
    });
    if (enqueued.enqueued) {
      await triggerDgeRefreshWorker();
    }

    return ok(
      {
        accepted: true,
        execution_mode: "deferred",
        job_id: enqueued.jobId,
        mode: "deferred",
        indicators,
      },
      { origin },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      });
    }

    return fail({
      origin,
      status: 500,
      code: "UNEXPECTED_ERROR",
      message: "Unexpected economic sync failure.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
