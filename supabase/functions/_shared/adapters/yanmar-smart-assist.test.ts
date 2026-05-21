import { assertEquals } from "jsr:@std/assert@1";
import { yanmarSmartAssistAdapter } from "./yanmar-smart-assist.ts";
import {
  normalizeTelematicsReading,
  normalizeTelematicsSignal,
} from "../telematics-adapter-registry.ts";
import { buildTelematicsDedupeKey } from "../telematics-adapter.ts";

Deno.test("YanmarSmartAssistAdapter normalizes Yanmar machine readings", () => {
  const reading = yanmarSmartAssistAdapter.normalizeReading({
    provider: "Yanmar Smart Assist",
    workspace_id: "default",
    machine: {
      id: "YSA-UNIT-100",
      serialNumber: "YMRVIO55-12345",
      hourMeter: "812.4",
      lastReportedAt: "2026-05-21T08:30:00-04:00",
    },
    location: { latitude: "30.3322", longitude: "-81.6556" },
  });

  assertEquals(reading.provider, "yanmar_smart_assist");
  assertEquals(reading.workspaceId, "default");
  assertEquals(reading.deviceId, "YSA-UNIT-100");
  assertEquals(reading.deviceSerial, "YMRVIO55-12345");
  assertEquals(reading.hours, 812.4);
  assertEquals(reading.lat, 30.3322);
  assertEquals(reading.lng, -81.6556);
  assertEquals(reading.readingAt, "2026-05-21T12:30:00.000Z");
});

Deno.test("YanmarSmartAssistAdapter accepts ASV Smart Assist aliases", () => {
  const reading = normalizeTelematicsReading({
    provider: "ASV",
    asset: { id: "ASV-RT135-DEVICE", serial_number: "ASVRT135LTDF01723" },
    metrics: { engine_hours: 344.9 },
    gps: { lat: 29.9511, lon: -90.0715 },
    timestamp: "2026-05-21T14:00:00Z",
  });

  assertEquals(reading.provider, "asv");
  assertEquals(reading.deviceId, "ASV-RT135-DEVICE");
  assertEquals(reading.deviceSerial, "ASVRT135LTDF01723");
  assertEquals(reading.hours, 344.9);
});

Deno.test("YanmarSmartAssistAdapter normalizes fault alerts and dedupe keys", () => {
  const signal = normalizeTelematicsSignal({
    provider_key: "yanmar_smart_assist",
    machineId: "YSA-UNIT-100",
    alert: {
      id: "ALERT-9",
      code: "DTC-123",
      description: "Hydraulic temperature high",
      severity: "warning",
      timestamp: "2026-05-21T15:00:00Z",
    },
  });

  assertEquals(signal.provider, "yanmar_smart_assist");
  assertEquals(signal.kind, "fault");
  assertEquals(signal.code, "DTC-123");
  assertEquals(signal.description, "Hydraulic temperature high");
  assertEquals(signal.severity, "medium");
  assertEquals(signal.providerEventId, "ALERT-9");
  assertEquals(
    buildTelematicsDedupeKey(signal),
    "telematics:yanmar_smart_assist:ALERT-9",
  );
});

Deno.test("YanmarSmartAssistAdapter normalizes idle alerts", () => {
  const signal = normalizeTelematicsSignal({
    provider: "smart_assist",
    device_id: "ASV-RT75-DEVICE",
    category: "excessive_idle",
    idleMinutes: 93,
    event_id: "IDLE-42",
    occurred_at: "2026-05-21T16:00:00Z",
  });

  assertEquals(signal.provider, "smart_assist");
  assertEquals(signal.kind, "idle");
  assertEquals(signal.providerEventId, "IDLE-42");
});
