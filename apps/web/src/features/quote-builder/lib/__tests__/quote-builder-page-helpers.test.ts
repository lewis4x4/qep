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
});
