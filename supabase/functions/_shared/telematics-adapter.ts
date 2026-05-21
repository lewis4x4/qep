/**
 * Provider-neutral telematics adapter boundary.
 *
 * C5.1 keeps provider-specific contracts out of ingest functions: adapters map
 * OEM/AEMP/webhook payloads into these normalized reading and signal shapes,
 * then ingest functions resolve the feed and persist downstream effects.
 */

export type TelematicsSignalKind = "fault" | "idle";
export type TelematicsSignalSeverity = "low" | "medium" | "high" | "critical";

export interface TelematicsAdapterConfig {
  workspaceId?: string;
  provider?: string;
  credentials?: Record<string, string>;
  endpointUrl?: string;
  config?: Record<string, unknown>;
}

export interface NormalizedTelematicsReading {
  /** Provider key registered on telematics_feeds.provider. */
  provider: string;
  /** Optional workspace scope for service-role webhook/device callers. */
  workspaceId?: string;
  /** Provider-issued device id; maps to telematics_feeds.device_id. */
  deviceId: string;
  /** Optional provider-visible serial for diagnostics or mapping workflows. */
  deviceSerial?: string | null;
  hours: number | null;
  lat: number | null;
  lng: number | null;
  readingAt: string;
  raw?: Record<string, unknown>;
}

export interface NormalizedTelematicsSignal {
  /** Provider key registered on telematics_feeds.provider. */
  provider: string;
  /** Optional workspace scope for service-role webhook/device callers. */
  workspaceId?: string;
  /** Provider-issued device id; maps to telematics_feeds.device_id. */
  deviceId: string;
  kind: TelematicsSignalKind;
  code?: string | null;
  description?: string | null;
  severity?: TelematicsSignalSeverity;
  providerEventId?: string | null;
  occurredAt: string;
  raw?: Record<string, unknown>;
}

export interface TelematicsAdapter<
  TReadingPayload = unknown,
  TSignalPayload = unknown,
> {
  readonly provider: string;
  normalizeReading(
    payload: TReadingPayload,
    config?: TelematicsAdapterConfig,
  ): NormalizedTelematicsReading;
  normalizeSignal?(
    payload: TSignalPayload,
    config?: TelematicsAdapterConfig,
  ): NormalizedTelematicsSignal;
  testConnection?(
    config?: TelematicsAdapterConfig,
  ): Promise<{ success: boolean; latencyMs: number; error?: string }>;
}

export function normalizeProviderKey(
  value: unknown,
  fallback = "generic_oem",
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeNullableString(value: unknown): string | null {
  return normalizeOptionalString(value) ?? null;
}

export function normalizeNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTimestamp(value: unknown, now = new Date()): string {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return now.toISOString();
}

export function requireDeviceId(value: unknown): string {
  const deviceId = normalizeOptionalString(value);
  if (!deviceId) throw new Error("VALIDATION_ERROR:deviceId");
  return deviceId;
}

export function normalizeSignalKind(value: unknown): TelematicsSignalKind {
  if (value === "fault" || value === "idle") return value;
  throw new Error("VALIDATION_ERROR:kind");
}

export function normalizeSignalSeverity(
  value: unknown,
): TelematicsSignalSeverity | undefined {
  if (
    value === "low" || value === "medium" || value === "high" ||
    value === "critical"
  ) {
    return value;
  }
  return undefined;
}

export function buildTelematicsDedupeKey(
  signal: NormalizedTelematicsSignal,
): string {
  if (signal.providerEventId) {
    return `telematics:${signal.provider}:${signal.providerEventId}`;
  }
  return `telematics:${signal.provider}:${signal.deviceId}:${signal.kind}:${
    signal.code ?? "none"
  }:${signal.occurredAt}`;
}
