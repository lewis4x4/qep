/**
 * Shared helper for surfacing the REAL error from a Supabase
 * `functions.invoke()` failure.
 *
 * supabase-js sets `error.message` to the generic
 * "Edge Function returned a non-2xx status code"; the actual server response
 * body (our `{ error: "..." }` JSON from safeJsonError) lives in
 * `error.context` (a Response). This reads it, parses JSON if possible, and
 * returns whichever field carries meaning, falling back to the generic message.
 *
 * Feature-neutral home so any feature (admin price sheets, price-intelligence,
 * etc.) can reuse it. Mirrors the private helper in lib/iron/api.ts.
 */
export interface EdgeInvokeError {
  message?: string;
  name?: string;
  /** FunctionsHttpError carries the failed Response in `context`. */
  context?: Response;
}

export async function explainInvokeError(
  error: EdgeInvokeError | null | undefined,
  fallback: string,
): Promise<string> {
  const ctx = error?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const text = await ctx.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as {
            error?: string;
            message?: string;
          };
          const real = parsed?.error ?? parsed?.message;
          if (real && typeof real === "string") {
            return `${real} (HTTP ${ctx.status})`;
          }
        } catch {
          // Not JSON — return a bounded slice of the raw body.
          return `${text.slice(0, 200)} (HTTP ${ctx.status})`;
        }
        return `HTTP ${ctx.status}`;
      }
      return `HTTP ${ctx.status}`;
    } catch {
      // Body already consumed / not readable — fall through.
    }
  }
  return error?.message ?? fallback;
}
