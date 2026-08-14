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

function extractClientErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error.trim() || null;
  if (error instanceof Error) return error.message.trim() || null;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim() || null;
  }
  return null;
}

/**
 * Sanitize Supabase client / PostgREST / Postgres errors before showing them
 * in operator-facing UI. Never surfaces raw `permission denied for table …`
 * or other internal database copy.
 */
export function sanitizeClientError(
  error: unknown,
  fallback: string,
): string {
  const raw = extractClientErrorMessage(error);
  if (!raw) return fallback;

  const lc = raw.toLowerCase();
  if (
    lc.includes("permission denied") ||
    lc.includes("42501") ||
    lc.includes("row-level security") ||
    lc.includes("new row violates row-level security") ||
    lc.includes("for table ") ||
    lc.includes("for column ") ||
    lc.includes("relation ") ||
    lc.includes("pgrst") ||
    lc.includes("postgres")
  ) {
    return fallback;
  }

  return fallback;
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
