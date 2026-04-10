import { describe, expect, it } from "bun:test";
import {
  buildRentalCommandCenter,
  type RentalFleetUnit,
  type RentalReturnCase,
  type RentalTrafficTicket,
} from "./rental-command";

const units: RentalFleetUnit[] = [
  {
    id: "rent-1",
    name: "Bobcat T66",
    make: "Bobcat",
    model: "T66",
    year: 2024,
    availability: "rented",
    locationDescription: "Customer site",
    dailyRentalRate: 450,
    currentMarketValue: 64000,
  },
  {
    id: "rent-2",
    name: "JLG 450AJ",
    make: "JLG",
    model: "450AJ",
    year: 2023,
    availability: "available",
    locationDescription: "Memphis yard",
    dailyRentalRate: 390,
    currentMarketValue: 58000,
  },
  {
    id: "rent-3",
    name: "CAT 308",
    make: "CAT",
    model: "308",
    year: 2022,
    availability: "in_service",
    locationDescription: "Service bay",
    dailyRentalRate: 520,
    currentMarketValue: 82000,
  },
];

const returns: RentalReturnCase[] = [
  {
    id: "rr-1",
    equipmentId: "rent-3",
    status: "work_order_open",
    chargeAmount: 1800,
    hasCharges: true,
    agingBucket: "8-14d",
    workOrderNumber: "WO-100",
    createdAt: "2026-04-01T00:00:00.000Z",
  },
];

const tickets: RentalTrafficTicket[] = [
  {
    id: "tt-1",
    equipmentId: "rent-1",
    status: "scheduled",
    ticketType: "rental",
    toLocation: "Customer site",
    promisedDeliveryAt: "2026-04-11T12:00:00.000Z",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
  {
    id: "tt-2",
    equipmentId: "rent-2",
    status: "haul_pending",
    ticketType: "re_rent",
    toLocation: "Nashville branch",
    promisedDeliveryAt: null,
    createdAt: "2026-04-09T00:00:00.000Z",
  },
];

describe("buildRentalCommandCenter", () => {
  it("summarizes fleet utilization and exposure", () => {
    const center = buildRentalCommandCenter(units, returns, tickets, Date.parse("2026-04-10T12:00:00.000Z"));

    expect(center.summary.totalFleet).toBe(3);
    expect(center.summary.onRentCount).toBe(1);
    expect(center.summary.readyCount).toBe(1);
    expect(center.summary.recoveryCount).toBe(1);
    expect(center.summary.returnsInFlight).toBe(1);
    expect(center.summary.motionCount).toBe(2);
    expect(center.summary.motionRiskCount).toBe(2);
    expect(center.summary.dailyRevenueInPlay).toBe(450);
    expect(center.summary.chargeExposure).toBe(1800);
  });

  it("sorts return queue by aging and tags motion risk", () => {
    const center = buildRentalCommandCenter(
      units,
      [
        ...returns,
        {
          id: "rr-2",
          equipmentId: "rent-1",
          status: "decision_pending",
          chargeAmount: null,
          hasCharges: false,
          agingBucket: "15+d",
          workOrderNumber: null,
          createdAt: "2026-04-02T00:00:00.000Z",
        },
      ],
      [
        ...tickets,
        {
          id: "tt-3",
          equipmentId: "rent-3",
          status: "scheduled",
          ticketType: "rental",
          toLocation: "Customer site",
          promisedDeliveryAt: "2026-04-10T08:00:00.000Z",
          createdAt: "2026-04-09T00:00:00.000Z",
        },
      ],
      Date.parse("2026-04-10T12:00:00.000Z"),
    );

    expect(center.returnQueue[0]?.id).toBe("rr-2");
    expect(center.motionQueue[0]?.id).toBe("tt-3");
    expect(center.motionQueue[0]?.riskLevel).toBe("high");
  });
});
