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
import {
  corsHeaders,
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";
import {
  mapMarketValuationRowToResult,
  isStockOnlyValuationRequest,
  validateMarketValuationRequest,
} from "../_shared/market-valuation-logic.ts";
import { findBestMarketValuationSnapshot } from "../_shared/market-valuation-refresh.ts";
import {
  mergeSnapshotBadges,
  resolveRefreshEnvelope,
} from "../_shared/dge-refresh-state.ts";

function rateLimitedMarketValuationResponse(
  origin: string | null,
  retryAfterSeconds: number,
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: { retry_after_seconds: retryAfterSeconds },
      },
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    },
  );
}

Deno.serve(async (req): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for market valuation requests.",
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
      !caller.isServiceRole &&
      caller.role !== "rep" &&
      caller.role !== "admin" &&
      caller.role !== "manager" &&
      caller.role !== "owner"
    ) {
      return fail({
        origin,
        status: 403,
        code: "FORBIDDEN",
        message: "Role is not permitted to access market valuation.",
      });
    }

    const rateLimit = checkRateLimit({
      key: caller.isServiceRole
        ? "market-valuation:service"
        : `market-valuation:${caller.userId}`,
      limit: caller.isServiceRole ? 300 : 30,
    });
    if (!rateLimit.allowed) {
      return rateLimitedMarketValuationResponse(
        origin,
        rateLimit.retryAfterSeconds,
      );
    }

    const payload = await readJsonObject<unknown>(req);
    const request = validateMarketValuationRequest(payload);
    if (!request) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_REQUEST",
        message:
          "Request must include make, model, year, hours, and condition, or a stock_number for cache lookup.",
      });
    }

    const workspaceId = caller.workspaceId ?? "default";
    const snapshot = await findBestMarketValuationSnapshot(adminClient, request);

    if (isStockOnlyValuationRequest(request) && !snapshot) {
      return fail({
        origin,
        status: 400,
        code: "INSUFFICIENT_EQUIPMENT_IDENTITY",
        message:
          "Stock number alone can only return a cached valuation. Provide make, model, year, hours, and condition for a new valuation.",
        details: { stock_number: request.stock_number },
      });
    }

    const identity = [
      request.stock_number ?? "",
      request.make,
      request.model,
      String(request.year),
      String(request.hours),
      request.condition,
      request.location ?? "",
    ].join("|");
    const dedupeKey = buildDgeRefreshDedupeKey(
      "market_valuation_refresh",
      identity,
    );
    let openJob = await findOpenDgeRefreshJob(adminClient, {
      workspaceId,
      dedupeKey,
    });
    const freshSnapshot = snapshot
      ? Date.parse(snapshot.expires_at) > Date.now()
      : false;
    let queueError: string | null = null;

    if (!freshSnapshot && !openJob) {
      try {
        const enqueued = await enqueueDgeRefreshJob(adminClient, {
          workspaceId,
          jobType: "market_valuation_refresh",
          dedupeKey,
          requestPayload: { ...request, requested_by: caller.userId },
          requestedBy: caller.userId,
          priority: 30,
        });
        openJob = {
          id: enqueued.jobId,
          workspace_id: workspaceId,
          job_type: "market_valuation_refresh",
          dedupe_key: dedupeKey,
          status: enqueued.status,
          created_at: new Date().toISOString(),
          last_error: null,
        };
        if (enqueued.enqueued) {
          await triggerDgeRefreshWorker();
        }
      } catch (error) {
        queueError = error instanceof Error ? error.message : String(error);
      }
    }

    const refresh = resolveRefreshEnvelope({
      snapshotUpdatedAt: freshSnapshot
        ? new Date().toISOString()
        : snapshot?.created_at ?? null,
      staleAfterMs: 60_000,
      openJob: openJob
        ? {
          id: openJob.id,
          status: openJob.status,
          created_at: openJob.created_at,
          last_error: openJob.last_error,
        }
        : null,
    });

    if (queueError) {
      refresh.status = "degraded";
      refresh.last_error = queueError;
    } else if (!freshSnapshot && snapshot && !openJob) {
      refresh.status = "stale";
      refresh.stale = true;
    }

    if (snapshot) {
      const response = mapMarketValuationRowToResult(
        snapshot,
        caller.isServiceRole || caller.role !== "rep",
      );
      response.data_badges = mergeSnapshotBadges(response.data_badges, refresh);
      response.refresh = refresh;
      response.valuation_status = freshSnapshot && !openJob
        ? "ready"
        : queueError
        ? "degraded"
        : "pending_refresh";
      return ok(response, { origin });
    }

    if (queueError || !openJob) {
      return fail({
        origin,
        status: 503,
        code: "REFRESH_QUEUE_UNAVAILABLE",
        message: "No cached valuation is available and the refresh queue could not be scheduled.",
        details: { reason: queueError },
      });
    }

    return ok(
      {
        id: `pending:${openJob.id}`,
        estimated_fmv: null,
        low_estimate: null,
        high_estimate: null,
        confidence_score: 0,
        source: "pending_refresh",
        source_breakdown: [],
        data_badges: mergeSnapshotBadges(["ESTIMATED"], refresh),
        expires_at: new Date().toISOString(),
        valuation_status: "pending_refresh",
        refresh,
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
      message: "Unexpected market valuation failure.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
