import { FredUsdaMockAdapter } from "../_shared/adapters/fred-usda-mock.ts";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";
import { createIntegrationManager } from "../_shared/integration-manager.ts";
import type {
  AdapterResult,
  EconomicObservation,
  FredUsdaRequest,
  FredUsdaResult,
} from "../_shared/integration-types.ts";

interface EconomicSyncBody {
  indicators?: string[];
  force?: boolean;
}

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

const DEFAULT_INDICATORS = [
  "HOUST",
  "TTLCONS",
  "PRRESCONS",
  "PNRESCONS",
  "WPUFD4131",
  "USSLIND",
  "DCOILWTICO",
];

async function startSyncRun(
  adminClient: ReturnType<typeof createAdminClient>,
  mode: "live" | "mock" | "partial",
  indicators: string[],
  actorUserId: string | null,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("economic_sync_runs")
    .insert({
      triggered_by: actorUserId,
      mode,
      indicators,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) return null;
  return data.id as string;
}

async function finishSyncRun(
  adminClient: ReturnType<typeof createAdminClient>,
  runId: string | null,
  params: {
    rowsUpserted: number;
    error: string | null;
    mode: "live" | "mock" | "partial";
  },
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
        : DEFAULT_INDICATORS;

    const manager = createIntegrationManager();
    const workspaceId = manager.getWorkspaceId();
    await manager.loadStatuses();

    const fredStatus = manager.getStatus("fred_usda");
    const liveConfigured = fredStatus?.status === "connected";

    let mode: "live" | "mock" | "partial" = "mock";
    const runId = await startSyncRun(
      adminClient,
      mode,
      indicators,
      caller.userId,
    );

    let fallbackReason: string | null = null;
    let result: AdapterResult<FredUsdaResult>;

    try {
      result = await manager.execute<FredUsdaRequest, FredUsdaResult>(
        "fred_usda",
        {
          indicators,
        },
      );
      if (!liveConfigured) {
        mode = result.isMock ? "mock" : "live";
      } else if (result.isMock) {
        mode = "partial";
      } else {
        mode = "live";
      }
    } catch (error) {
      if (!liveConfigured) {
        await finishSyncRun(adminClient, runId, {
          rowsUpserted: 0,
          error: error instanceof Error ? error.message : String(error),
          mode,
        });
        return fail({
          origin,
          status: 502,
          code: "UPSTREAM_FAILURE",
          message: "Economic sync failed.",
          details: {
            failure_reason: error instanceof Error
              ? error.message
              : String(error),
          },
        });
      }

      fallbackReason = error instanceof Error ? error.message : String(error);
      const fallback = new FredUsdaMockAdapter();
      result = await fallback.execute({ indicators }, {});
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
      metadata: {
        mode,
        badge: result.badge,
      },
    }));

    if (rows.length === 0) {
      await finishSyncRun(adminClient, runId, {
        rowsUpserted: 0,
        error: "No observations returned.",
        mode,
      });
      return fail({
        origin,
        status: 502,
        code: "EMPTY_UPSTREAM_RESULT",
        message: "Economic sync returned no observations.",
      });
    }

    const { error: upsertError } = await adminClient
      .from("economic_indicators")
      .upsert(rows, { onConflict: "indicator_key,observation_date" });

    if (upsertError) {
      await finishSyncRun(adminClient, runId, {
        rowsUpserted: 0,
        error: upsertError.message,
        mode,
      });
      return fail({
        origin,
        status: 500,
        code: "DB_WRITE_FAILED",
        message: "Failed to upsert economic indicators.",
        details: { reason: upsertError.message },
      });
    }

    await adminClient
      .from("integration_status")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_records: rows.length,
        last_sync_error: fallbackReason,
      })
      .eq("workspace_id", workspaceId)
      .eq("integration_key", "fred_usda");

    await finishSyncRun(adminClient, runId, {
      rowsUpserted: rows.length,
      error: fallbackReason,
      mode,
    });

    return ok(
      {
        upserted: rows.length,
        as_of: result.data.as_of,
        mode,
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
