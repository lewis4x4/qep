import { describe, expect, it } from "bun:test";
import { buildPostSaleExperienceBoard } from "./post-sale-experience";

describe("buildPostSaleExperienceBoard", () => {
  it("scores first-90-day friction using service, documents, and attachment gaps", () => {
    const board = buildPostSaleExperienceBoard({
      fleet: [
        {
          companyId: "company-1",
          companyName: "Acme",
          fleetId: "fleet-1",
          equipmentId: "eq-1",
          purchaseDate: "2026-03-20T00:00:00.000Z",
          nextServiceDue: "2026-04-05T00:00:00.000Z",
          warrantyExpiry: "2027-03-20",
          attachmentCount: 0,
        },
        {
          companyId: "company-1",
          companyName: "Acme",
          fleetId: "fleet-2",
          equipmentId: "eq-2",
          purchaseDate: "2026-03-28T00:00:00.000Z",
          nextServiceDue: null,
          warrantyExpiry: "2027-03-28",
          attachmentCount: 2,
        },
      ],
      service: [
        { companyId: "company-1", machineId: "eq-1", currentStage: "in_progress", createdAt: "2026-04-01T00:00:00.000Z" },
      ],
      documents: [
        { companyId: "company-1", fleetId: "fleet-1", equipmentId: "eq-1", documentType: "operator_manual" },
      ],
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(board.summary.accounts).toBe(1);
    expect(board.summary.recentUnits).toBe(2);
    expect(board.summary.frictionAccounts).toBe(1);
    expect(board.summary.documentGapUnits).toBe(1);
    expect(board.summary.attachmentGapUnits).toBe(1);
    expect(board.accounts[0]?.companyId).toBe("company-1");
    expect(board.accounts[0]?.serviceTouches).toBe(1);
    expect(board.accounts[0]?.openServiceTouches).toBe(1);
    expect(board.accounts[0]?.overdueDueCount).toBe(1);
    expect(board.accounts[0]?.docCoverageCount).toBe(1);
    expect(board.accounts[0]?.attachmentGapCount).toBe(1);
  });
});
