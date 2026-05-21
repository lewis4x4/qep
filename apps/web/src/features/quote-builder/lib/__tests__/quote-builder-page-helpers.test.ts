import { describe, expect, test } from "bun:test";

import { buildEquipmentLine, metadataForCatalogEntry } from "../quote-builder-page-helpers";

describe("quote-builder-page-helpers", () => {
  test("metadataForCatalogEntry forwards received_at for approval bypass", () => {
    const metadata = metadataForCatalogEntry({
      make: "Bobcat",
      model: "T770",
      year: 2022,
      received_at: "2023-06-15T12:00:00.000Z",
      stock_number: "STK-1",
    });
    expect(metadata.received_at).toBe("2023-06-15T12:00:00.000Z");
    expect(metadata.availability_status).toBe("in_stock");
  });

  test("buildEquipmentLine sets system_base_unit_price from list price", () => {
    const line = buildEquipmentLine({
      make: "Bobcat",
      model: "T770",
      year: 2022,
      list_price: 85000,
    });
    expect(line.unitPrice).toBe(85000);
    expect(line.metadata?.system_base_unit_price).toBe(85000);
  });

  test("metadataForCatalogEntry preserves manufacturer structured specs", () => {
    const metadata = metadataForCatalogEntry({
      make: "ASV",
      model: "RT-75",
      year: 2026,
      spec_bullets: ["Horsepower: 74 HP"],
      structured_specs: [{
        key: "horsepower",
        label: "Horsepower",
        value: "74",
        unit: "HP",
        category: "Engine",
        priority: 10,
        source: "qb_equipment_models.specs",
      }],
      spec_source: "manufacturer_ingested",
    });

    expect(metadata.spec_bullets).toEqual(["Horsepower: 74 HP"]);
    expect(metadata.structured_specs).toEqual([expect.objectContaining({ key: "horsepower", value: "74" })]);
    expect(metadata.spec_source).toBe("manufacturer_ingested");
  });
});
