/**
 * Lazy Sentry facade — the ONLY module eager code may use to talk to Sentry.
 *
 * Why this exists: `instrument.ts` already dynamic-imports @sentry/react
 * after first paint, but any STATIC `import * as Sentry from "@sentry/react"`
 * in the eager graph (AppErrorBoundary in main.tsx, IronGlobalSubscribers)
 * anchors the module to the index chunk — and rollup resolves a dynamic
 * import of an already-statically-imported module to that same chunk
 * instead of splitting it. That is exactly how the full SDK (~503KB) landed
 * in index-*.js whenever VITE_SENTRY_DSN was set (2026-07-09 CI finding).
 *
 * Rules:
 *   • No static value-import of @sentry/react anywhere outside
 *     `installInstrumentation` (type-only imports are fine — they erase).
 *   • Eager code calls `captureException` / `onSentryReady` here. Errors
 *     thrown before the SDK loads are buffered (bounded) and flushed on
 *     install; if the SDK never loads (no DSN), console.error is the sink.
 */
import type * as SentrySdk from "@sentry/react";

type Sdk = typeof SentrySdk;

interface BufferedCapture {
  error: unknown;
  hint?: Parameters<Sdk["captureException"]>[1];
}

const MAX_BUFFERED = 20;

let sdk: Sdk | null = null;
const buffered: BufferedCapture[] = [];
const readyCallbacks: Array<(sdk: Sdk) => void> = [];

/** Capture now if the SDK is up; otherwise buffer for the post-paint flush. */
export function captureException(
  error: unknown,
  hint?: Parameters<Sdk["captureException"]>[1],
): void {
  if (sdk) {
    sdk.captureException(error, hint);
    return;
  }
  if (buffered.length < MAX_BUFFERED) {
    buffered.push({ error, hint });
  }
}

/**
 * Run `callback` with the SDK once instrumentation installs (immediately if
 * it already has). Never fires when the DSN is unset — callers must not
 * depend on it for correctness.
 */
export function onSentryReady(callback: (sdk: Sdk) => void): void {
  if (sdk) {
    callback(sdk);
    return;
  }
  readyCallbacks.push(callback);
}

/** instrument.ts calls this right after Sentry.init. */
export function __setSentrySdk(instance: Sdk): void {
  sdk = instance;
  while (buffered.length > 0) {
    const item = buffered.shift()!;
    try {
      instance.captureException(item.error, item.hint);
    } catch {
      // never let a flush failure cascade
    }
  }
  for (const callback of readyCallbacks.splice(0)) {
    try {
      callback(instance);
    } catch {
      // subscriber errors must not break the flush loop
    }
  }
}
