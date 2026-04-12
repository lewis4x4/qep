import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { FredUsdaMockAdapter } from "./adapters/fred-usda-mock.ts";
import { createIntegrationManager } from "./integration-manager.ts";
import type {
  AdapterResult,
  EconomicObservation,
  FredUsdaRequest,
  FredUsdaResult,
} from "./integration-types.ts";

export const DEFAULT_ECONOMIC_INDICATORS = [
  "HOUST",
  "TTLCONS",
  "PRRESCONS",
  "PNRESCONS",
  "WPUFD4131",
  "USSLIND",
  "DCOILWTICO",
];

interface EconomicIndicatorRow {
  indicator_key: string;
  indicator_name: string;
  value: number;
  unit: string;
  observation_date: string;
  source: string;
  series_id: string;
  metadata: Record<string, unknown>;
}

async function createSyncRun(
  adminClient: SupabaseClient,
  mode: "live" | "mock" | "partial",
  indicators: string[],
  actorUserId: string | null,
): Promise<string | null> {
  const { data } = await adminClient
    .from("economic_sync_runs")
    .insert({
      triggered_by: actorUserId,
      mode,
      indicators,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  return (data?.id as string | undefined) ?? null;
}

async function finishSyncRun(
  adminClient: SupabaseClient,
  runId: string | null,
  params: { rowsUpserted: number; error: string | null; mode: "live" | "mock" | "partial" },
): Promise<void> {
  if (!runId) return;

  await adminClient
    .from("economic_sync_runs")
    .update({
      rows_upserted: params.rowsUpserted,
      error: params.error,
      mode: params.mode,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

export async function runEconomicSyncRefresh(
  adminClient: SupabaseClient,
  params: {
    workspaceId: string;
    indicators: string[];
    actorUserId: string | null;
  },
): Promise<Record<string, unknown>> {
  const indicators = params.indicators.length > 0
    ? params.indicators
    : DEFAULT_ECONOMIC_INDICATORS;
  const manager = createIntegrationManager({ workspaceId: params.workspaceId });
  await manager.loadStatuses();

  const fredStatus = manager.getStatus("fred_usda");
  const liveConfigured = fredStatus?.status === "connected";
  let mode: "live" | "mock" | "partial" = "mock";
  let fallbackReason: string | null = null;
  const runId = await createSyncRun(adminClient, mode, indicators, params.actorUserId);
  let result: AdapterResult<FredUsdaResult>;

  try {
    result = await manager.execute<FredUsdaRequest, FredUsdaResult>("fred_usda", {
      indicators,
    });
    mode = !liveConfigured
      ? (result.isMock ? "mock" : "live")
      : (result.isMock ? "partial" : "live");
  } catch (error) {
    if (!liveConfigured) {
      await finishSyncRun(adminClient, runId, {
        rowsUpserted: 0,
        error: error instanceof Error ? error.message : String(error),
        mode,
      });
      throw error;
    }

    fallbackReason = error instanceof Error ? error.message : String(error);
    result = await new FredUsdaMockAdapter().execute({ indicators }, {});
    mode = "partial";
  }

  const rows: EconomicIndicatorRow[] = result.data.observations.map((
    item: EconomicObservation,
  ) => ({
    indicator_key: item.indicator_key,
    indicator_name: item.indicator_name,
    value: item.value,
    unit: item.unit,
    observation_date: item.observation_date,
    source: result.source,
    series_id: item.series_id,
    metadata: { mode, badge: result.badge },
  }));

  const { error: upsertError } = await adminClient
    .from("economic_indicators")
    .upsert(rows, { onConflict: "indicator_key,observation_date" });

  if (upsertError) {
    await finishSyncRun(adminClient, runId, {
      rowsUpserted: 0,
      error: upsertError.message,
      mode,
    });
    throw upsertError;
  }

  await adminClient
    .from("integration_status")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_records: rows.length,
      last_sync_error: fallbackReason,
    })
    .eq("workspace_id", params.workspaceId)
    .eq("integration_key", "fred_usda");

  await finishSyncRun(adminClient, runId, {
    rowsUpserted: rows.length,
    error: fallbackReason,
    mode,
  });

  return {
    upserted: rows.length,
    as_of: result.data.as_of,
    mode,
    indicators,
  };
}
