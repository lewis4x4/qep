import { describe, expect, it } from "bun:test";
import { buildExceptionHandlingBoard } from "./exception-handling";

describe("buildExceptionHandlingBoard", () => {
  it("filters recent revival candidates and sorts each exception bucket", () => {
    const board = buildExceptionHandlingBoard({
      revivals: [
        { id: "deal-1", name: "Recent lost", amount: 120000, closedAt: "2026-04-09T10:00:00.000Z", lossReason: "Budget", competitor: "CAT" },
        { id: "deal-2", name: "Old lost", amount: 220000, closedAt: "2026-02-01T10:00:00.000Z", lossReason: "Price", competitor: null },
      ],
      failedDeliveries: [
        { id: "tt-1", stockNumber: "A100", status: "scheduled", promisedDeliveryAt: "2026-04-10T12:00:00.000Z", problemsReported: null, toLocation: "Site A" },
        { id: "tt-2", stockNumber: "A101", status: "being_shipped", promisedDeliveryAt: "2026-04-09T12:00:00.000Z", problemsReported: "Hydraulic issue", toLocation: "Site B" },
      ],
      damagedDemos: [
        { id: "insp-1", demoId: "demo-1", dealId: "deal-1", damageDescription: "Broken panel", completedAt: "2026-04-09T10:00:00.000Z" },
      ],
      rentalDisputes: [
        { id: "rr-1", equipmentId: "eq-1", status: "damage_assessment", refundStatus: "processing", chargeAmount: 900, damageDescription: "Bent fork" },
        { id: "rr-2", equipmentId: "eq-2", status: "decision_pending", refundStatus: "pending", chargeAmount: 1800, damageDescription: "Cracked panel" },
      ],
      paymentExceptions: [
        { id: "pv-1", amount: 1500, attemptOutcome: "requires_override", exceptionReason: "Delivery-day check", overrideReason: null, invoiceReference: "INV-1" },
        { id: "pv-2", amount: 800, attemptOutcome: "override_granted", exceptionReason: null, overrideReason: "Manager approved", invoiceReference: "INV-2" },
      ],
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(board.summary.revivalCount).toBe(1);
    expect(board.revivals[0]?.id).toBe("deal-1");
    expect(board.failedDeliveries[0]?.id).toBe("tt-2");
    expect(board.rentalDisputes[0]?.id).toBe("rr-2");
    expect(board.paymentExceptions[0]?.id).toBe("pv-1");
  });
});
