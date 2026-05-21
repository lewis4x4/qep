/**
 * Generic normalized telematics adapter.
 *
 * This adapter accepts the repo's current provider-neutral payloads and gives
 * future OEM-specific adapters a contract-compatible reference implementation.
 */

import {
  type NormalizedTelematicsReading,
  type NormalizedTelematicsSignal,
  normalizeNullableString,
  normalizeNumberOrNull,
  normalizeOptionalString,
  normalizeProviderKey,
  normalizeSignalKind,
  normalizeSignalSeverity,
  normalizeTimestamp,
  requireDeviceId,
  type TelematicsAdapter,
  type TelematicsAdapterConfig,
} from "../telematics-adapter.ts";

type GenericReadingPayload = Record<string, unknown>;
type GenericSignalPayload = Record<string, unknown>;

function readString(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = normalizeOptionalString(payload[key]);
    if (value) return value;
  }
  return undefined;
}

function readUnknown(
  payload: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

function normalizeWorkspaceId(
  payload: Record<string, unknown>,
  config?: TelematicsAdapterConfig,
): string | undefined {
  return readString(payload, "workspaceId", "workspace_id") ??
    normalizeOptionalString(config?.workspaceId);
}

export class GenericTelematicsAdapter
  implements TelematicsAdapter<GenericReadingPayload, GenericSignalPayload> {
  readonly provider: string;

  constructor(provider = "generic_oem") {
    this.provider = normalizeProviderKey(provider);
  }

  normalizeReading(
    payload: GenericReadingPayload,
    config?: TelematicsAdapterConfig,
  ): NormalizedTelematicsReading {
    const provider = normalizeProviderKey(
      readString(payload, "provider", "provider_key", "source") ??
        config?.provider,
      this.provider,
    );
    const deviceId = requireDeviceId(
      readUnknown(payload, "deviceId", "device_id"),
    );

    return {
      provider,
      workspaceId: normalizeWorkspaceId(payload, config),
      deviceId,
      deviceSerial: normalizeNullableString(
        readUnknown(payload, "deviceSerial", "device_serial", "serial"),
      ),
      hours: normalizeNumberOrNull(
        readUnknown(
          payload,
          "hours",
          "last_hours",
          "cumulative_operating_hours",
        ),
      ),
      lat: normalizeNumberOrNull(readUnknown(payload, "lat", "latitude")),
      lng: normalizeNumberOrNull(
        readUnknown(payload, "lng", "lon", "longitude"),
      ),
      readingAt: normalizeTimestamp(
        readUnknown(
          payload,
          "readingAt",
          "reading_at",
          "last_reported_at",
          "occurredAt",
          "occurred_at",
        ),
      ),
      raw: typeof payload.raw === "object" && payload.raw !== null
        ? payload.raw as Record<string, unknown>
        : payload,
    };
  }

  normalizeSignal(
    payload: GenericSignalPayload,
    config?: TelematicsAdapterConfig,
  ): NormalizedTelematicsSignal {
    const provider = normalizeProviderKey(
      readString(payload, "provider", "provider_key", "source") ??
        config?.provider,
      this.provider,
    );
    const deviceId = requireDeviceId(
      readUnknown(payload, "deviceId", "device_id"),
    );

    return {
      provider,
      workspaceId: normalizeWorkspaceId(payload, config),
      deviceId,
      kind: normalizeSignalKind(payload.kind),
      code: normalizeNullableString(readUnknown(payload, "code", "fault_code")),
      description: normalizeNullableString(payload.description),
      severity: normalizeSignalSeverity(payload.severity),
      providerEventId: normalizeNullableString(
        readUnknown(
          payload,
          "providerEventId",
          "provider_event_id",
          "event_id",
        ),
      ),
      occurredAt: normalizeTimestamp(
        readUnknown(payload, "occurredAt", "occurred_at", "timestamp"),
      ),
      raw: typeof payload.raw === "object" && payload.raw !== null
        ? payload.raw as Record<string, unknown>
        : payload,
    };
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number }> {
    return { success: true, latencyMs: 0 };
  }
}

export const genericTelematicsAdapter = new GenericTelematicsAdapter();
