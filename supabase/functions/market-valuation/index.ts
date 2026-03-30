import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  corsHeaders,
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";
import { createIntegrationManager } from "../_shared/integration-manager.ts";
import type {
  AdapterResult,
  AuctionDataRequest,
  AuctionDataResult,
  IronGuidesRequest,
  IronGuidesResult,
  RouseRequest,
  RouseResult,
} from "../_shared/integration-types.ts";
import {
  computeValuationBadges,
  deriveTtlHours,
  mapMarketValuationRowToResult,
  type MarketValuationRow,
  mergeSourceBreakdown,
  isStockOnlyValuationRequest,
  scoreCacheCandidate,
  telemetryFromSettledResults,
  validateMarketValuationRequest,
} from "../_shared/market-valuation-logic.ts";

function resolveCompositeSource(
  telemetry: Array<{ isMock: boolean }>,
): "composite_mock" | "composite_partial" | "composite_live" {
  if (telemetry.every((row) => row.isMock)) return "composite_mock";
  if (telemetry.some((row) => row.isMock)) return "composite_partial";
  return "composite_live";
}

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

    const nowIso = new Date().toISOString();

    if (isStockOnlyValuationRequest(request)) {
      const { data: stockRows } = await adminClient
        .from("market_valuations")
        .select("*")
        .eq("stock_number", request.stock_number)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(5);

      if (stockRows?.length) {
        const best = (stockRows as MarketValuationRow[])
          .map((row) => ({ row, score: scoreCacheCandidate(row, request) }))
          .sort((a, b) => b.score - a.score)[0];

        if (best && best.score > 1.5) {
          return ok(
            mapMarketValuationRowToResult(
              best.row,
              caller.isServiceRole || caller.role !== "rep",
            ),
            { origin },
          );
        }
      }

      return fail({
        origin,
        status: 400,
        code: "INSUFFICIENT_EQUIPMENT_IDENTITY",
        message:
          "Stock number alone can only return a cached valuation. Provide make, model, year, hours, and condition for a new valuation.",
        details: { stock_number: request.stock_number },
      });
    }

    const { data: cacheRows } = await adminClient
      .from("market_valuations")
      .select("*")
      .eq("make", request.make)
      .eq("model", request.model)
      .eq("year", request.year)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(20);

    if (cacheRows?.length) {
      const best = (cacheRows as MarketValuationRow[])
        .map((row) => ({ row, score: scoreCacheCandidate(row, request) }))
        .sort((a, b) => b.score - a.score)[0];

      if (best && best.score > 1.5) {
        return ok(
          mapMarketValuationRowToResult(
            best.row,
            caller.isServiceRole || caller.role !== "rep",
          ),
          { origin },
        );
      }
    }

    const manager = createIntegrationManager();
    await manager.loadStatuses();

    const settled = await Promise.allSettled([
      manager.execute<IronGuidesRequest, IronGuidesResult>("ironguides", {
        make: request.make,
        model: request.model,
        year: request.year,
        hours: request.hours,
        zip: request.location,
      }),
      manager.execute<AuctionDataRequest, AuctionDataResult>("auction_data", {
        make: request.make,
        model: request.model,
        yearMin: request.year - 2,
        yearMax: request.year + 2,
        limit: 8,
      }),
      manager.execute<RouseRequest, RouseResult>("rouse", {
        category: "compact_construction",
        region: request.location ?? "us-southeast",
      }),
    ]) as [
      PromiseSettledResult<AdapterResult<IronGuidesResult>>,
      PromiseSettledResult<AdapterResult<AuctionDataResult>>,
      PromiseSettledResult<AdapterResult<RouseResult>>,
    ];

    const telemetry = telemetryFromSettledResults(settled);

    if (telemetry.length === 0) {
      return fail({
        origin,
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        message: "All valuation sources failed.",
        details: { failure_reason: "no_source_succeeded" },
      });
    }

    const totalWeight = telemetry.reduce((sum, row) => sum + row.weight, 0);
    const estimatedFmv = telemetry.reduce((sum, row) =>
      sum + row.value * row.weight, 0) / totalWeight;
    const confidence = telemetry.reduce((sum, row) =>
      sum + row.confidence * row.weight, 0) / totalWeight;

    const explicitLow = telemetry.find((row) =>
      row.lowEstimate !== undefined
    )?.lowEstimate;
    const explicitHigh = telemetry.find((row) =>
      row.highEstimate !== undefined
    )?.highEstimate;
    const spread = Math.max(0.08, 0.26 - confidence * 0.12);

    const lowEstimate = explicitLow ?? Math.round(estimatedFmv * (1 - spread));
    const highEstimate = explicitHigh ??
      Math.round(estimatedFmv * (1 + spread));
    const sourceBreakdown = mergeSourceBreakdown(telemetry);
    const dataBadges = computeValuationBadges(telemetry);
    const ttlHours = deriveTtlHours(manager.getStatus("ironguides")?.config);

    const source = resolveCompositeSource(telemetry);

    const { data: inserted, error: insertError } = await adminClient
      .from("market_valuations")
      .insert({
        stock_number: request.stock_number ?? null,
        make: request.make,
        model: request.model,
        year: request.year,
        hours: request.hours,
        condition: request.condition,
        location: request.location ?? null,
        estimated_fmv: Math.round(estimatedFmv),
        low_estimate: lowEstimate,
        high_estimate: highEstimate,
        confidence_score: Number(confidence.toFixed(2)),
        source,
        source_detail: {
          source_breakdown: sourceBreakdown,
          data_badges: dataBadges,
          adapter_telemetry: telemetry.map((row) => ({
            source: row.source,
            badge: row.badge,
            latency_ms: row.latencyMs,
            is_mock: row.isMock,
          })),
        },
        expires_at: new Date(Date.now() + ttlHours * 60 * 60 * 1000)
          .toISOString(),
        valued_by: caller.userId,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      return fail({
        origin,
        status: 500,
        code: "DB_WRITE_FAILED",
        message: "Failed to persist valuation record.",
        details: { reason: insertError?.message },
      });
    }

    return ok(
      mapMarketValuationRowToResult(
        inserted as MarketValuationRow,
        caller.isServiceRole || caller.role !== "rep",
      ),
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
