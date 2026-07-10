import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { refreshCustomerProfileSnapshot } from "./customer-profile-refresh.ts";
import { runEconomicSyncRefresh } from "./economic-sync-refresh.ts";
import { runMarketValuationRefresh } from "./market-valuation-refresh.ts";

interface ClaimedJobRow {
  job_id: string;
  workspace_id: string;
  job_type:
    | "customer_profile_refresh"
    | "market_valuation_refresh"
    | "economic_sync_refresh";
  dedupe_key: string;
  request_payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
  requested_by: string | null;
}

export interface DgeRefreshWorkerDependencies {
  refreshCustomerProfileSnapshot: typeof refreshCustomerProfileSnapshot;
  runMarketValuationRefresh: typeof runMarketValuationRefresh;
  runEconomicSyncRefresh: typeof runEconomicSyncRefresh;
}

export interface DgeRefreshWorkerOptions {
  heartbeatIntervalMs?: number;
  leaseSeconds?: number;
}

const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

const defaultDependencies: DgeRefreshWorkerDependencies = {
  refreshCustomerProfileSnapshot,
  runMarketValuationRefresh,
  runEconomicSyncRefresh,
};

async function completeRefreshJob(
  adminClient: SupabaseClient,
  params: {
    jobId: string;
    leaseToken: string;
    status: "succeeded" | "failed";
    result: Record<string, unknown>;
    error: string | null;
  },
): Promise<void> {
  const { error } = await adminClient.rpc("complete_dge_refresh_job", {
    p_job_id: params.jobId,
    p_lease_token: params.leaseToken,
    p_status: params.status,
    p_result_payload: params.result,
    p_last_error: params.error,
  });
  if (error) {
    throw new Error(
      `DGE refresh job ${params.jobId} completion failed: ${error.message}`,
    );
  }
}

async function renewRefreshJobLease(
  adminClient: SupabaseClient,
  params: { jobId: string; leaseToken: string; leaseSeconds: number },
): Promise<void> {
  const { error } = await adminClient.rpc("renew_dge_refresh_job_lease", {
    p_job_id: params.jobId,
    p_lease_token: params.leaseToken,
    p_lease_seconds: params.leaseSeconds,
  });
  if (error) {
    throw new Error(
      `DGE refresh job ${params.jobId} lease renewal failed: ${error.message}`,
    );
  }
}

export async function runNextDgeRefreshJob(
  adminClient: SupabaseClient,
  overrides: Partial<DgeRefreshWorkerDependencies> = {},
  options: DgeRefreshWorkerOptions = {},
): Promise<Record<string, unknown>> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const leaseSeconds = Math.min(
    Math.max(options.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 60),
    900,
  );
  const { data, error } = await adminClient.rpc("claim_dge_refresh_job", {
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const job = Array.isArray(data)
    ? data[0] as ClaimedJobRow | undefined
    : undefined;
  if (!job?.job_id) {
    return { processed: false, reason: "no_jobs_available" };
  }
  if (!job.lease_token) {
    throw new Error(`Claimed DGE refresh job ${job.job_id} has no lease token`);
  }
  const requestedBy = typeof job.requested_by === "string"
    ? job.requested_by
    : null;

  let result: Record<string, unknown> | undefined;
  let executionError: unknown;
  let heartbeatError: Error | null = null;
  let heartbeatPromise: Promise<void> | null = null;
  const heartbeatIntervalMs = Math.max(
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    1,
  );
  const heartbeatId = setInterval(() => {
    if (heartbeatPromise || heartbeatError) return;
    heartbeatPromise = renewRefreshJobLease(adminClient, {
      jobId: job.job_id,
      leaseToken: job.lease_token,
      leaseSeconds,
    }).catch((renewalError) => {
      heartbeatError = renewalError instanceof Error
        ? renewalError
        : new Error(String(renewalError));
    }).finally(() => {
      heartbeatPromise = null;
    });
  }, heartbeatIntervalMs);

  try {
    if (job.job_type === "customer_profile_refresh") {
      result = await dependencies.refreshCustomerProfileSnapshot(adminClient, {
        lookup: job.request_payload,
        actorRole: "owner",
        actorUserId: requestedBy,
        isServiceRole: true,
        workspaceId: job.workspace_id,
      });
    } else if (job.job_type === "market_valuation_refresh") {
      result = await dependencies.runMarketValuationRefresh(adminClient, {
        workspaceId: job.workspace_id,
        request: job.request_payload as never,
        actorUserId: requestedBy,
        includeBreakdown: true,
        refreshJobId: job.job_id,
      });
    } else {
      result = await dependencies.runEconomicSyncRefresh(adminClient, {
        workspaceId: job.workspace_id,
        indicators: Array.isArray(job.request_payload.indicators)
          ? job.request_payload.indicators.filter((item): item is string =>
            typeof item === "string"
          )
          : [],
        actorUserId: requestedBy,
      });
    }
  } catch (error) {
    executionError = error;
  } finally {
    clearInterval(heartbeatId);
    const pendingHeartbeat = heartbeatPromise;
    if (pendingHeartbeat) await pendingHeartbeat;
  }

  if (heartbeatError) throw heartbeatError;

  // Extend once more immediately before the terminal write. This closes the
  // race between the last periodic heartbeat and completion, while the
  // database rejects any stale token instead of resurrecting an expired lease.
  await renewRefreshJobLease(adminClient, {
    jobId: job.job_id,
    leaseToken: job.lease_token,
    leaseSeconds,
  });

  if (executionError) {
    const message = executionError instanceof Error
      ? executionError.message
      : String(executionError);
    try {
      await completeRefreshJob(adminClient, {
        jobId: job.job_id,
        leaseToken: job.lease_token,
        status: "failed",
        result: { failure_reason: message },
        error: message,
      });
    } catch (completionError) {
      const completionMessage = completionError instanceof Error
        ? completionError.message
        : String(completionError);
      throw new Error(
        `DGE refresh job ${job.job_id} failed (${message}); ${completionMessage}`,
      );
    }
    return {
      processed: true,
      job_id: job.job_id,
      job_type: job.job_type,
      error: message,
    };
  }

  if (!result) {
    throw new Error(`DGE refresh job ${job.job_id} returned no result`);
  }

  // Completion is intentionally outside the execution catch. If the durable
  // state transition fails, the worker invocation fails instead of pretending
  // the processed job was recorded (or attempting to rewrite it as a business
  // execution failure).
  await completeRefreshJob(adminClient, {
    jobId: job.job_id,
    leaseToken: job.lease_token,
    status: "succeeded",
    result,
    error: null,
  });

  return {
    processed: true,
    job_id: job.job_id,
    job_type: job.job_type,
    result,
  };
}
