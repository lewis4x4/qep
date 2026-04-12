import { assertEquals } from "jsr:@std/assert@1";
import { mapEquipmentRow } from "./crm-equipment-record.ts";

Deno.test("mapEquipmentRow nulls restricted financial fields when they are absent", () => {
  const equipment = mapEquipmentRow({
    id: "eq-1",
    company_id: "co-1",
    primary_contact_id: null,
    name: "CAT 320",
    asset_tag: "EQ-1",
    serial_number: "SN-1",
    make: "Caterpillar",
    model: "320",
    year: 2024,
    category: "excavator",
    vin_pin: "VIN-1",
    condition: "good",
    availability: "available",
    ownership: "owned",
    engine_hours: 120,
    mileage: null,
    fuel_type: "Diesel",
    weight_class: "20-ton",
    operating_capacity: "3200 lbs",
    location_description: "Memphis",
    latitude: null,
    longitude: null,
    warranty_expires_on: null,
    last_inspection_at: null,
    next_service_due_at: null,
    notes: null,
    photo_urls: [],
    metadata: {},
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  });

  assertEquals(equipment.purchasePrice, null);
  assertEquals(equipment.currentMarketValue, null);
  assertEquals(equipment.replacementCost, null);
  assertEquals(equipment.dailyRentalRate, null);
  assertEquals(equipment.weeklyRentalRate, null);
  assertEquals(equipment.monthlyRentalRate, null);
});
