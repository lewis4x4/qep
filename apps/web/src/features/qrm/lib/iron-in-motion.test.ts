import { describe, expect, it } from "bun:test";
import { buildIronInMotionRegister, summarizeIronInMotion, type IronInMotionAsset } from "./iron-in-motion";

const baseAsset: IronInMotionAsset = {
  id: "eq-1",
  name: "CAT 310",
  make: "CAT",
  model: "310",
  year: 2024,
  availability: "reserved",
  ownership: "owned",
  locationDescription: "Memphis yard",
  createdAt: "2026-04-01T00:00:00.000Z",
  purchasePrice: 120_000,
  currentMarketValue: 115_000,
  replacementCost: 130_000,
  tickets: [],
};

describe("buildIronInMotionRegister", () => {
  it("keeps active movement items and scores overdue blocked units as high risk", () => {
    const items = buildIronInMotionRegister([
      {
        ...baseAsset,
        id: "eq-high",
        tickets: [
          {
            id: "ticket-1",
            status: "being_shipped",
            ticketType: "sale",
            fromLocation: "Memphis yard",
            toLocation: "Customer site",
            shippingDate: "2026-04-01",
            promisedDeliveryAt: "2026-04-09T12:00:00.000Z",
            blockerReason: "carrier issue",
            createdAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
      {
        ...baseAsset,
        id: "eq-low",
        tickets: [
          {
            id: "ticket-2",
            status: "scheduled",
            ticketType: "sale",
            fromLocation: "Memphis yard",
            toLocation: "Customer site",
            shippingDate: "2026-04-10",
            promisedDeliveryAt: "2026-04-12T12:00:00.000Z",
            blockerReason: null,
            createdAt: "2026-04-10T00:00:00.000Z",
          },
        ],
      },
    ], Date.parse("2026-04-10T12:00:00.000Z"));

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("eq-high");
    expect(items[0]?.riskLevel).toBe("high");
    expect(items[0]?.riskReasons.join(" | ")).toContain("carrier issue");
    expect(items[0]?.riskReasons.join(" | ")).toContain("delivery overdue");
    expect(items[1]?.riskLevel).toBe("low");
  });

  it("includes in-transit machines without a ticket and excludes yard inventory", () => {
    const items = buildIronInMotionRegister([
      {
        ...baseAsset,
        id: "eq-transit",
        availability: "in_transit",
        tickets: [],
      },
      {
        ...baseAsset,
        id: "eq-yard",
        availability: "available",
        tickets: [],
      },
      {
        ...baseAsset,
        id: "eq-customer",
        availability: "in_transit",
        ownership: "customer_owned",
        tickets: [],
      },
    ], Date.parse("2026-04-10T12:00:00.000Z"));

    expect(items.map((item) => item.id)).toEqual(["eq-transit"]);
    expect(items[0]?.riskLevel).toBe("high");
    expect(items[0]?.riskReasons).toContain("in transit without an active traffic ticket");
  });

  it("summarizes carrying and decay totals across the register", () => {
    const items = buildIronInMotionRegister([
      {
        ...baseAsset,
        id: "eq-summary-1",
        purchasePrice: 100_000,
        tickets: [
          {
            id: "ticket-a",
            status: "scheduled",
            ticketType: "sale",
            fromLocation: "Yard",
            toLocation: "Customer",
            shippingDate: "2026-04-09",
            promisedDeliveryAt: "2026-04-12T12:00:00.000Z",
            blockerReason: null,
            createdAt: "2026-04-09T00:00:00.000Z",
          },
        ],
      },
      {
        ...baseAsset,
        id: "eq-summary-2",
        purchasePrice: 200_000,
        availability: "in_transit",
        tickets: [],
      },
    ], Date.parse("2026-04-10T12:00:00.000Z"));

    const summary = summarizeIronInMotion(items);
    expect(summary.totalUnits).toBe(2);
    expect(summary.highRiskUnits).toBe(1);
    expect(summary.carryingCostPerDay).toBeGreaterThan(0);
    expect(summary.decayValuePerDay).toBeGreaterThan(0);
  });
});
