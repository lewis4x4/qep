import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { runNextDgeRefreshJob } from "./dge-refresh-worker.ts";

const claimedJob = {
  job_id: "job-1",
  workspace_id: "workspace-1",
  job_type: "economic_sync_refresh",
  dedupe_key: "economic-1",
  request_payload: { indicators: ["CPI"] },
  attempt_count: 1,
  lease_token: "lease-token-1",
  requested_by: "user-1",
};

class RpcClient {
  completionCalls: Array<Record<string, unknown>> = [];
  renewalCalls: Array<Record<string, unknown>> = [];
  claimCalls: Array<Record<string, unknown>> = [];

  constructor(
    private readonly options: {
      job?: Record<string, unknown> | null;
      completionError?: string | null;
      renewalError?: string | null;
    } = {},
  ) {}

  rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_dge_refresh_job") {
      this.claimCalls.push(args);
      const job = this.options.job === undefined
        ? claimedJob
        : this.options.job;
      return Promise.resolve({ data: job ? [job] : [], error: null });
    }
    if (name === "complete_dge_refresh_job") {
      this.completionCalls.push(args);
      return Promise.resolve({
        data: null,
        error: this.options.completionError
          ? { message: this.options.completionError }
          : null,
      });
    }
    if (name === "renew_dge_refresh_job_lease") {
      this.renewalCalls.push(args);
      return Promise.resolve({
        data: null,
        error: this.options.renewalError
          ? { message: this.options.renewalError }
          : null,
      });
    }
    throw new Error(`unexpected RPC ${name}`);
  }
}

Deno.test("DGE refresh worker reports an empty claim without completing a job", async () => {
  const client = new RpcClient({ job: null });
  const result = await runNextDgeRefreshJob(client as never);
  assertEquals(result, { processed: false, reason: "no_jobs_available" });
  assertEquals(client.completionCalls.length, 0);
});

Deno.test("DGE refresh worker rejects a claimed job without lease ownership", async () => {
  const client = new RpcClient({
    job: { ...claimedJob, lease_token: null },
  });
  await assertRejects(
    () => runNextDgeRefreshJob(client as never),
    Error,
    "has no lease token",
  );
  assertEquals(client.completionCalls.length, 0);
});

Deno.test("DGE refresh worker uses authoritative claimed requested_by instead of payload spoofing", async () => {
  const client = new RpcClient({
    job: {
      ...claimedJob,
      requested_by: "trusted-user",
      request_payload: {
        indicators: ["CPI"],
        requested_by: "payload-spoof",
      },
    },
  });
  let actorUserId: string | null | undefined;
  const result = await runNextDgeRefreshJob(client as never, {
    runEconomicSyncRefresh: async (_admin, input) => {
      actorUserId = input.actorUserId;
      return { refreshed: true };
    },
  });
  assertEquals(result.processed, true);
  assertEquals(actorUserId, "trusted-user");
  assertEquals(client.claimCalls[0].p_lease_seconds, 300);
  assertEquals(client.renewalCalls.length, 1);
  assertEquals(client.renewalCalls[0].p_lease_token, "lease-token-1");
  assertEquals(client.completionCalls[0].p_lease_token, "lease-token-1");
});

Deno.test("DGE refresh worker heartbeats while resilient work is still running", async () => {
  const client = new RpcClient();
  await runNextDgeRefreshJob(
    client as never,
    {
      runEconomicSyncRefresh: async () => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return { refreshed: true };
      },
    },
    { heartbeatIntervalMs: 1, leaseSeconds: 300 },
  );
  assertEquals(client.renewalCalls.length >= 2, true);
  assertEquals(
    client.renewalCalls.every((call) =>
      call.p_job_id === "job-1" &&
      call.p_lease_token === "lease-token-1" &&
      call.p_lease_seconds === 300
    ),
    true,
  );
});

Deno.test("DGE refresh worker does not execute terminal completion after lease renewal fails", async () => {
  const client = new RpcClient({ renewalError: "lease store unavailable" });
  const error = await assertRejects(
    () =>
      runNextDgeRefreshJob(client as never, {
        runEconomicSyncRefresh: async () => ({ refreshed: true }),
      }),
    Error,
  );
  assertStringIncludes(error.message, "lease renewal failed");
  assertEquals(client.completionCalls.length, 0);
});

Deno.test("DGE refresh worker fails when successful job completion persistence errors", async () => {
  const client = new RpcClient({ completionError: "completion unavailable" });
  const error = await assertRejects(
    () =>
      runNextDgeRefreshJob(client as never, {
        runEconomicSyncRefresh: async () => ({ refreshed: true }),
      }),
    Error,
  );
  assertStringIncludes(error.message, "completion unavailable");
  // A success-completion storage error is not rewritten as a business failure.
  assertEquals(client.completionCalls.length, 1);
  assertEquals(client.completionCalls[0].p_status, "succeeded");
  assertEquals(client.completionCalls[0].p_lease_token, "lease-token-1");
});

Deno.test("DGE refresh worker durably records a business execution failure", async () => {
  const client = new RpcClient();
  const result = await runNextDgeRefreshJob(client as never, {
    runEconomicSyncRefresh: () => Promise.reject(new Error("upstream failed")),
  });
  assertEquals(result.error, "upstream failed");
  assertEquals(client.completionCalls.length, 1);
  assertEquals(client.completionCalls[0].p_status, "failed");
  assertEquals(client.completionCalls[0].p_lease_token, "lease-token-1");
});

Deno.test("DGE refresh worker fails when failed-job completion persistence also errors", async () => {
  const client = new RpcClient({ completionError: "completion unavailable" });
  const error = await assertRejects(
    () =>
      runNextDgeRefreshJob(client as never, {
        runEconomicSyncRefresh: () =>
          Promise.reject(new Error("upstream failed")),
      }),
    Error,
  );
  assertStringIncludes(error.message, "upstream failed");
  assertStringIncludes(error.message, "completion unavailable");
  assertEquals(client.completionCalls.length, 1);
  assertEquals(client.completionCalls[0].p_status, "failed");
});
