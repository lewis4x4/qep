import {
  crmFail,
  crmOk,
  crmOptionsResponse,
  readJsonBody,
  safeText,
} from "../_shared/crm-router-http.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
  type CallerContext,
} from "../_shared/dge-auth.ts";
import { runPlaysEngine, type RunPlaysInput, type RunPlaysResult } from "./service.ts";

export interface RunPlaysService {
  run(input: RunPlaysInput): Promise<RunPlaysResult>;
}

export interface RunRequestDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
}

const defaultRunRequestDependencies: RunRequestDependencies = {
  createAdminClient,
  resolveCallerContext,
};

export function resolveDocumentPlaysRunWorkspace(params: {
  isServiceRole: boolean;
  callerWorkspaceId: string | null;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; workspaceId: string | null }
  | { ok: false; status: 403; code: "FORBIDDEN"; message: string } {
  const callerWorkspaceId = safeText(params.callerWorkspaceId);
  const requestedWorkspaceId = safeText(params.requestedWorkspaceId);

  if (params.isServiceRole) {
    return { ok: true, workspaceId: callerWorkspaceId ?? requestedWorkspaceId };
  }

  if (!callerWorkspaceId) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Caller is not authorized for plays run.",
    };
  }

  // JWT callers are bound to profiles.active_workspace_id; forged body.workspaceId
  // must never steer tenant selection.
  return { ok: true, workspaceId: callerWorkspaceId };
}

export type DocumentWorkspaceAccessResult =
  | { ok: true }
  | { ok: false; status: 404; code: "NOT_FOUND"; message: string };

export async function verifyJwtDocumentWorkspaceAccess(params: {
  admin: SupabaseClient;
  isServiceRole: boolean;
  callerWorkspaceId: string | null;
  documentId: string | null;
}): Promise<DocumentWorkspaceAccessResult> {
  const documentId = safeText(params.documentId);
  if (params.isServiceRole || !documentId) {
    return { ok: true };
  }

  const callerWorkspaceId = safeText(params.callerWorkspaceId);
  const { data, error } = await params.admin
    .from("documents")
    .select("id, workspace_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!data || safeText(data.workspace_id) !== callerWorkspaceId) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "Document not found.",
    };
  }

  return { ok: true };
}

function normalizePath(pathname: string): string {
  if (pathname.startsWith("/document-plays-run")) {
    return pathname.slice("/document-plays-run".length) || "/";
  }
  return pathname;
}

function mapError(origin: string | null, error: unknown): Response {
  if (error instanceof SyntaxError) {
    return crmFail({ origin, status: 400, code: "INVALID_JSON", message: "Request body must be valid JSON." });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "UNAUTHORIZED") {
    return crmFail({ origin, status: 401, code: "UNAUTHORIZED", message: "Missing or invalid authentication." });
  }
  if (message === "FORBIDDEN") {
    return crmFail({ origin, status: 403, code: "FORBIDDEN", message: "Caller is not authorized for plays run." });
  }
  if (message === "VALIDATION_ERROR") {
    return crmFail({ origin, status: 400, code: "VALIDATION_ERROR", message: "Invalid request parameters." });
  }
  if (message === "NOT_FOUND") {
    return crmFail({ origin, status: 404, code: "NOT_FOUND", message: "Document not found." });
  }
  return crmFail({
    origin,
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Document plays run failed.",
    details: message.length > 0 ? message.slice(0, 500) : undefined,
  });
}

async function defaultService(): Promise<RunPlaysService> {
  return { run: runPlaysEngine };
}

export async function handleRunRequest(
  req: Request,
  serviceOverride?: RunPlaysService,
  dependencyOverrides: Partial<RunRequestDependencies> = {},
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return crmOptionsResponse(origin);

  const service = serviceOverride ?? await defaultService();
  const deps = { ...defaultRunRequestDependencies, ...dependencyOverrides };

  try {
    const url = new URL(req.url);
    const path = normalizePath(url.pathname);

    const admin = deps.createAdminClient();
    const caller: CallerContext = await deps.resolveCallerContext(req, admin);
    const isServiceRole = caller.isServiceRole;
    const isAdminCaller =
      !!caller.userId && ["admin", "manager", "owner"].includes(caller.role ?? "");

    if (!isServiceRole && !isAdminCaller) {
      throw new Error(caller.userId ? "FORBIDDEN" : "UNAUTHORIZED");
    }

    if (req.method === "POST" && (path === "/" || path === "/run" || path === "")) {
      const body = await readJsonBody<{ documentId?: string; workspaceId?: string }>(req);
      const documentId = safeText(body.documentId);
      const workspaceResolution = resolveDocumentPlaysRunWorkspace({
        isServiceRole,
        callerWorkspaceId: caller.workspaceId,
        requestedWorkspaceId: safeText(body.workspaceId),
      });
      if (!workspaceResolution.ok) {
        return crmFail({
          origin,
          status: workspaceResolution.status,
          code: workspaceResolution.code,
          message: workspaceResolution.message,
        });
      }
      const workspaceId = workspaceResolution.workspaceId;
      if (!documentId && !workspaceId) throw new Error("VALIDATION_ERROR");

      const documentAccess = await verifyJwtDocumentWorkspaceAccess({
        admin,
        isServiceRole,
        callerWorkspaceId: caller.workspaceId,
        documentId,
      });
      if (!documentAccess.ok) {
        return crmFail({
          origin,
          status: documentAccess.status,
          code: documentAccess.code,
          message: documentAccess.message,
        });
      }

      const result = await service.run({
        admin,
        documentId,
        workspaceId,
      });
      return crmOk(result, { origin });
    }

    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "Requested plays-run resource was not found.",
    });
  } catch (error) {
    return mapError(origin, error);
  }
}
