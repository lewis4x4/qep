import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { refreshCustomerProfileSnapshot } from "./customer-profile-refresh.ts";
import { runEconomicSyncRefresh } from "./economic-sync-refresh.ts";
import { runMarketValuationRefresh } from "./market-valuation-refresh.ts";

interface ClaimedJobRow {
  job_id: string;
  workspace_id: string;
  job_type: "customer_profile_refresh" | "market_valuation_refresh" | "economic_sync_refresh";
  dedupe_key: string;
  request_payload: Record<string, unknown>;
  attempt_count: number;
}

export async function runNextDgeRefreshJob(
  adminClient: SupabaseClient,
): Promise<Record<string, unknown>> {
  const { data, error } = await adminClient.rpc("claim_dge_refresh_job", {
    p_lease_seconds: 75,
  });

  if (error) {
    throw new Error(error.message);
  }

  const job = Array.isArray(data) ? data[0] as ClaimedJobRow | undefined : undefined;
  if (!job?.job_id) {
    return { processed: false, reason: "no_jobs_available" };
  }

  try {
    let result: Record<string, unknown>;
    if (job.job_type === "customer_profile_refresh") {
      result = await refreshCustomerProfileSnapshot(adminClient, {
        lookup: job.request_payload,
        actorRole: "owner",
        actorUserId: typeof job.request_payload.requested_by === "string"
          ? job.request_payload.requested_by
          : null,
        isServiceRole: true,
      });
    } else if (job.job_type === "market_valuation_refresh") {
      result = await runMarketValuationRefresh(adminClient, {
        workspaceId: job.workspace_id,
        request: job.request_payload as never,
        actorUserId: typeof job.request_payload.requested_by === "string"
          ? job.request_payload.requested_by
          : null,
        includeBreakdown: true,
        refreshJobId: job.job_id,
      });
    } else {
      result = await runEconomicSyncRefresh(adminClient, {
        workspaceId: job.workspace_id,
        indicators: Array.isArray(job.request_payload.indicators)
          ? job.request_payload.indicators.filter((item): item is string => typeof item === "string")
          : [],
        actorUserId: typeof job.request_payload.requested_by === "string"
          ? job.request_payload.requested_by
          : null,
      });
    }

    await adminClient.rpc("complete_dge_refresh_job", {
      p_job_id: job.job_id,
      p_status: "succeeded",
      p_result_payload: result,
      p_last_error: null,
    });

    return { processed: true, job_id: job.job_id, job_type: job.job_type, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await adminClient.rpc("complete_dge_refresh_job", {
      p_job_id: job.job_id,
      p_status: "failed",
      p_result_payload: { failure_reason: message },
      p_last_error: message,
    });
    return { processed: true, job_id: job.job_id, job_type: job.job_type, error: message };
  }
}
