import { errorResponse, jsonResponse } from "./crm-error.ts";

const ALLOWED_ORIGINS = new Set([
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
]);

export function crmCorsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Vary": "Origin",
  };
}

export function crmOptionsResponse(origin: string | null): Response {
  return new Response("ok", { headers: crmCorsHeaders(origin) });
}

export function crmOk(
  payload: unknown,
  options: { origin: string | null; status?: number } = { origin: null },
): Response {
  return jsonResponse(payload, {
    status: options.status ?? 200,
    headers: crmCorsHeaders(options.origin),
  });
}

export function crmFail(params: {
  origin: string | null;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}): Response {
  return errorResponse(params.status, params.code, params.message, {
    details: params.details,
    headers: crmCorsHeaders(params.origin),
  });
}

export async function readJsonBody<T>(req: Request): Promise<T> {
  const raw = await req.text();
  if (!raw.trim()) {
    return {} as T;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SyntaxError("Request body must be valid JSON.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new SyntaxError("Request body must be a JSON object.");
  }

  return parsed as T;
}

export function normalizeRouterPath(pathname: string): string {
  if (pathname.startsWith("/crm-router")) {
    return pathname.slice("/crm-router".length) || "/";
  }

  return pathname;
}

export function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
