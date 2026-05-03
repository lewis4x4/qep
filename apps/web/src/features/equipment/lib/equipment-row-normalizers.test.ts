import { describe, expect, test } from "bun:test";
import {
  hasNonNullRecordValue,
  normalizeEquipmentDocumentRows,
  normalizeEquipmentPartsOrderRows,
  normalizeEquipmentTelematicsRows,
  normalizeLifecycleSummary,
} from "./equipment-row-normalizers";

describe("equipment row normalizers", () => {
  test("normalizes parts orders and drops rows without required identity/date fields", () => {
    expect(normalizeEquipmentPartsOrderRows([
      {
        id: "order-1",
        status: "",
        total: "124.50",
        estimated_delivery: "2026-05-12T00:00:00Z",
        tracking_number: "trk-1",
        created_at: "2026-05-01T00:00:00Z",
      },
      { id: "missing-date", created_at: "not-a-date" },
    ])).toEqual([{
      id: "order-1",
      status: "unknown",
      total: 124.5,
      estimated_delivery: "2026-05-12T00:00:00Z",
      tracking_number: "trk-1",
      created_at: "2026-05-01T00:00:00Z",
    }]);
  });

  test("normalizes telematics rows with safe defaults", () => {
    expect(normalizeEquipmentTelematicsRows([
      {
        provider: "",
        device_serial: "dev-1",
        last_hours: "4512",
        last_lat: "35.7",
        last_lng: "-78.6",
        last_reading_at: "2026-05-02T13:00:00Z",
        is_active: true,
      },
      {},
    ])).toEqual([{
      provider: "Unknown provider",
      device_serial: "dev-1",
      last_hours: 4512,
      last_lat: 35.7,
      last_lng: -78.6,
      last_reading_at: "2026-05-02T13:00:00Z",
      is_active: true,
    }]);
  });

  test("normalizes documents and excludes unusable links", () => {
    expect(normalizeEquipmentDocumentRows([
      {
        id: "doc-1",
        title: "",
        document_type: null,
        file_url: "https://example.test/doc.pdf",
        customer_visible: true,
        updated_at: "2026-04-30T00:00:00Z",
      },
      { id: "doc-2", file_url: "", updated_at: "2026-04-30T00:00:00Z" },
    ])).toEqual([{
      id: "doc-1",
      title: "Equipment document",
      document_type: "document",
      file_url: "https://example.test/doc.pdf",
      customer_visible: true,
      updated_at: "2026-04-30T00:00:00Z",
    }]);
  });

  test("normalizes lifecycle summary and rejects malformed revenue breakdowns", () => {
    expect(normalizeLifecycleSummary({
      predicted_replacement_date: "not-a-date",
      replacement_confidence: "78.5",
      customer_health_score: 91,
      revenue_breakdown: ["bad"],
    })).toEqual({
      predicted_replacement_date: null,
      replacement_confidence: 78.5,
      customer_health_score: 91,
      revenue_breakdown: null,
    });
  });

  test("detects non-null metadata values without casting component payloads", () => {
    expect(hasNonNullRecordValue({ warranty_expires_at: "2026-12-31" }, "warranty_expires_at")).toBe(true);
    expect(hasNonNullRecordValue({ warranty_expires_at: null }, "warranty_expires_at")).toBe(false);
    expect(hasNonNullRecordValue(["bad"], "warranty_expires_at")).toBe(false);
  });
});
