/**
 * Sentry instrumentation — load FIRST (before any other app imports).
 * CommonJS entry points: `require("./instrument.js");`
 *
 * Set SENTRY_DSN (or SENTRY_NODE_DSN). Do not commit DSNs to git.
 */
"use strict";

const Sentry = require("@sentry/node");

if (!globalThis.__QEP_SENTRY_INSTRUMENTED__) {
  globalThis.__QEP_SENTRY_INSTRUMENTED__ = true;
  const dsn = process.env.SENTRY_DSN || process.env.SENTRY_NODE_DSN;
  if (dsn && String(dsn).trim()) {
    Sentry.init({
      dsn: String(dsn).trim(),
      sendDefaultPii: process.env.SENTRY_SEND_DEFAULT_PII === "true",
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    });
  }
}
