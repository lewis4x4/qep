/**
 * Recommend-Moves handler — workspace-scoped signal sweep and move inserts.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 *   Body `workspace` / `workspace_id` is ignored so a forged target cannot
 *   widen scope. Missing active workspace fails closed (403).
 * - Service role (cron / internal): sweeps all workspaces when no workspace
 *   hint is provided. Optional `x-workspace-id` header and/or body
 *   `workspace` / `workspace_id` narrows the pass to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  recommendMovesFromSignals,
  type RecommenderSignal,
} from "../_shared/qrm-recommender.ts";
import type { MoveCreatePayload } from "../_shared/qrm-moves.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const LOOKBACK_HOURS = 24;
export const BATCH_LIMIT = 500;

export type RecommendMovesScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

export interface RecommendMovesBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret, x-workspace-id",
    "Vary": "Origin",
  };
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveRecommendMovesScope(params: {
  caller: CallerContext;
  isServiceRole: boolean;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; scope: RecommendMovesScope }
  | { ok: false; status: 403; message: string } {
  if (!params.isServiceRole) {
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    return {
      ok: true,
      scope: { mode: "workspace", workspaceId: params.caller.workspaceId },
    };
  }

  if (params.requestedWorkspaceId) {
    return {
      ok: true,
      scope: { mode: "workspace", workspaceId: params.requestedWorkspaceId },
    };
  }

  return { ok: true, scope: { mode: "all" } };
}

function applyWorkspaceEq<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  scope: RecommendMovesScope,
  column = "workspace_id",
): T {
  if (scope.mode === "workspace") {
    return query.eq(column, scope.workspaceId);
  }
  return query;
}

export function filterCandidatesToScope<
  T extends { workspaceId: string },
>(candidates: T[], scope: RecommendMovesScope): T[] {
  if (scope.mode === "all") return candidates;
  return candidates.filter((candidate) => candidate.workspaceId === scope.workspaceId);
}

async function readBody(req: Request): Promise<RecommendMovesBody> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as RecommendMovesBody;
}

export function toMoveRow(
  workspaceId: string,
  payload: MoveCreatePayload,
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    kind: payload.kind,
    title: payload.title,
    rationale: payload.rationale ?? null,
    confidence: payload.confidence ?? null,
    priority: payload.priority ?? 50,
    entity_type: payload.entityType ?? null,
    entity_id: payload.entityId ?? null,
    assigned_rep_id: payload.assignedRepId ?? null,
    draft: payload.draft ?? null,
    signal_ids: payload.signalIds ?? [],
    due_at: payload.dueAt ?? null,
    recommender: payload.recommender ?? "deterministic",
    recommender_version: payload.recommenderVersion ?? "deterministic-v1",
    payload: payload.payload ?? {},
  };
}

export interface RecommendMovesDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
}

const defaultDependencies: RecommendMovesDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
};

export async function handleRecommendMoves(
  req: Request,
  overrides: Partial<RecommendMovesDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const adminClient = dependencies.createAdminClient();
  const isServiceRole = dependencies.isServiceRoleCaller(req);

  let caller: CallerContext = {
    authHeader: null,
    userId: null,
    role: null,
    isServiceRole: true,
    workspaceId: null,
  };

  if (!isServiceRole) {
    caller = await dependencies.resolveCallerContext(req, adminClient);
    if (!caller.userId || !caller.role) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
    if (!["admin", "manager", "owner"].includes(caller.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const body = await readBody(req);
    const headerWorkspaceId = cleanString(req.headers.get("x-workspace-id"));
    const bodyWorkspaceId = cleanString(body.workspace) ?? cleanString(body.workspace_id);
    const requestedWorkspaceId = isServiceRole
      ? (headerWorkspaceId ?? bodyWorkspaceId)
      : null;

    const scopeSelection = resolveRecommendMovesScope({
      caller,
      isServiceRole,
      requestedWorkspaceId,
    });
    if (!scopeSelection.ok) {
      return new Response(JSON.stringify({ error: scopeSelection.message }), {
        status: scopeSelection.status,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const scope = scopeSelection.scope;
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

    let signalsQuery = adminClient
      .from("signals")
      .select(
        "id, workspace_id, kind, severity, source, title, description, entity_type, entity_id, assigned_rep_id, occurred_at, suppressed_until, payload",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    signalsQuery = applyWorkspaceEq(signalsQuery, scope);

    const { data: rawSignals, error: signalsError } = await signalsQuery;
    if (signalsError) throw signalsError;

    const signals = (rawSignals ?? []) as RecommenderSignal[];
    const candidates = filterCandidatesToScope(
      recommendMovesFromSignals(signals),
      scope,
    );

    let created = 0;
    let skipped = 0;
    const ruleCounts: Record<string, number> = {};

    for (const candidate of candidates) {
      const { workspaceId, sourceSignalId: _srcSignal, ruleId, ...payload } = candidate;

      let dupQuery = adminClient
        .from("moves")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("kind", payload.kind)
        .in("status", ["suggested", "accepted"])
        .limit(1);

      if (payload.entityId) {
        dupQuery = dupQuery.eq("entity_id", payload.entityId);
      } else {
        dupQuery = dupQuery.is("entity_id", null);
      }

      const { data: existing, error: dupError } = await dupQuery;
      if (dupError) throw dupError;

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const insertRow = toMoveRow(workspaceId, payload);
      const { error: insertError } = await adminClient.from("moves").insert(insertRow);
      if (insertError) throw insertError;

      created++;
      ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scope: scope.mode === "workspace"
          ? { mode: "workspace", workspace_id: scope.workspaceId }
          : { mode: "all" },
        signalsScanned: signals.length,
        movesCreated: created,
        movesSkipped: skipped,
        ruleCounts,
      }),
      { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
    console.error("[recommend-moves] error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }
}
