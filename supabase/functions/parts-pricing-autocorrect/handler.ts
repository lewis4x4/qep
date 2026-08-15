/**
 * Parts Pricing Autocorrect handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace cannot widen or retarget pricing generate/apply/summary.
 * RPCs rely on get_my_workspace() via the caller JWT client — never service-role.
 *
 * Service role: unscoped (all shops) when no workspace hint, or optional
 * x-workspace-id / body.workspace for one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  createCallerClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { logServiceCronRun } from "../_shared/service-cron-run.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

export interface RequestBody {
  rule_id?: string | null;
  workspace?: string | null;
  apply_auto_rules?: boolean;
}

export type PricingAutocorrectWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type PricingAutocorrectAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
    authHeader: string;
  };

export function normalizeWorkspaceId(value: unknown): string | null {
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

export function resolvePricingAutocorrectWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): PricingAutocorrectWorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.headerWorkspaceId);
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

export function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: PricingAutocorrectWorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

export async function authenticatePricingAutocorrect(
  req: Request,
  adminClient: SupabaseClient,
): Promise<PricingAutocorrectAuthResult> {
  if (isServiceRoleCaller(req)) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: normalizeWorkspaceId(req.headers.get("x-workspace-id")),
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  const caller = await resolveCallerContext(req, adminClient);

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (!["admin", "manager", "owner"].includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  if (!caller.authHeader) {
    return { ok: false, status: 401 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
    authHeader: caller.authHeader,
  };
}

export async function verifyRuleInWorkspace(
  adminClient: SupabaseClient,
  ruleId: string,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; message: string }> {
  const { data, error } = await adminClient
    .from("parts_pricing_rules")
    .select("id, workspace_id")
    .eq("id", ruleId)
    .maybeSingle<{ id: string; workspace_id: string }>();

  if (error) {
    return {
      ok: false,
      status: 404,
      message: "pricing rule not found",
    };
  }

  if (!data) {
    return {
      ok: false,
      status: 404,
      message: "pricing rule not found",
    };
  }

  if (data.workspace_id !== workspaceId) {
    return {
      ok: false,
      status: 403,
      message: "pricing rule belongs to another workspace",
    };
  }

  return { ok: true };
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

export interface PricingAutocorrectHandlerDependencies {
  createAdminClient: typeof createAdminClient;
  createCallerClient: typeof createCallerClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<PricingAutocorrectAuthResult>;
  logServiceCronRun: typeof logServiceCronRun;
}

const defaultDependencies: PricingAutocorrectHandlerDependencies = {
  createAdminClient,
  createCallerClient,
  authenticate: authenticatePricingAutocorrect,
  logServiceCronRun,
};

export async function handlePartsPricingAutocorrect(
  req: Request,
  overrides: Partial<PricingAutocorrectHandlerDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const adminClient = dependencies.createAdminClient();
    const auth = await dependencies.authenticate(req, adminClient);
    if (!auth.ok) {
      const message = auth.status === 401 ? "Unauthorized" : "Forbidden";
      return safeJsonError(message, auth.status, origin);
    }

    const body = await readRequestBody(req);
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace);

    const workspaceScope = auth.isServiceRole
      ? resolvePricingAutocorrectWorkspace({
        isServiceRole: true,
        authWorkspaceId: null,
        requestedWorkspaceId,
        headerWorkspaceId: auth.headerWorkspaceId,
      })
      : resolvePricingAutocorrectWorkspace({
        isServiceRole: false,
        authWorkspaceId: auth.workspaceId,
        requestedWorkspaceId,
      });

    if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const calledBy = auth.isServiceRole
      ? "cron"
      : `user:${auth.userId}`;

    const ruleId = normalizeWorkspaceId(body.rule_id);
    if (ruleId && workspaceScope.mode === "scoped") {
      const ruleCheck = await verifyRuleInWorkspace(
        adminClient,
        ruleId,
        workspaceScope.workspaceId,
      );
      if (!ruleCheck.ok) {
        return safeJsonError(ruleCheck.message, ruleCheck.status, origin);
      }
    }

    const rpcClient = auth.isServiceRole
      ? adminClient
      : dependencies.createCallerClient(auth.authHeader);

    const { data: genResult, error: genErr } = await rpcClient
      .rpc("pricing_suggestions_generate", { p_rule_id: ruleId });

    if (genErr) {
      return safeJsonError(
        `pricing_suggestions_generate failed: ${genErr.message}`,
        500,
        origin,
      );
    }

    let autoAppliedCount = 0;
    if (body.apply_auto_rules === true) {
      let suggestionsQuery = adminClient
        .from("parts_pricing_suggestions")
        .select("id, rule_id, parts_pricing_rules!inner(auto_apply)")
        .eq("status", "pending")
        .eq("parts_pricing_rules.auto_apply", true);

      suggestionsQuery = applyWorkspaceFilter(suggestionsQuery, workspaceScope);

      const { data: autoSuggestions } = await suggestionsQuery;
      const autoIds = (autoSuggestions ?? []).map((s: { id: string }) => s.id);

      if (autoIds.length > 0) {
        const { data: applyResult, error: applyErr } = await rpcClient
          .rpc("pricing_suggestions_apply", {
            p_suggestion_ids: autoIds,
            p_note: `auto-applied via parts-pricing-autocorrect (${calledBy})`,
          });

        if (applyErr) {
          console.warn("auto-apply failed:", applyErr.message);
        } else {
          autoAppliedCount =
            (applyResult as { applied_count?: number })?.applied_count ?? 0;
        }
      }
    }

    const { data: summary } = await rpcClient.rpc("pricing_rules_summary");

    const elapsedMs = Date.now() - startMs;

    if (auth.isServiceRole) {
      await dependencies.logServiceCronRun(adminClient, {
        jobName: "parts-pricing-autocorrect",
        ok: true,
        metadata: {
          elapsed_ms: elapsedMs,
          gen_result: genResult,
          auto_applied: autoAppliedCount,
          workspace_scope: workspaceScope.mode,
          workspace_id: workspaceScope.mode === "scoped"
            ? workspaceScope.workspaceId
            : null,
        },
      });
    }

    return safeJsonOk({
      ok: true,
      called_by: calledBy,
      elapsed_ms: elapsedMs,
      workspace_scope: workspaceScope.mode,
      workspace_id: workspaceScope.mode === "scoped"
        ? workspaceScope.workspaceId
        : null,
      generate: genResult,
      auto_applied_count: autoAppliedCount,
      summary,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(err, { fn: "parts-pricing-autocorrect" });
    return safeJsonError((err as Error).message, 500, origin);
  }
}
