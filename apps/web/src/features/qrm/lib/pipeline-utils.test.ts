import { describe, expect, it } from "bun:test";
import { normalizeCachedOpenDealsPayload, readCachedOpenDeals, writeCachedOpenDeals, PIPELINE_CACHE_KEY } from "./pipeline-utils";

const validCachedDeal = {
  id: "deal-1",
  workspaceId: "workspace-1",
  name: "Compact loader",
  stageId: "stage-1",
  primaryContactId: null,
  companyId: "company-1",
  assignedRepId: "rep-1",
  amount: 125000,
  expectedCloseOn: "2026-05-15",
  nextFollowUpAt: "2026-05-05T14:00:00.000Z",
  lastActivityAt: null,
  closedAt: null,
  hubspotDealId: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  slaDeadlineAt: null,
  depositStatus: "received",
  depositAmount: 5000,
  sortPosition: 10,
  marginPct: 18.5,
  pendingQuoteApproval: false,
};

describe("pipeline cache normalizers", () => {
  it("keeps valid cached deals and drops malformed entries", () => {
    expect(normalizeCachedOpenDealsPayload({
      items: [
        validCachedDeal,
        { ...validCachedDeal, id: "" },
        { ...validCachedDeal, amount: Number.NaN, id: "deal-2" },
      ],
      nextCursor: "cursor-1",
    })).toEqual({
      items: [
        validCachedDeal,
        { ...validCachedDeal, amount: null, id: "deal-2" },
      ],
      nextCursor: "cursor-1",
    });
  });

  it("rejects non-object or missing item containers", () => {
    expect(normalizeCachedOpenDealsPayload(null)).toBeNull();
    expect(normalizeCachedOpenDealsPayload({ items: {} })).toBeNull();
  });
});


it("pipeline snapshots never cross actor/workspace scope or trust legacy unscoped cache", () => {
  localStorage.clear();
  const snapshot = { items: [validCachedDeal], nextCursor: "unfinished-page" };
  localStorage.setItem(PIPELINE_CACHE_KEY, JSON.stringify(snapshot));
  expect(readCachedOpenDeals("rep-a:workspace-1:rep")).toBeNull();
  writeCachedOpenDeals(snapshot, "rep-a:workspace-1:rep");
  expect(readCachedOpenDeals("rep-b:workspace-1:rep")).toBeNull();
  expect(readCachedOpenDeals("rep-a:workspace-2:rep")).toBeNull();
  expect(readCachedOpenDeals("rep-a:workspace-1:rep")?.nextCursor).toBe("unfinished-page");
});
