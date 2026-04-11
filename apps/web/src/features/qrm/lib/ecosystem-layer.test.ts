import { describe, expect, it } from "bun:test";
import { buildEcosystemLayerBoard } from "./ecosystem-layer";

describe("buildEcosystemLayerBoard", () => {
  it("turns lender, coverage, transport, OEM, and auction signals into one ecosystem board", () => {
    const board = buildEcosystemLayerBoard({
      accountId: "company-1",
      amountAnchor: 85000,
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
      assessments: [
        {
          dealId: "deal-1",
          financingPreference: "finance",
          monthlyPaymentTarget: 3200,
          brandPreference: "CAT",
          budgetType: "monthly_payment",
        },
      ],
      financeRates: [
        {
          lenderName: "DLL",
          creditTier: "A",
          ratePct: 4.9,
          termMonths: 60,
          minAmount: 20000,
          maxAmount: 150000,
          expiryDate: "2026-05-01T00:00:00.000Z",
        },
      ],
      coverage: [
        {
          equipmentId: "eq-1",
          label: "CAT 259D",
          warrantyExpiry: "2026-06-01T00:00:00.000Z",
          warrantyType: "powertrain",
          nextServiceDue: "2026-04-20T00:00:00.000Z",
        },
      ],
      transport: [
        {
          id: "tt-1",
          dealId: "deal-1",
          status: "scheduled",
          shippingDate: "2026-04-10T00:00:00.000Z",
          promisedDeliveryAt: "2026-04-09T00:00:00.000Z",
          blockerReason: "carrier capacity",
          lateReason: null,
          ticketType: "delivery",
        },
      ],
      oemSignals: [
        {
          oemName: "CAT",
          programName: "Spring APR",
          endDate: "2026-04-25T00:00:00.000Z",
          requiresApproval: true,
          discountType: "rate_buydown",
          discountValue: 1.5,
        },
      ],
      auctionSignals: [
        {
          make: "CAT",
          model: "259D",
          year: 2021,
          auctionDate: "2026-03-30T00:00:00.000Z",
          hammerPrice: 64500,
          location: "Atlanta",
        },
      ],
    });

    expect(board.summary.lenderLanes).toBe(1);
    expect(board.summary.coverageAlerts).toBe(1);
    expect(board.summary.transportMoves).toBe(1);
    expect(board.summary.marketSignals).toBe(2);
    expect(board.finance[0]?.title).toContain("DLL");
    expect(board.coverage[0]?.trace.join(" ")).toContain("Warranty expires");
    expect(board.transport[0]?.confidence).toBe("high");
    expect(board.market[0]?.href).toBe("/admin/incentives");
  });

  it("falls back cleanly when ecosystem signals are sparse", () => {
    const board = buildEcosystemLayerBoard({
      accountId: "company-1",
      amountAnchor: null,
      assessments: [],
      financeRates: [],
      coverage: [],
      transport: [],
      oemSignals: [],
      auctionSignals: [],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.lenderLanes).toBe(0);
    expect(board.summary.coverageAlerts).toBe(0);
    expect(board.finance).toHaveLength(0);
    expect(board.market).toHaveLength(0);
  });
});
