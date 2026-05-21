import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { GenericTelematicsAdapter } from "./adapters/generic-telematics.ts";
import {
  buildTelematicsDedupeKey,
  normalizeProviderKey,
} from "./telematics-adapter.ts";

Deno.test("normalizeProviderKey creates stable provider keys", () => {
  assertEquals(
    normalizeProviderKey(" Yanmar Smart Assist "),
    "yanmar_smart_assist",
  );
  assertEquals(normalizeProviderKey(""), "generic_oem");
  assertEquals(normalizeProviderKey(null), "generic_oem");
});

Deno.test("GenericTelematicsAdapter normalizes reading payloads", () => {
  const adapter = new GenericTelematicsAdapter();
  const reading = adapter.normalizeReading({
    provider: "AEMP",
    workspace_id: "default",
    device_id: "DEV-1",
    serial: "SN-1",
    cumulative_operating_hours: "42.5",
    latitude: "30.1",
    longitude: "-81.6",
    last_reported_at: "2026-05-21T05:00:00-04:00",
  });

  assertEquals(reading.provider, "aemp");
  assertEquals(reading.workspaceId, "default");
  assertEquals(reading.deviceId, "DEV-1");
  assertEquals(reading.deviceSerial, "SN-1");
  assertEquals(reading.hours, 42.5);
  assertEquals(reading.lat, 30.1);
  assertEquals(reading.lng, -81.6);
  assertEquals(reading.readingAt, "2026-05-21T09:00:00.000Z");
});

Deno.test("GenericTelematicsAdapter validates device ids and signal kinds", () => {
  const adapter = new GenericTelematicsAdapter();

  assertThrows(
    () => adapter.normalizeReading({ provider: "aemp" }),
    Error,
    "VALIDATION_ERROR:deviceId",
  );
  assertThrows(
    () => adapter.normalizeSignal({ deviceId: "DEV-1", kind: "unknown" }),
    Error,
    "VALIDATION_ERROR:kind",
  );
});

Deno.test("GenericTelematicsAdapter normalizes signal payloads and dedupe keys", () => {
  const adapter = new GenericTelematicsAdapter("aemp");
  const signal = adapter.normalizeSignal({
    workspaceId: "default",
    deviceId: "DEV-1",
    kind: "fault",
    code: "SPN-123",
    severity: "critical",
    providerEventId: "evt-123",
    occurredAt: "2026-05-21T10:00:00Z",
  });

  assertEquals(signal.provider, "aemp");
  assertEquals(signal.workspaceId, "default");
  assertEquals(signal.kind, "fault");
  assertEquals(signal.severity, "critical");
  assertEquals(buildTelematicsDedupeKey(signal), "telematics:aemp:evt-123");
});
