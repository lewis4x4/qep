/**
 * Resilient HTTP fetch with timeout, exponential backoff retry, and circuit breaker.
 *
 * Global resilience policy (per integration spec §2):
 *   - Request timeout: 30s (5s connect + 25s read — approximated via AbortController)
 *   - Retries: 3 attempts on 408, 429, 5xx, and network timeouts
 *   - Backoff: exponential with jitter (500ms, 1500ms, 3500ms base)
 *   - Circuit breaker: open after 5 consecutive failures per operation key
 *   - Circuit breaker cooldown: 300s, then half-open with 2 probe requests
 *
 * Usage:
 *   const result = await resilientFetch("https://api.example.com/data", {
 *     integrationKey: "ironguides",
 *     operationKey: "valuation",
 *     headers: { Authorization: "Bearer ..." },
 *   });
 */

import type { CircuitBreakerState, CircuitState, FailureReason } from "./integration-types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker registry (in-memory per Edge Function isolate)
// ─────────────────────────────────────────────────────────────────────────────

const CIRCUIT_REGISTRY = new Map<string, CircuitBreakerState>();
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 300_000; // 5 minutes
const CIRCUIT_PROBE_REQUESTS = 2;
const probeCounters = new Map<string, number>();

function getCircuit(key: string): CircuitBreakerState {
  if (!CIRCUIT_REGISTRY.has(key)) {
    CIRCUIT_REGISTRY.set(key, {
      state: "closed",
      failures: 0,
      lastFailureAt: null,
      nextProbeAt: null,
    });
  }
  return CIRCUIT_REGISTRY.get(key)!;
}

function recordSuccess(key: string): void {
  const circuit = getCircuit(key);
  circuit.state = "closed";
  circuit.failures = 0;
  circuit.lastFailureAt = null;
  circuit.nextProbeAt = null;
  probeCounters.delete(key);
}

function recordFailure(key: string): void {
  const circuit = getCircuit(key);
  circuit.failures += 1;
  circuit.lastFailureAt = Date.now();
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.state = "open";
    circuit.nextProbeAt = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
}

function isCircuitOpen(key: string): boolean {
  const circuit = getCircuit(key);
  if (circuit.state === "closed") return false;
  if (circuit.state === "open") {
    const now = Date.now();
    if (circuit.nextProbeAt && now >= circuit.nextProbeAt) {
      // Transition to half-open — allow limited probe requests
      circuit.state = "half_open";
      probeCounters.set(key, 0);
      return false;
    }
    return true;
  }
  // half_open: allow up to CIRCUIT_PROBE_REQUESTS probes
  const probes = probeCounters.get(key) ?? 0;
  if (probes < CIRCUIT_PROBE_REQUESTS) {
    probeCounters.set(key, probes + 1);
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy
// ─────────────────────────────────────────────────────────────────────────────

const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_DELAYS_MS = [500, 1500, 3500];
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function jitter(baseMs: number): number {
  // ±25% jitter
  return baseMs + Math.floor((Math.random() - 0.5) * 0.5 * baseMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFailure(status: number): FailureReason {
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_5xx";
  return "upstream_5xx";
}

// ─────────────────────────────────────────────────────────────────────────────
// ResilientFetchOptions
// ─────────────────────────────────────────────────────────────────────────────

export interface ResilientFetchOptions extends RequestInit {
  /** Integration key — used for circuit breaker registry scoping */
  integrationKey: string;
  /** Operation key — combined with integrationKey for per-operation circuit breaker */
  operationKey?: string;
  /** Override request timeout (default: 30000ms) */
  timeoutMs?: number;
  /** Override max retries (default: 3) */
  maxRetries?: number;
}

export interface ResilientFetchResult {
  response: Response;
  latencyMs: number;
  attempts: number;
}

export class CircuitOpenError extends Error {
  readonly integrationKey: string;
  constructor(integrationKey: string) {
    super(`Circuit breaker open for integration: ${integrationKey}`);
    this.name = "CircuitOpenError";
    this.integrationKey = integrationKey;
  }
}

export class UpstreamError extends Error {
  readonly status: number;
  readonly reason: FailureReason;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.reason = classifyFailure(status);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resilientFetch — main export
// ─────────────────────────────────────────────────────────────────────────────

export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions
): Promise<ResilientFetchResult> {
  const {
    integrationKey,
    operationKey = "default",
    timeoutMs = REQUEST_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
    ...fetchInit
  } = options;

  const circuitKey = `${integrationKey}:${operationKey}`;

  if (isCircuitOpen(circuitKey)) {
    throw new CircuitOpenError(integrationKey);
  }

  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchInit,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        recordSuccess(circuitKey);
        return {
          response,
          latencyMs: Date.now() - startTime,
          attempts: attempt + 1,
        };
      }

      // Non-retryable errors — fail immediately
      if (!RETRY_STATUS_CODES.has(response.status)) {
        recordFailure(circuitKey);
        throw new UpstreamError(
          response.status,
          `Integration ${integrationKey} returned ${response.status}`
        );
      }

      lastError = new UpstreamError(
        response.status,
        `Integration ${integrationKey} returned ${response.status} (attempt ${attempt + 1})`
      );
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof CircuitOpenError || err instanceof UpstreamError) {
        throw err;
      }
      // Network error or timeout
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      lastError = new Error(
        isAbort
          ? `Integration ${integrationKey} timed out after ${timeoutMs}ms`
          : `Integration ${integrationKey} network error: ${String(err)}`
      );
    }

    // Retry with backoff (not on last attempt)
    if (attempt < maxRetries) {
      const delay = jitter(BASE_DELAYS_MS[attempt] ?? BASE_DELAYS_MS[BASE_DELAYS_MS.length - 1]);
      await sleep(delay);
    }
  }

  recordFailure(circuitKey);
  throw lastError ?? new Error(`Integration ${integrationKey} failed after ${maxRetries + 1} attempts`);
}

/**
 * Returns the current circuit breaker state for an integration (useful for health checks).
 */
export function getCircuitState(integrationKey: string, operationKey = "default"): CircuitState {
  return getCircuit(`${integrationKey}:${operationKey}`).state;
}

/**
 * Manually resets a circuit breaker (useful for admin "force reconnect" actions).
 */
export function resetCircuit(integrationKey: string, operationKey = "default"): void {
  recordSuccess(`${integrationKey}:${operationKey}`);
}
