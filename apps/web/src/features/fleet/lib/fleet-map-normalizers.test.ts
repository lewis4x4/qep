import { describe, expect, test } from "bun:test";
import {
  normalizeFleetEquipmentRows,
  normalizeFleetTelemetryRows,
  resolveFleetCoordinate,
} from "./fleet-map-normalizers";

describe("fleet map normalizers", () => {
  test("normalizes equipment rows and filters malformed rows", () => {
    const rows = normalizeFleetEquipmentRows([
      {
        id: "eq-1",
        name: "",
        make: "Deere",
        model: "333G",
        year: "2022",
        engine_hours: "414.5",
        company_id: "company-1",
        metadata: { lat: "35.12", lng: "-78.66" },
      },
      { id: "", name: "Missing id" },
      { id: "eq-2", name: null, make: null, model: null, year: 1800, metadata: [] },
    ]);

    expect(rows).toEqual([
      {
        id: "eq-1",
        name: "2022 Deere 333G",
        make: "Deere",
        model: "333G",
        year: 2022,
        engine_hours: 414.5,
        company_id: "company-1",
        metadata: { lat: "35.12", lng: "-78.66" },
      },
      {
        id: "eq-2",
        name: "Unnamed asset",
        make: null,
        model: null,
        year: null,
        engine_hours: null,
        company_id: null,
        metadata: {},
      },
    ]);
  });

  test("normalizes telemetry rows and rejects invalid equipment references", () => {
    const rows = normalizeFleetTelemetryRows([
      {
        equipment_id: "eq-1",
        last_lat: "35.1",
        last_lng: "-78.6",
        last_reading_at: "2026-05-03T12:00:00Z",
      },
      { equipment_id: null, last_lat: 10, last_lng: 20 },
      { equipment_id: "eq-2", last_lat: "bad", last_lng: 20, last_reading_at: "not-a-date" },
    ]);

    expect(rows).toEqual([
      {
        equipment_id: "eq-1",
        last_lat: 35.1,
        last_lng: -78.6,
        last_reading_at: "2026-05-03T12:00:00Z",
      },
      {
        equipment_id: "eq-2",
        last_lat: null,
        last_lng: 20,
        last_reading_at: null,
      },
    ]);
  });

  test("prefers telemetry coordinates and falls back to metadata", () => {
    const [equipment] = normalizeFleetEquipmentRows([
      { id: "eq-1", name: "Skid steer", metadata: { lat: "35.12", lng: "-78.66" } },
    ]);

    expect(resolveFleetCoordinate(equipment, { equipment_id: "eq-1", last_lat: 36, last_lng: -79, last_reading_at: null })).toEqual({
      lat: 36,
      lng: -79,
    });
    expect(resolveFleetCoordinate(equipment, undefined)).toEqual({ lat: 35.12, lng: -78.66 });
  });

  test("returns no coordinate when neither telemetry nor metadata has a complete pair", () => {
    const [equipment] = normalizeFleetEquipmentRows([
      { id: "eq-1", name: "Skid steer", metadata: { lat: "35.12" } },
    ]);

    expect(resolveFleetCoordinate(equipment, { equipment_id: "eq-1", last_lat: 36, last_lng: null, last_reading_at: null })).toBeNull();
    expect(resolveFleetCoordinate(equipment, undefined)).toBeNull();
  });
});
