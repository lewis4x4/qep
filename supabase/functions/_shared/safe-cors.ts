/**
 * Bulletproof CORS utility for all edge functions.
 *
 * Wraps origin validation in a safe try/catch so that CORS headers are
 * ALWAYS returned — even when the origin header is malformed or processing
 * throws unexpectedly.  Every edge function should use this instead of
 * inlining its own corsHeaders().
 */

const ALLOWED_ORIGINS = new Set([
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
]);

const FALLBACK_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Vary": "Origin",
};

/**
 * Returns CORS headers for the given origin.
 * NEVER throws — returns safe fallback headers on any error.
 */
export function safeCorsHeaders(
  origin: string | null,
): Record<string, string> {
  try {
    const allowOrigin =
      origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
    return {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Vary": "Origin",
    };
  } catch {
    return { ...FALLBACK_HEADERS };
  }
}

/** Pre-built OPTIONS response. */
export function optionsResponse(origin: string | null): Response {
  return new Response("ok", { headers: safeCorsHeaders(origin) });
}

/** JSON error response with CORS headers guaranteed. */
export function safeJsonError(
  message: string,
  status: number,
  origin: string | null,
): Response {
  const headers = safeCorsHeaders(origin);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** JSON error with extra fields (e.g. structured client handling for 409). */
export function safeJsonErrorWithFields(
  message: string,
  status: number,
  origin: string | null,
  extra: Record<string, unknown> = {},
): Response {
  const headers = safeCorsHeaders(origin);
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** JSON success response with CORS headers guaranteed. */
export function safeJsonOk(
  payload: unknown,
  origin: string | null,
  status = 200,
): Response {
  const headers = safeCorsHeaders(origin);
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
