/**
 * Handoff Trust Scorer — workspace-scoped nightly/manual scoring.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (manager/owner): always scores the caller's active workspace only.
 *   Body `workspace` / `workspace_id` and header shop claims are ignored.
 *   Missing active workspace fails closed (403) with zero table access.
 * - Service role (cron / internal): unscoped (all shops) when no workspace hint.
 *   Optional `x-workspace-id` header and/or body `workspace` / `workspace_id`
 *   narrows the pass to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import {
  assessDealOutcome,
  buildHandoffEvidence,
  countSubjectActivities,
  findFirstSubjectActivity,
  scoreInfoCompleteness,
  scoreOutcomeAlignment,
  scoreRecipientReadiness,
  type HandoffOutcome,
} from "./scoring.ts";

export const UNSCORED_HANDOFF_LIMIT = 200;
export const SEAM_WORKSPACE_LIST_LIMIT = 1000;

export interface UnscoredHandoff {
  id: string;
  workspace_id: string;
  subject_type: string;
  subject_id: string;
  from_user_id: string;
  to_user_id: string;
  handoff_at: string;
}

export type AdminClient = SupabaseClient;

export type ScorerScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function resolveHandoffTrustScorerScope(params: {
  caller: CallerContext;
  isServiceRole: boolean;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; scope: ScorerScope }
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
  scope: ScorerScope,
  column = "workspace_id",
): T {
  if (scope.mode === "workspace") {
    return query.eq(column, scope.workspaceId);
  }
  return query;
}

async function determineOutcome(
  admin: AdminClient,
  scope: ScorerScope,
  subjectType: string,
  subjectId: string,
  handoffAt: string,
): Promise<HandoffOutcome> {
  const afterCutoff = new Date(
    Date.parse(handoffAt) + 7 * 86_400_000,
  ).toISOString();

  if (subjectType === "deal") {
    let transitionsQuery = admin
      .from("qrm_stage_transitions")
      .select("from_stage_id, to_stage_id, at")
      .eq("deal_id", subjectId)
      .gte("at", handoffAt)
      .lt("at", afterCutoff)
      .order("at", { ascending: true })
      .limit(3);
    transitionsQuery = applyWorkspaceEq(transitionsQuery, scope);

    const { data: transitions } = await transitionsQuery;

    let dealQuery = admin
      .from("crm_deals")
      .select("stage_id, closed_at")
      .eq("id", subjectId);
    dealQuery = applyWorkspaceEq(dealQuery, scope);

    const { data: deal } = await dealQuery.maybeSingle();

    if (deal?.closed_at) {
      const { data: stage } = await admin
        .from("crm_deal_stages")
        .select("is_closed_won, is_closed_lost")
        .eq("id", deal.stage_id)
        .maybeSingle();

      return assessDealOutcome({
        transitionCount: transitions?.length ?? 0,
        isClosedWon: Boolean(stage?.is_closed_won),
        isClosedLost: Boolean(stage?.is_closed_lost),
      });
    }

    return assessDealOutcome({
      transitionCount: transitions?.length ?? 0,
      isClosedWon: false,
      isClosedLost: false,
    });
  }

  return "unknown";
}

async function fetchUnscoredHandoffs(
  admin: AdminClient,
  scope: ScorerScope,
): Promise<UnscoredHandoff[]> {
  let query = admin
    .from("handoff_events")
    .select("id, workspace_id, subject_type, subject_id, from_user_id, to_user_id, handoff_at")
    .is("scored_at", null)
    .order("handoff_at", { ascending: true })
    .limit(UNSCORED_HANDOFF_LIMIT);
  query = applyWorkspaceEq(query, scope);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as UnscoredHandoff[];
}

async function scoreSingleHandoff(
  admin: AdminClient,
  scope: ScorerScope,
  handoff: UnscoredHandoff,
): Promise<void> {
  const handoffTime = Date.parse(handoff.handoff_at);
  const beforeCutoff = new Date(handoffTime - 48 * 3_600_000).toISOString();
  const afterCutoff = new Date(handoffTime + 72 * 3_600_000).toISOString();

  let senderQuery = admin
    .from("crm_activities")
    .select("created_at, deal_id, activity_type")
    .eq("created_by", handoff.from_user_id)
    .gte("created_at", beforeCutoff)
    .lt("created_at", handoff.handoff_at);
  senderQuery = applyWorkspaceEq(senderQuery, scope);

  const { data: senderActivities } = await senderQuery;

  const senderCount = countSubjectActivities(
    (senderActivities ?? []) as Array<{
      created_at: string;
      deal_id: string | null;
      activity_type?: string | null;
    }>,
    handoff.subject_id,
  );
  const infoScore = scoreInfoCompleteness(senderCount);

  let recipientQuery = admin
    .from("crm_activities")
    .select("created_at, deal_id, activity_type")
    .eq("created_by", handoff.to_user_id)
    .gte("created_at", handoff.handoff_at)
    .lt("created_at", afterCutoff)
    .order("created_at", { ascending: true });
  recipientQuery = applyWorkspaceEq(recipientQuery, scope);

  const { data: recipientActivities } = await recipientQuery;

  const firstAction = findFirstSubjectActivity(
    (recipientActivities ?? []) as Array<{
      created_at: string;
      deal_id: string | null;
      activity_type?: string | null;
    }>,
    handoff.subject_id,
  );
  const evidence = buildHandoffEvidence({
    senderActivityCount: senderCount,
    firstAction,
    handoffAt: handoff.handoff_at,
  });
  const readinessScore = scoreRecipientReadiness(evidence.hours_to_first_action);

  const outcome = await determineOutcome(
    admin,
    scope,
    handoff.subject_type,
    handoff.subject_id,
    handoff.handoff_at,
  );
  const outcomeScore = scoreOutcomeAlignment(outcome);

  let updateQuery = admin
    .from("handoff_events")
    .update({
      info_completeness: infoScore,
      recipient_readiness: readinessScore,
      outcome_alignment: outcomeScore,
      outcome,
      evidence,
      scored_at: new Date().toISOString(),
    })
    .eq("id", handoff.id);
  updateQuery = applyWorkspaceEq(updateQuery, scope);

  await updateQuery;
}

async function resolveSeamWorkspaces(
  admin: AdminClient,
  scope: ScorerScope,
): Promise<string[]> {
  if (scope.mode === "workspace") {
    return [scope.workspaceId];
  }

  const periodStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: workspaces, error } = await admin
    .from("handoff_events")
    .select("workspace_id")
    .gte("handoff_at", periodStart)
    .limit(SEAM_WORKSPACE_LIST_LIMIT);

  if (error) throw error;

  return [...new Set((workspaces ?? []).map((row) => row.workspace_id as string))];
}

export interface HandoffTrustScorerDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
}

const defaultDependencies: HandoffTrustScorerDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
};

export async function handleHandoffTrustScorer(
  req: Request,
  overrides: Partial<HandoffTrustScorerDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const cronCaller = dependencies.isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!cronCaller && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const admin = dependencies.createAdminClient();
    const isServiceRole = cronCaller ||
      authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    let caller: CallerContext = {
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: null,
    };

    if (!isServiceRole) {
      caller = await dependencies.resolveCallerContext(req, admin);
      if (!caller.role || (caller.role !== "manager" && caller.role !== "owner")) {
        return safeJsonError("Requires manager or owner role", 403, origin);
      }
    }

    const body = await readBody(req);
    const headerWorkspaceId = cleanString(req.headers.get("x-workspace-id"));
    const bodyWorkspaceId = cleanString(body.workspace_id) ?? cleanString(body.workspace);
    const requestedWorkspaceId = isServiceRole
      ? (headerWorkspaceId ?? bodyWorkspaceId)
      : null;

    const scopeSelection = resolveHandoffTrustScorerScope({
      caller,
      isServiceRole,
      requestedWorkspaceId,
    });
    if (!scopeSelection.ok) {
      return safeJsonError(scopeSelection.message, scopeSelection.status, origin);
    }

    const scope = scopeSelection.scope;
    const unscored = await fetchUnscoredHandoffs(admin, scope);

    let scored = 0;
    let errors = 0;

    for (const handoff of unscored) {
      try {
        await scoreSingleHandoff(admin, scope, handoff);
        scored++;
      } catch (scoringErr) {
        console.error(
          `[handoff-trust-scorer] failed to score event ${handoff.id}:`,
          scoringErr,
        );
        errors++;
      }
    }

    const periodEnd = new Date().toISOString();
    const periodStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const uniqueWorkspaces = await resolveSeamWorkspaces(admin, scope);

    for (const workspaceId of uniqueWorkspaces) {
      try {
        await admin.rpc("compute_handoff_seam_scores", {
          p_workspace_id: workspaceId,
          p_period_start: periodStart,
          p_period_end: periodEnd,
        });
      } catch (rollupErr) {
        console.error(
          `[handoff-trust-scorer] seam score computation failed for workspace ${workspaceId}:`,
          rollupErr,
        );
      }
    }

    return safeJsonOk({
      ok: true,
      scope: scope.mode === "workspace"
        ? { mode: "workspace", workspace_id: scope.workspaceId }
        : { mode: "all" },
      scored,
      errors,
      workspaces_updated: uniqueWorkspaces.length,
      period_start: periodStart,
      period_end: periodEnd,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(err, { fn: "handoff-trust-scorer", req });
    console.error("[handoff-trust-scorer] error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
}
