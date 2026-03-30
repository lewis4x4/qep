/**
 * Communication Hub webhook tenant routing (ADR-003).
 * Pure helpers for constant-time route-token checks and idempotency keys.
 * Provider signature verification stays in each Edge handler (SendGrid/Twilio).
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

/** Mandatory deterministic order — do not reorder without ADR revision. */
export const WEBHOOK_VERIFICATION_ORDER = [
  "provider_signature",
  "route_token_or_hmac",
  "workspace_resolution",
  "idempotency_claim",
] as const;

/** Minimum opaque route-token entropy (128 bits). Prefer 256 bits for new workspaces. */
export const MIN_ROUTE_TOKEN_BYTES = 16;

/** Audit reason codes for deny-path coverage (emit via crm-auth-audit access_denied). */
export const WEBHOOK_DENY_REASON = {
  INVALID_PROVIDER_SIGNATURE: "invalid_provider_signature",
  STALE_PROVIDER_TIMESTAMP: "stale_provider_timestamp",
  ROUTE_TOKEN_MISSING: "route_token_missing",
  ROUTE_TOKEN_FORGED_OR_MISMATCH: "route_token_forged_or_mismatch",
  ROUTE_TOKEN_LOW_ENTROPY: "route_token_low_entropy",
  WORKSPACE_UNKNOWN_OR_REVOKED: "workspace_unknown_or_revoked",
  REPLAY_DUPLICATE_EVENT: "replay_duplicate_event",
} as const;

export type WebhookDenyReason =
  typeof WEBHOOK_DENY_REASON[keyof typeof WEBHOOK_DENY_REASON];

function utf8Buffers(a: string, b: string): { ok: boolean } {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return { ok: false };
  return { ok: timingSafeEqual(ab, bb) };
}

/**
 * Constant-time compare for opaque path tokens (or hex-encoded secrets).
 * Length mismatch → false without throwing.
 */
export function verifyOpaqueRouteToken(
  presented: string,
  expected: string,
): boolean {
  return utf8Buffers(presented, expected).ok;
}

/**
 * Rough entropy check: UTF-8 byte length must meet MIN_ROUTE_TOKEN_BYTES.
 * Call after URL decoding; does not validate encoding (hex vs random string).
 */
export function routeTokenMeetsMinimumEntropy(token: string): boolean {
  return new TextEncoder().encode(token).length >= MIN_ROUTE_TOKEN_BYTES;
}

/**
 * Stable idempotency key for `(workspace_id, provider, event_id)` before receipt insert.
 */
export function buildCommunicationWebhookDedupeKey(
  workspaceId: string,
  provider: string,
  eventId: string,
): string {
  return [workspaceId, provider, eventId].map((part) =>
    part.trim().toLowerCase()
  ).join(":");
}
