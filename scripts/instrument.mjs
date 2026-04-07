/**
 * Sentry instrumentation — use as the FIRST import in ESM entry files:
 *   import "../instrument.mjs";
 *
 * Set SENTRY_DSN (or SENTRY_NODE_DSN). Do not commit DSNs to git.
 */
import * as Sentry from "@sentry/node";

if (!globalThis.__QEP_SENTRY_INSTRUMENTED__) {
  globalThis.__QEP_SENTRY_INSTRUMENTED__ = true;
  const dsn = process.env.SENTRY_DSN ?? process.env.SENTRY_NODE_DSN;
  if (dsn?.trim()) {
    Sentry.init({
      dsn: dsn.trim(),
      sendDefaultPii: process.env.SENTRY_SEND_DEFAULT_PII === "true",
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    });
  }
}
