import {
  crmFail,
  crmOk,
  crmOptionsResponse,
  readJsonBody,
  safeText,
} from "../_shared/crm-router-http.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import { createAdminClient } from "../_shared/dge-auth.ts";
import { runTwinExtraction, type TwinRunInput, type TwinRunResult } from "./service.ts";

export interface DocumentTwinService {
  run(input: TwinRunInput): Promise<TwinRunResult>;
}

function normalizeTwinPath(pathname: string): string {
  if (pathname.startsWith("/document-twin")) {
    return pathname.slice("/document-twin".length) || "/";
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
    return crmFail({ origin, status: 403, code: "FORBIDDEN", message: "Caller role is not authorized for document twin." });
  }
  if (message === "VALIDATION_ERROR") {
    return crmFail({ origin, status: 400, code: "VALIDATION_ERROR", message: "Invalid request parameters." });
  }
  if (message === "NOT_FOUND") {
    return crmFail({ origin, status: 404, code: "NOT_FOUND", message: "Document not found." });
  }
  if (message === "OPENAI_UNCONFIGURED") {
    return crmFail({
      origin,
      status: 503,
      code: "OPENAI_UNCONFIGURED",
      message: "OPENAI_API_KEY is not configured on document-twin.",
    });
  }

  return crmFail({
    origin,
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Document twin request failed.",
    details: message.length > 0 ? message.slice(0, 500) : undefined,
  });
}

async function defaultService(): Promise<DocumentTwinService> {
  return {
    run: runTwinExtraction,
  };
}

export async function handleDocumentTwinRequest(
  req: Request,
  serviceOverride?: DocumentTwinService,
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return crmOptionsResponse(origin);

  const service = serviceOverride ?? await defaultService();

  try {
    const url = new URL(req.url);
    const path = normalizeTwinPath(url.pathname);

    const admin = createAdminClient();
    const caller = await resolveCallerContext(req, admin);
    const isServiceRole = caller.isServiceRole;
    const isAdminCaller =
      !!caller.userId && ["admin", "manager", "owner"].includes(caller.role ?? "");

    if (!isServiceRole && !isAdminCaller) {
      throw new Error(caller.userId ? "FORBIDDEN" : "UNAUTHORIZED");
    }

    if (req.method === "POST" && (path === "/" || path === "/run" || path === "")) {
      const body = await readJsonBody<{ documentId?: string; force?: boolean }>(req);
      const documentId = safeText(body.documentId);
      if (!documentId) throw new Error("VALIDATION_ERROR");

      const result = await service.run({
        admin,
        documentId,
        force: body.force === true,
        actorUserId: caller.userId,
        callerRole: caller.role,
      });
      return crmOk(result, { origin });
    }

    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "Requested document twin resource was not found.",
    });
  } catch (error) {
    return mapError(origin, error);
  }
}
