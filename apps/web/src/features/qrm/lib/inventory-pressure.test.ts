import { describe, expect, test } from "bun:test";
import { buildInventoryPressureBoard, type InventoryPressureAsset } from "./inventory-pressure";

const ASSET = (overrides: Partial<InventoryPressureAsset>): InventoryPressureAsset => ({
  id: overrides.id ?? "asset-1",
  name: overrides.name ?? "Develon DX225LC-7",
  make: overrides.make ?? "Develon",
  model: overrides.model ?? "DX225LC-7",
  year: overrides.year ?? 2022,
  ownership: overrides.ownership ?? "owned",
  availability: overrides.availability ?? "available",
  condition: overrides.condition ?? "good",
  createdAt: overrides.createdAt ?? "2025-12-01T00:00:00Z",
  currentMarketValue: overrides.currentMarketValue ?? 150000,
  replacementCost: overrides.replacementCost ?? 200000,
  photoUrls: overrides.photoUrls ?? [],
  openQuotes: overrides.openQuotes ?? 0,
  latestEstimatedFmv: overrides.latestEstimatedFmv ?? 140000,
});

describe("buildInventoryPressureBoard", () => {
  test("sorts assets into the four pressure lanes", () => {
    const board = buildInventoryPressureBoard(
      [
        ASSET({ id: "aged", createdAt: "2025-12-01T00:00:00Z" }),
        ASSET({ id: "hot", openQuotes: 2, photoUrls: ["x"] }),
        ASSET({ id: "on-order", availability: "on_order", photoUrls: ["x"] }),
        ASSET({ id: "under", currentMarketValue: null, photoUrls: [] }),
        ASSET({ id: "mis", currentMarketValue: 200000, latestEstimatedFmv: 140000, photoUrls: ["x"] }),
        ASSET({ id: "customer", ownership: "customer_owned" }),
      ],
      Date.parse("2026-04-10T00:00:00Z"),
    );

    expect(board.aged.map((row) => row.id)).toContain("aged");
    expect(board.hot.map((row) => row.id)).toContain("hot");
    expect(board.hot.map((row) => row.id)).toContain("on-order");
    expect(board.underMarketed.map((row) => row.id)).toContain("under");
    expect(board.priceMisaligned.map((row) => row.id)).toContain("mis");
    expect(board.aged.map((row) => row.id)).not.toContain("customer");
  });
});
