import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { refreshCustomerProfileSnapshot } from "../_shared/customer-profile-refresh.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface HealthRefreshBody {
  source?: unknown;
  workspace_id?: unknown;
}

interface HealthProfileRow {
  id: string;
  crm_company_id: string | null;
  health_score: number | null;
  customer_name: string;
  health_score_updated_at: string | null;
}

interface HealthRefreshJobRow {
  job_id: string;
  workspace_id: string;
  snapshot_at: string;
  phase: "scores" | "dna";
  score_cursor_updated_at: string | null;
  score_cursor_id: string | null;
  dna_cursor_id: string | null;
  attempt_count: number;
  failure_count: number;
  lease_token: string;
}

interface HealthJobTransition {
  status: "queued" | "succeeded";
  phase: "scores" | "dna";
  scoreCursorUpdatedAt: string | null;
  scoreCursorId: string | null;
  dnaCursorId: string | null;
  result: Record<string, unknown>;
}

const CRON_JOB_BATCH_SIZE = 2;
const SCORE_SLICE_SIZE = 20;
const DNA_SLICE_SIZE = 5;
const MANUAL_SCORE_LIMIT = 200;
const MANUAL_DNA_LIMIT = 50;
const MANUAL_SCORE_CONCURRENCY = 8;
const MANUAL_DNA_CONCURRENCY = 4;
const HEALTH_JOB_LEASE_SECONDS = 300;

export interface HealthScoreRefreshDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  refreshCustomerProfileSnapshot: typeof refreshCustomerProfileSnapshot;
}

const defaultDependencies: HealthScoreRefreshDependencies = {
  createAdminClient,
  resolveCallerContext,
  refreshCustomerProfileSnapshot,
};

class HealthScoreRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthScoreRefreshError";
  }
}

class HealthJobSliceError extends Error {
  constructor(
    message: string,
    readonly checkpoint: {
      scoreCursorUpdatedAt: string | null;
      scoreCursorId: string | null;
      dnaCursorId: string | null;
    },
  ) {
    super(message);
    this.name = "HealthJobSliceError";
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), values.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

function assertDatabaseResult(
  error: { message?: string } | null,
  operation: string,
): void {
  if (error) {
    throw new HealthScoreRefreshError(
      `${operation}: ${error.message ?? "database request failed"}`,
    );
  }
}

async function readBody(req: Request): Promise<HealthRefreshBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as HealthRefreshBody;
}

export function resolveHealthScoreWorkspaceSelection(params: {
  caller: CallerContext;
  requestedWorkspaceId: string | null;
  isCron: boolean;
}):
  | { ok: true; mode: "single"; workspaceId: string }
  | { ok: true; mode: "service_cron" }
  | { ok: false; status: 400 | 401 | 403; message: string } {
  if (!params.caller.isServiceRole) {
    if (!params.caller.userId || !params.caller.role) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    if (
      params.requestedWorkspaceId &&
      params.requestedWorkspaceId !== params.caller.workspaceId
    ) {
      return {
        ok: false,
        status: 403,
        message: "The requested workspace is not authorized for this caller",
      };
    }
    return {
      ok: true,
      mode: "single",
      workspaceId: params.caller.workspaceId,
    };
  }

  const serviceWorkspace = params.caller.workspaceId ??
    params.requestedWorkspaceId;
  if (
    params.caller.workspaceId && params.requestedWorkspaceId &&
    params.caller.workspaceId !== params.requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }
  if (serviceWorkspace) {
    return { ok: true, mode: "single", workspaceId: serviceWorkspace };
  }
  if (params.isCron) return { ok: true, mode: "service_cron" };
  return {
    ok: false,
    status: 400,
    message:
      "Service callers must provide a workspace unless running the per-workspace cron sweep",
  };
}

export async function discoverServiceWorkspaces(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await admin.rpc(
    "list_health_score_refresh_workspaces",
  );
  assertDatabaseResult(error, "Health refresh workspace inventory failed");
  const workspaces = new Set<string>();
  for (const item of Array.isArray(data) ? data : []) {
    const workspaceId = cleanString(
      typeof item === "string"
        ? item
        : (item as Record<string, unknown>).workspace_id,
    );
    if (workspaceId) workspaces.add(workspaceId);
  }
  return [...workspaces].sort();
}

async function loadWorkspaceHealthProfiles(
  admin: SupabaseClient,
  workspaceId: string,
  order: "score_desc" | "stale_asc",
  limit: number,
): Promise<HealthProfileRow[]> {
  // customer_profiles_extended predates workspace_id. The service-only RPC
  // applies company/contact tenancy in SQL before returning any candidate.
  const { data, error } = await admin.rpc(
    "list_customer_health_profiles_for_workspace",
    {
      p_workspace_id: workspaceId,
      p_order: order,
      p_limit: limit,
    },
  );
  assertDatabaseResult(error, "Workspace health profile identity read failed");
  const profiles: HealthProfileRow[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = cleanString(row.id);
    const companyId = cleanString(row.crm_company_id);
    if (!id) continue;
    profiles.push({
      id,
      crm_company_id: companyId,
      health_score: (row.health_score as number | null) ?? null,
      customer_name: String(row.customer_name ?? "Unknown customer"),
      health_score_updated_at: (row.health_score_updated_at as string | null) ??
        null,
    });
  }
  return profiles;
}

async function loadWorkspaceHealthProfilePage(
  admin: SupabaseClient,
  job: HealthRefreshJobRow,
): Promise<HealthProfileRow[]> {
  const { data, error } = await admin.rpc(
    "list_customer_health_profiles_page",
    {
      p_workspace_id: job.workspace_id,
      p_snapshot_at: job.snapshot_at,
      p_after_updated_at: job.score_cursor_updated_at,
      p_after_id: job.score_cursor_id,
      p_limit: SCORE_SLICE_SIZE + 1,
    },
  );
  assertDatabaseResult(error, "Workspace health profile page read failed");
  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const id = cleanString(row.id);
    if (!id) return [];
    return [{
      id,
      crm_company_id: cleanString(row.crm_company_id),
      health_score: (row.health_score as number | null) ?? null,
      customer_name: String(row.customer_name ?? "Unknown customer"),
      health_score_updated_at: (row.health_score_updated_at as string | null) ??
        null,
    }];
  });
}

async function loadActiveDnaProfileIds(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    snapshotAt: string;
    afterProfileId: string | null;
    limit: number;
  },
): Promise<string[]> {
  const { data, error } = await admin.rpc(
    "list_active_customer_dna_profiles_page",
    {
      p_workspace_id: params.workspaceId,
      p_snapshot_at: params.snapshotAt,
      p_after_id: params.afterProfileId,
      p_limit: params.limit,
    },
  );
  assertDatabaseResult(error, "Workspace active DNA profile page read failed");
  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const id = cleanString(row.id);
    return id ? [id] : [];
  });
}

async function summarizeWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const profiles = (await loadWorkspaceHealthProfiles(
    admin,
    workspaceId,
    "score_desc",
    100,
  ))
    .filter((profile) => profile.health_score !== null)
    .sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0))
    .slice(0, 100);
  const scores = profiles.map((profile) => profile.health_score as number);
  const avg = scores.length > 0
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : 0;
  return {
    workspace_id: workspaceId,
    total_scored: scores.length,
    avg_score: Math.round(avg * 10) / 10,
    distribution: {
      excellent: scores.filter((score) => score >= 80).length,
      good: scores.filter((score) => score >= 60 && score < 80).length,
      fair: scores.filter((score) => score >= 40 && score < 60).length,
      at_risk: scores.filter((score) => score < 40).length,
    },
    top_customers: profiles.slice(0, 10).map((profile) => ({
      health_score: profile.health_score,
      customer_name: profile.customer_name,
    })),
  };
}

async function refreshWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  dependencies: HealthScoreRefreshDependencies,
): Promise<Record<string, unknown>> {
  const profiles = (await loadWorkspaceHealthProfiles(
    admin,
    workspaceId,
    "stale_asc",
    MANUAL_SCORE_LIMIT,
  ))
    .sort((a, b) => {
      if (!a.health_score_updated_at) return -1;
      if (!b.health_score_updated_at) return 1;
      return Date.parse(a.health_score_updated_at) -
        Date.parse(b.health_score_updated_at);
    })
    .slice(0, MANUAL_SCORE_LIMIT);

  const scoreResults = await mapWithConcurrency(
    profiles,
    MANUAL_SCORE_CONCURRENCY,
    async (profile) => {
      const { error } = await admin.rpc("compute_customer_health_score", {
        p_customer_profile_id: profile.id,
      });
      return error ? "failed" : "refreshed";
    },
  );
  const scoresRefreshed =
    scoreResults.filter((value) => value === "refreshed").length;
  const scoresFailed = scoreResults.length - scoresRefreshed;

  const { data: alertCount, error: alertError } = await admin.rpc(
    "generate_cross_department_alerts",
    { p_workspace_id: workspaceId },
  );
  assertDatabaseResult(
    alertError,
    "Workspace cross-department alert generation failed",
  );

  const snapshotAt = new Date().toISOString();
  const activeProfileIds = await loadActiveDnaProfileIds(admin, {
    workspaceId,
    snapshotAt,
    afterProfileId: null,
    limit: MANUAL_DNA_LIMIT,
  });
  const dnaResults = await mapWithConcurrency(
    activeProfileIds,
    MANUAL_DNA_CONCURRENCY,
    async (profileId) => {
      try {
        await dependencies.refreshCustomerProfileSnapshot(admin, {
          lookup: { customer_profiles_extended_id: profileId },
          actorRole: "owner",
          actorUserId: null,
          isServiceRole: true,
          workspaceId,
        });
        return "refreshed";
      } catch {
        return "failed";
      }
    },
  );
  const dnaRefreshed =
    dnaResults.filter((value) => value === "refreshed").length;
  const dnaFailed = dnaResults.length - dnaRefreshed;

  return {
    ok: true,
    workspace_id: workspaceId,
    scores_refreshed: scoresRefreshed,
    scores_failed: scoresFailed,
    alerts_generated: alertCount ?? 0,
    dna_refreshed: dnaRefreshed,
    dna_failed: dnaFailed,
  };
}

async function completeHealthRefreshJob(
  admin: SupabaseClient,
  params: {
    job: HealthRefreshJobRow;
    status: "queued" | "succeeded" | "failed";
    phase: "scores" | "dna";
    scoreCursorUpdatedAt: string | null;
    scoreCursorId: string | null;
    dnaCursorId: string | null;
    error: string | null;
  },
): Promise<void> {
  const { error } = await admin.rpc("complete_health_score_refresh_job", {
    p_job_id: params.job.job_id,
    p_lease_token: params.job.lease_token,
    p_status: params.status,
    p_phase: params.phase,
    p_score_cursor_updated_at: params.scoreCursorUpdatedAt,
    p_score_cursor_id: params.scoreCursorId,
    p_dna_cursor_id: params.dnaCursorId,
    p_last_error: params.error,
  });
  assertDatabaseResult(error, "Health refresh job completion failed");
}

async function processHealthRefreshJobSlice(
  admin: SupabaseClient,
  job: HealthRefreshJobRow,
  dependencies: HealthScoreRefreshDependencies,
): Promise<HealthJobTransition> {
  if (job.phase === "scores") {
    const page = await loadWorkspaceHealthProfilePage(admin, job);
    const profiles = page.slice(0, SCORE_SLICE_SIZE);
    const scoreResults = await Promise.all(profiles.map(async (profile) => {
      const { error } = await admin.rpc("compute_customer_health_score", {
        p_customer_profile_id: profile.id,
      });
      return error ? "failed" : "refreshed";
    }));
    const refreshed = scoreResults.filter((value) => value === "refreshed")
      .length;
    const failed = scoreResults.length - refreshed;
    const last = profiles.at(-1);

    if (failed > 0) {
      throw new HealthJobSliceError(
        `Health score slice has ${failed} transient profile failure${
          failed === 1 ? "" : "s"
        }`,
        {
          scoreCursorUpdatedAt: job.score_cursor_updated_at,
          scoreCursorId: job.score_cursor_id,
          dnaCursorId: job.dna_cursor_id,
        },
      );
    }

    if (page.length > SCORE_SLICE_SIZE && last) {
      return {
        status: "queued",
        phase: "scores",
        scoreCursorUpdatedAt: last.health_score_updated_at,
        scoreCursorId: last.id,
        dnaCursorId: job.dna_cursor_id,
        result: {
          workspace_id: job.workspace_id,
          phase: "scores",
          scores_refreshed: refreshed,
          scores_failed: failed,
          continuation: true,
        },
      };
    }

    const { data: alertCount, error: alertError } = await admin.rpc(
      "generate_cross_department_alerts",
      { p_workspace_id: job.workspace_id },
    );
    assertDatabaseResult(
      alertError,
      "Workspace cross-department alert generation failed",
    );
    return {
      status: "queued",
      phase: "dna",
      scoreCursorUpdatedAt: last?.health_score_updated_at ??
        job.score_cursor_updated_at,
      scoreCursorId: last?.id ?? job.score_cursor_id,
      dnaCursorId: job.dna_cursor_id,
      result: {
        workspace_id: job.workspace_id,
        phase: "scores",
        scores_refreshed: refreshed,
        scores_failed: failed,
        alerts_generated: alertCount ?? 0,
        continuation: true,
      },
    };
  }

  const page = await loadActiveDnaProfileIds(admin, {
    workspaceId: job.workspace_id,
    snapshotAt: job.snapshot_at,
    afterProfileId: job.dna_cursor_id,
    limit: DNA_SLICE_SIZE + 1,
  });
  const profileIds = page.slice(0, DNA_SLICE_SIZE);
  let refreshed = 0;
  let lastProfileId = job.dna_cursor_id;
  for (const profileId of profileIds) {
    try {
      await dependencies.refreshCustomerProfileSnapshot(admin, {
        lookup: { customer_profiles_extended_id: profileId },
        actorRole: "owner",
        actorUserId: null,
        isServiceRole: true,
        workspaceId: job.workspace_id,
      });
      refreshed++;
      lastProfileId = profileId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HealthJobSliceError(
        `Customer DNA slice failed at ${profileId}: ${message}`,
        {
          scoreCursorUpdatedAt: job.score_cursor_updated_at,
          scoreCursorId: job.score_cursor_id,
          dnaCursorId: lastProfileId,
        },
      );
    }
  }
  return {
    status: page.length > DNA_SLICE_SIZE ? "queued" : "succeeded",
    phase: "dna",
    scoreCursorUpdatedAt: job.score_cursor_updated_at,
    scoreCursorId: job.score_cursor_id,
    dnaCursorId: lastProfileId,
    result: {
      workspace_id: job.workspace_id,
      phase: "dna",
      dna_refreshed: refreshed,
      dna_failed: 0,
      continuation: page.length > DNA_SLICE_SIZE,
    },
  };
}

async function runHealthRefreshCronBatch(
  admin: SupabaseClient,
  dependencies: HealthScoreRefreshDependencies,
): Promise<Record<string, unknown>> {
  const { data: enqueued, error: enqueueError } = await admin.rpc(
    "enqueue_health_score_refresh_jobs",
    { p_refresh_on: new Date().toISOString().slice(0, 10) },
  );
  assertDatabaseResult(enqueueError, "Health refresh workspace enqueue failed");

  const { data, error: claimError } = await admin.rpc(
    "claim_health_score_refresh_jobs",
    {
      p_limit: CRON_JOB_BATCH_SIZE,
      p_lease_seconds: HEALTH_JOB_LEASE_SECONDS,
    },
  );
  assertDatabaseResult(claimError, "Health refresh workspace claim failed");
  const jobs = (Array.isArray(data) ? data : []) as HealthRefreshJobRow[];
  // Claimed leases begin at the same instant, so process the small bounded
  // batch concurrently. A later job never waits behind an earlier tenant long
  // enough to consume its lease before work starts.
  const results = await Promise.all(jobs.map(async (job) => {
    try {
      const transition = await processHealthRefreshJobSlice(
        admin,
        job,
        dependencies,
      );
      await completeHealthRefreshJob(admin, {
        job,
        status: transition.status,
        phase: transition.phase,
        scoreCursorUpdatedAt: transition.scoreCursorUpdatedAt,
        scoreCursorId: transition.scoreCursorId,
        dnaCursorId: transition.dnaCursorId,
        error: null,
      });
      return {
        ok: true,
        job_id: job.job_id,
        job_status: transition.status,
        ...transition.result,
      };
    } catch (jobError) {
      const message = jobError instanceof Error
        ? jobError.message
        : String(jobError);
      const terminal = job.failure_count + 1 >= 5;
      const checkpoint = jobError instanceof HealthJobSliceError
        ? jobError.checkpoint
        : {
          scoreCursorUpdatedAt: job.score_cursor_updated_at,
          scoreCursorId: job.score_cursor_id,
          dnaCursorId: job.dna_cursor_id,
        };
      await completeHealthRefreshJob(admin, {
        job,
        status: terminal ? "failed" : "queued",
        phase: job.phase,
        scoreCursorUpdatedAt: checkpoint.scoreCursorUpdatedAt,
        scoreCursorId: checkpoint.scoreCursorId,
        dnaCursorId: checkpoint.dnaCursorId,
        error: message,
      });
      return {
        ok: false,
        job_id: job.job_id,
        workspace_id: job.workspace_id,
        job_status: terminal ? "failed" : "queued",
        error: message,
      };
    }
  }));
  const terminalFailures =
    results.filter((result) => result.job_status === "failed").length;

  return {
    ok: terminalFailures === 0,
    enqueued_workspace_count: typeof enqueued === "number" ? enqueued : 0,
    claimed_workspace_count: jobs.length,
    terminal_failure_count: terminalFailures,
    workspaces: results,
  };
}

export async function handleHealthScoreRefresh(
  req: Request,
  overrides: Partial<HealthScoreRefreshDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "GET" && req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const body = await readBody(req);
    const urlWorkspaceId = cleanString(
      new URL(req.url).searchParams.get("workspace_id"),
    );
    const bodyWorkspaceId = cleanString(body.workspace_id);
    if (
      urlWorkspaceId && bodyWorkspaceId && urlWorkspaceId !== bodyWorkspaceId
    ) {
      return safeJsonError("Conflicting workspace targets", 400, origin);
    }

    const admin = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, admin);
    if (
      !caller.isServiceRole &&
      caller.role !== "manager" && caller.role !== "owner"
    ) {
      if (!caller.userId || !caller.role) {
        return safeJsonError("Unauthorized", 401, origin);
      }
      return safeJsonError(
        "Health score refresh requires manager or owner role",
        403,
        origin,
      );
    }

    const selection = resolveHealthScoreWorkspaceSelection({
      caller,
      requestedWorkspaceId: urlWorkspaceId ?? bodyWorkspaceId,
      isCron: req.method === "POST" && cleanString(body.source) === "cron",
    });
    if (!selection.ok) {
      return safeJsonError(selection.message, selection.status, origin);
    }

    if (selection.mode === "single") {
      const result = req.method === "GET"
        ? await summarizeWorkspace(admin, selection.workspaceId)
        : await refreshWorkspace(
          admin,
          selection.workspaceId,
          dependencies,
        );
      return safeJsonOk(result, origin);
    }

    const result = await runHealthRefreshCronBatch(admin, dependencies);
    return safeJsonOk(result, origin, result.ok === true ? 200 : 500);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(error, { fn: "health-score-refresh", req });
    console.error("health-score-refresh error:", error);
    return safeJsonError("Internal server error", 500, origin);
  }
}
