/**
 * Parts predictive failure handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot widen or retarget scope.
 * Chained parts-auto-replenish carries the caller workspace only.
 *
 * Service role: unscoped (all shops) when no workspace hint, or optional
 * x-workspace-id / body.workspace / body.workspace_id for one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";

export interface RequestBody {
  lookahead_days?: number;
  workspace?: string | null;
  workspace_id?: string | null;
  chain_auto_replenish?: boolean;
}

export type PredictiveWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type PredictiveFailureAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0 || internalSecret.length > 0;
}

export function resolvePredictiveFailureWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): PredictiveWorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.authWorkspaceId);
    if (explicit) {
      return { mode: "scoped", workspaceId: explicit };
    }
    return { mode: "unscoped" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  if (!workspaceId) {
    return { mode: "scoped", workspaceId: "" };
  }
  return { mode: "scoped", workspaceId };
}

export function rpcWorkspaceParam(scope: PredictiveWorkspaceScope): string | null {
  return scope.mode === "scoped" ? scope.workspaceId : null;
}

export async function authenticatePredictiveFailure(
  req: Request,
  adminClient: SupabaseClient,
): Promise<PredictiveFailureAuthResult> {
  const caller = await resolveCallerContext(req, adminClient);

  if (caller.isServiceRole) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: caller.workspaceId,
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (!["admin", "manager", "owner"].includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
  };
}

async function readRequestBody(req: Request): Promise<RequestBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as RequestBody;
}

export async function chainAutoReplenish(
  supabaseUrl: string,
  serviceKey: string,
  workspaceScope: PredictiveWorkspaceScope,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const body: Record<string, unknown> = {};

  if (workspaceScope.mode === "scoped" && workspaceScope.workspaceId) {
    body.workspace_id = workspaceScope.workspaceId;
    headers["x-workspace-id"] = workspaceScope.workspaceId;
  }

  const replenishRes = await fetchImpl(
    `${supabaseUrl}/functions/v1/parts-auto-replenish`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  return await replenishRes.json() as Record<string, unknown>;
}

export interface PredictiveFailureHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<PredictiveFailureAuthResult>;
  fetchImpl: typeof fetch;
}

const defaultDependencies: PredictiveFailureHandlerDependencies = {
  createAdminClient: createAdminClient,
  authenticate: authenticatePredictiveFailure,
  fetchImpl: fetch,
};

export async function handlePartsPredictiveFailure(
  req: Request,
  overrides: Partial<PredictiveFailureHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate, fetchImpl } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Missing SUPABASE_URL / SERVICE_ROLE_KEY", 500, origin);
  }

  const adminClient = createClientFn();

  try {
    const auth = await authenticate(req, adminClient);
    if (!auth.ok) {
      const message = auth.status === 401 ? "Unauthorized" : "Forbidden";
      return safeJsonError(message, auth.status, origin);
    }

    const body = await readRequestBody(req);
    const lookahead = body.lookahead_days ?? 90;
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace) ??
      normalizeWorkspaceId(body.workspace_id);

    const workspaceScope = auth.isServiceRole
      ? resolvePredictiveFailureWorkspace({
        isServiceRole: true,
        authWorkspaceId: auth.headerWorkspaceId,
        requestedWorkspaceId,
      })
      : resolvePredictiveFailureWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId,
      });

    if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const pWorkspace = rpcWorkspaceParam(workspaceScope);
    const calledBy = auth.isServiceRole
      ? "cron"
      : `user:${auth.userId}`;

    const { data: predictResult, error: predictErr } = await adminClient
      .rpc("predict_parts_needs", {
        p_workspace: pWorkspace,
        p_lookahead_days: lookahead,
      });

    if (predictErr) {
      return safeJsonError(
        `predict_parts_needs failed: ${predictErr.message}`,
        500,
        origin,
      );
    }

    let replenishResult: Record<string, unknown> | null = null;
    if (body.chain_auto_replenish === true) {
      try {
        replenishResult = await chainAutoReplenish(
          supabaseUrl,
          serviceKey,
          workspaceScope,
          fetchImpl,
        );
      } catch (err) {
        console.warn("auto-replenish chain failed:", (err as Error).message);
        replenishResult = { error: (err as Error).message };
      }
    }

    const { data: summary } = await adminClient
      .rpc("predictive_plays_summary", {
        p_workspace: pWorkspace,
      });

    const elapsedMs = Date.now() - startMs;

    if (auth.isServiceRole) {
      await logServiceCronRun(adminClient, {
        workspaceId: pWorkspace ?? undefined,
        jobName: "parts-predictive-failure",
        ok: true,
        metadata: {
          elapsed_ms: elapsedMs,
          lookahead_days: lookahead,
          workspace_scope: workspaceScope.mode,
          workspace_id: pWorkspace,
          predict_result: predictResult,
          replenish_chained: body.chain_auto_replenish === true,
        },
      });
    }

    return safeJsonOk({
      ok: true,
      called_by: calledBy,
      elapsed_ms: elapsedMs,
      workspace_scope: workspaceScope.mode,
      workspace_id: pWorkspace,
      predict: predictResult,
      replenish: replenishResult,
      summary,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError(err.message, 400, origin);
    }
    throw err;
  }
}
