import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createIntegrationManager } from "./integration-manager.ts";
import type {
  AdapterResult,
  AuctionDataRequest,
  AuctionDataResult,
  IronGuidesRequest,
  IronGuidesResult,
  MarketValuationRequest,
  RouseRequest,
  RouseResult,
} from "./integration-types.ts";
import {
  computeValuationBadges,
  deriveTtlHours,
  isStockOnlyValuationRequest,
  mapMarketValuationRowToResult,
  mergeSourceBreakdown,
  type MarketValuationRow,
  scoreCacheCandidate,
  telemetryFromSettledResults,
} from "./market-valuation-logic.ts";

function resolveCompositeSource(
  telemetry: Array<{ isMock: boolean }>,
): "composite_mock" | "composite_partial" | "composite_live" {
  if (telemetry.every((row) => row.isMock)) return "composite_mock";
  if (telemetry.some((row) => row.isMock)) return "composite_partial";
  return "composite_live";
}

export async function findBestMarketValuationSnapshot(
  adminClient: SupabaseClient,
  request: MarketValuationRequest,
): Promise<MarketValuationRow | null> {
  const nowIso = new Date().toISOString();

  if (isStockOnlyValuationRequest(request) && request.stock_number) {
    const { data } = await adminClient
      .from("market_valuations")
      .select("*")
      .eq("stock_number", request.stock_number)
      .order("created_at", { ascending: false })
      .limit(5);

    const rows = (data ?? []) as MarketValuationRow[];
    return rows
      .map((row) => ({ row, score: scoreCacheCandidate(row, request) }))
      .filter((row) => row.score > 1.5)
      .sort((a, b) => {
        const freshness = Number(Date.parse(b.row.expires_at) > Date.parse(nowIso)) -
          Number(Date.parse(a.row.expires_at) > Date.parse(nowIso));
        return freshness || b.score - a.score;
      })[0]?.row ?? null;
  }

  const { data } = await adminClient
    .from("market_valuations")
    .select("*")
    .eq("make", request.make)
    .eq("model", request.model)
    .eq("year", request.year)
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = (data ?? []) as MarketValuationRow[];
  return rows
    .map((row) => ({ row, score: scoreCacheCandidate(row, request) }))
    .filter((row) => row.score > 1.5)
    .sort((a, b) => {
      const freshness = Number(Date.parse(b.row.expires_at) > Date.parse(nowIso)) -
        Number(Date.parse(a.row.expires_at) > Date.parse(nowIso));
      return freshness || b.score - a.score;
    })[0]?.row ?? null;
}

export async function runMarketValuationRefresh(
  adminClient: SupabaseClient,
  params: {
    workspaceId: string;
    request: MarketValuationRequest;
    actorUserId: string | null;
    includeBreakdown: boolean;
    refreshJobId?: string | null;
  },
): Promise<Record<string, unknown>> {
  const manager = createIntegrationManager({ workspaceId: params.workspaceId });
  await manager.loadStatuses();

  const settled = await Promise.allSettled([
    manager.execute<IronGuidesRequest, IronGuidesResult>("ironguides", {
      make: params.request.make,
      model: params.request.model,
      year: params.request.year,
      hours: params.request.hours,
      zip: params.request.location,
    }),
    manager.execute<AuctionDataRequest, AuctionDataResult>("auction_data", {
      make: params.request.make,
      model: params.request.model,
      yearMin: params.request.year - 2,
      yearMax: params.request.year + 2,
      limit: 8,
    }),
    manager.execute<RouseRequest, RouseResult>("rouse", {
      category: "compact_construction",
      region: params.request.location ?? "us-southeast",
    }),
  ]) as [
    PromiseSettledResult<AdapterResult<IronGuidesResult>>,
    PromiseSettledResult<AdapterResult<AuctionDataResult>>,
    PromiseSettledResult<AdapterResult<RouseResult>>,
  ];

  const telemetry = telemetryFromSettledResults(settled);
  if (telemetry.length === 0) {
    throw new Error("All valuation sources failed.");
  }

  const totalWeight = telemetry.reduce((sum, row) => sum + row.weight, 0);
  const estimatedFmv = telemetry.reduce((sum, row) => sum + row.value * row.weight, 0) /
    totalWeight;
  const confidence = telemetry.reduce((sum, row) => sum + row.confidence * row.weight, 0) /
    totalWeight;
  const explicitLow = telemetry.find((row) => row.lowEstimate !== undefined)?.lowEstimate;
  const explicitHigh = telemetry.find((row) => row.highEstimate !== undefined)?.highEstimate;
  const spread = Math.max(0.08, 0.26 - confidence * 0.12);
  const lowEstimate = explicitLow ?? Math.round(estimatedFmv * (1 - spread));
  const highEstimate = explicitHigh ?? Math.round(estimatedFmv * (1 + spread));
  const sourceBreakdown = mergeSourceBreakdown(telemetry);
  const dataBadges = computeValuationBadges(telemetry);
  const ttlHours = deriveTtlHours(manager.getStatus("ironguides")?.config);
  const source = resolveCompositeSource(telemetry);

  const { data: inserted, error: insertError } = await adminClient
    .from("market_valuations")
    .insert({
      stock_number: params.request.stock_number ?? null,
      make: params.request.make,
      model: params.request.model,
      year: params.request.year,
      hours: params.request.hours,
      condition: params.request.condition,
      location: params.request.location ?? null,
      estimated_fmv: Math.round(estimatedFmv),
      low_estimate: lowEstimate,
      high_estimate: highEstimate,
      confidence_score: Number(confidence.toFixed(2)),
      source,
      source_detail: {
        source_breakdown: sourceBreakdown,
        data_badges: dataBadges,
        refresh_status: "fresh",
        refresh_job_id: params.refreshJobId ?? null,
      },
      expires_at: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
      valued_by: params.actorUserId,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? "Failed to persist valuation record.");
  }

  return mapMarketValuationRowToResult(
    inserted as MarketValuationRow,
    params.includeBreakdown,
  ) as unknown as Record<string, unknown>;
}
