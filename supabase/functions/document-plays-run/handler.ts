import {
  crmFail,
  crmOk,
  crmOptionsResponse,
  readJsonBody,
  safeText,
} from "../_shared/crm-router-http.ts";
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { runPlaysEngine, type RunPlaysInput, type RunPlaysResult } from "./service.ts";

export interface RunPlaysService {
  run(input: RunPlaysInput): Promise<RunPlaysResult>;
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
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return crmOptionsResponse(origin);

  const service = serviceOverride ?? await defaultService();

  try {
    const url = new URL(req.url);
    const path = normalizePath(url.pathname);

    const admin = createAdminClient();
    const caller = await resolveCallerContext(req, admin);
    const isServiceRole = caller.isServiceRole;
    const isAdminCaller =
      !!caller.userId && ["admin", "manager", "owner"].includes(caller.role ?? "");

    if (!isServiceRole && !isAdminCaller) {
      throw new Error(caller.userId ? "FORBIDDEN" : "UNAUTHORIZED");
    }

    if (req.method === "POST" && (path === "/" || path === "/run" || path === "")) {
      const body = await readJsonBody<{ documentId?: string; workspaceId?: string }>(req);
      const documentId = safeText(body.documentId);
      const workspaceId = safeText(body.workspaceId) ?? caller.workspaceId;
      if (!documentId && !workspaceId) throw new Error("VALIDATION_ERROR");

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
