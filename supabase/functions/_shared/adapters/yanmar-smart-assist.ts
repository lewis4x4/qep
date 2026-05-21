/**
 * Yanmar / ASV Smart Assist telematics adapter.
 *
 * Smart Assist covers Yanmar Compact Equipment and ASV surfaces under the YCENA
 * operating relationship. This adapter intentionally normalizes payloads only;
 * live polling/webhook auth stays blocked until credentials and provider payload
 * contracts are approved.
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
  type TelematicsSignalKind,
  type TelematicsSignalSeverity,
} from "../telematics-adapter.ts";

type Payload = Record<string, unknown>;

const PROVIDER = "yanmar_smart_assist";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nested(payload: Payload, path: string): unknown {
  let current: unknown = payload;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function first(payload: Payload, paths: string[]): unknown {
  for (const path of paths) {
    const value = nested(payload, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function stringFirst(payload: Payload, paths: string[]): string | undefined {
  return normalizeOptionalString(first(payload, paths));
}

function workspaceId(
  payload: Payload,
  config?: TelematicsAdapterConfig,
): string | undefined {
  return stringFirst(payload, [
    "workspaceId",
    "workspace_id",
    "tenant.workspaceId",
    "tenant.workspace_id",
  ]) ??
    normalizeOptionalString(config?.workspaceId);
}

function providerKey(
  payload: Payload,
  config?: TelematicsAdapterConfig,
): string {
  return normalizeProviderKey(
    stringFirst(payload, [
      "provider",
      "provider_key",
      "source",
      "oem.provider",
    ]) ?? config?.provider,
    PROVIDER,
  );
}

function deviceId(payload: Payload): string {
  return requireDeviceId(
    first(payload, [
      "deviceId",
      "device_id",
      "machineId",
      "machine_id",
      "assetId",
      "asset_id",
      "unitId",
      "unit_id",
      "terminalId",
      "terminal_id",
      "machine.id",
      "asset.id",
      "unit.id",
      "telematics.deviceId",
      "telematics.device_id",
      "serialNumber",
      "serial_number",
      "machine.serialNumber",
      "machine.serial_number",
      "asset.serialNumber",
      "asset.serial_number",
    ]),
  );
}

function deviceSerial(payload: Payload): string | null {
  return normalizeNullableString(
    first(payload, [
      "deviceSerial",
      "device_serial",
      "serialNumber",
      "serial_number",
      "productSerialNumber",
      "product_serial_number",
      "vin",
      "machine.serialNumber",
      "machine.serial_number",
      "machine.productSerialNumber",
      "asset.serialNumber",
      "asset.serial_number",
    ]),
  );
}

function readingTimestamp(payload: Payload): string {
  return normalizeTimestamp(
    first(payload, [
      "readingAt",
      "reading_at",
      "reportedAt",
      "reported_at",
      "lastReportedAt",
      "last_reported_at",
      "timestamp",
      "occurredAt",
      "occurred_at",
      "machine.lastReportedAt",
      "machine.last_reported_at",
      "telematics.timestamp",
    ]),
  );
}

function latitude(payload: Payload): number | null {
  return normalizeNumberOrNull(
    first(payload, [
      "lat",
      "latitude",
      "location.lat",
      "location.latitude",
      "gps.lat",
      "gps.latitude",
      "position.lat",
      "position.latitude",
    ]),
  );
}

function longitude(payload: Payload): number | null {
  return normalizeNumberOrNull(
    first(payload, [
      "lng",
      "lon",
      "longitude",
      "location.lng",
      "location.lon",
      "location.longitude",
      "gps.lng",
      "gps.lon",
      "gps.longitude",
      "position.lng",
      "position.lon",
      "position.longitude",
    ]),
  );
}

function operatingHours(payload: Payload): number | null {
  return normalizeNumberOrNull(
    first(payload, [
      "hours",
      "engineHours",
      "engine_hours",
      "hourMeter",
      "hour_meter",
      "operatingHours",
      "operating_hours",
      "totalOperatingHours",
      "total_operating_hours",
      "cumulative_operating_hours",
      "metrics.engineHours",
      "metrics.engine_hours",
      "metrics.hourMeter",
      "machine.engineHours",
      "machine.engine_hours",
      "machine.hourMeter",
      "telematics.engineHours",
      "telematics.engine_hours",
    ]),
  );
}

function signalKind(payload: Payload): TelematicsSignalKind {
  const explicit = first(payload, ["kind", "event.kind", "alert.kind"]);
  if (explicit !== undefined) return normalizeSignalKind(explicit);

  const category = normalizeOptionalString(
    first(payload, ["category", "event.category", "alert.category"]),
  )
    ?.toLowerCase();
  if (category?.includes("idle")) return "idle";

  if (
    first(payload, [
      "idleMinutes",
      "idle_minutes",
      "event.idleMinutes",
      "alert.idleMinutes",
    ]) !== undefined
  ) {
    return "idle";
  }

  return "fault";
}

function severity(payload: Payload): TelematicsSignalSeverity | undefined {
  const raw = normalizeOptionalString(
    first(payload, [
      "severity",
      "event.severity",
      "alert.severity",
      "priority",
    ]),
  )
    ?.toLowerCase();
  const direct = normalizeSignalSeverity(raw);
  if (direct) return direct;
  switch (raw) {
    case "emergency":
    case "severe":
      return "critical";
    case "warning":
    case "caution":
      return "medium";
    case "info":
    case "normal":
      return "low";
    default:
      return undefined;
  }
}

export class YanmarSmartAssistAdapter
  implements TelematicsAdapter<Payload, Payload> {
  readonly provider = PROVIDER;

  normalizeReading(
    payload: Payload,
    config?: TelematicsAdapterConfig,
  ): NormalizedTelematicsReading {
    return {
      provider: providerKey(payload, config),
      workspaceId: workspaceId(payload, config),
      deviceId: deviceId(payload),
      deviceSerial: deviceSerial(payload),
      hours: operatingHours(payload),
      lat: latitude(payload),
      lng: longitude(payload),
      readingAt: readingTimestamp(payload),
      raw: payload,
    };
  }

  normalizeSignal(
    payload: Payload,
    config?: TelematicsAdapterConfig,
  ): NormalizedTelematicsSignal {
    const kind = signalKind(payload);
    return {
      provider: providerKey(payload, config),
      workspaceId: workspaceId(payload, config),
      deviceId: deviceId(payload),
      kind,
      code: normalizeNullableString(
        first(payload, [
          "code",
          "faultCode",
          "fault_code",
          "dtc",
          "spn",
          "event.code",
          "alert.code",
        ]),
      ),
      description: normalizeNullableString(
        first(payload, [
          "description",
          "message",
          "event.description",
          "alert.description",
          "alert.message",
        ]),
      ),
      severity: severity(payload),
      providerEventId: normalizeNullableString(
        first(payload, [
          "providerEventId",
          "provider_event_id",
          "eventId",
          "event_id",
          "alert.id",
          "event.id",
        ]),
      ),
      occurredAt: normalizeTimestamp(
        first(payload, [
          "occurredAt",
          "occurred_at",
          "timestamp",
          "event.timestamp",
          "alert.timestamp",
        ]),
      ),
      raw: payload,
    };
  }

  async testConnection(): Promise<
    { success: boolean; latencyMs: number; error?: string }
  > {
    return {
      success: false,
      latencyMs: 0,
      error:
        "Yanmar Smart Assist live credentials and endpoint contract are not configured.",
    };
  }
}

export const yanmarSmartAssistAdapter = new YanmarSmartAssistAdapter();
