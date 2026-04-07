// Shared Sentry bootstrap for Supabase Edge Functions.
//
// Initializes once per cold start, gated on SENTRY_DSN being set so local
// `supabase functions serve` runs without any external dependency.
//
// Usage in an edge function:
//
//   import { captureEdgeException } from "../_shared/sentry.ts";
//
//   } catch (err) {
//     captureEdgeException(err, { fn: "portal-api", req });
//     return safeJsonError("Internal server error", 500, origin);
//   }

import * as Sentry from "npm:@sentry/deno@8.47.0";

const dsn = Deno.env.get("SENTRY_DSN");
let initialized = false;

if (dsn && !initialized) {
  Sentry.init({
    dsn,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
    release: Deno.env.get("SENTRY_RELEASE") ?? undefined,
    tracesSampleRate: 0,
    // Edge runtime is short-lived; flush eagerly so events ship before
    // the isolate is recycled.
    maxBreadcrumbs: 20,
  });
  initialized = true;
}

export interface EdgeErrorContext {
  fn: string;
  req?: Request;
  extra?: Record<string, unknown>;
}

export function captureEdgeException(err: unknown, ctx: EdgeErrorContext): void {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag("edge_function", ctx.fn);
      if (ctx.req) {
        const url = new URL(ctx.req.url);
        scope.setContext("request", {
          method: ctx.req.method,
          path: url.pathname,
          origin: ctx.req.headers.get("origin") ?? null,
        });
      }
      if (ctx.extra) scope.setExtras(ctx.extra);
      Sentry.captureException(err);
    });
    // Fire-and-forget flush; edge isolates may exit immediately after the
    // response is returned, so give Sentry a brief window to ship.
    void Sentry.flush(2000);
  } catch (_inner) {
    // Never let observability throw inside an error handler.
  }
}
