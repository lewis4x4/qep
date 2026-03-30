import { errorResponse, jsonResponse } from "./crm-error.ts";

const ALLOWED_ORIGINS = new Set([
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
]);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin",
  };
}

export function optionsResponse(origin: string | null): Response {
  return new Response("ok", { headers: corsHeaders(origin) });
}

export function ok(
  payload: unknown,
  options: { origin: string | null; status?: number } = { origin: null },
): Response {
  return jsonResponse(payload, {
    status: options.status ?? 200,
    headers: corsHeaders(options.origin),
  });
}

export function fail(params: {
  origin: string | null;
  status: number;
  code: string;
  message: string;
  details?: unknown;
}): Response {
  return errorResponse(params.status, params.code, params.message, {
    details: params.details,
    headers: corsHeaders(params.origin),
  });
}

export async function readJsonObject<T>(req: Request): Promise<T> {
  const raw = await req.text();
  if (!raw.trim()) return {} as T;

  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
  ) {
    throw new SyntaxError("Request body must be a JSON object.");
  }

  return parsed as T;
}
