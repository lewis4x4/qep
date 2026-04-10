import { describe, expect, test } from "bun:test";
import { computeTerritoryVisitPriorities } from "./territory-command";

describe("computeTerritoryVisitPriorities", () => {
  test("ranks high-pressure territory accounts first", () => {
    const result = computeTerritoryVisitPriorities({
      contacts: [
        { id: "contact-1", first_name: "Ryan", last_name: "Smith", primary_company_id: "company-1" },
        { id: "contact-2", first_name: "Anna", last_name: "Jones", primary_company_id: "company-2" },
      ],
      companies: [
        { id: "company-1", name: "Acme Earthworks" },
        { id: "company-2", name: "Blue Ridge Sitework" },
      ],
      deals: [
        {
          id: "deal-1",
          name: "Wheel loader",
          company_id: "company-1",
          primary_contact_id: "contact-1",
          amount: 120000,
          expected_close_on: "2026-04-18T00:00:00Z",
          next_follow_up_at: "2026-04-08T00:00:00Z",
        },
      ],
      activities: [
        { occurred_at: "2026-03-20T00:00:00Z", company_id: "company-1", contact_id: null },
        { occurred_at: "2026-04-09T00:00:00Z", company_id: "company-2", contact_id: null },
      ],
      nowTime: Date.parse("2026-04-10T00:00:00Z"),
    });

    expect(result.summary).toEqual({
      contactCount: 2,
      accountCount: 2,
      openDealCount: 1,
      overdueFollowUps: 1,
      highPriorityCount: 1,
    });

    expect(result.rows[0]).toMatchObject({
      companyId: "company-1",
      companyName: "Acme Earthworks",
      openDealCount: 1,
      overdueFollowUps: 1,
      closingSoonCount: 1,
    });
    expect(result.rows[0]?.priorityScore).toBeGreaterThan(result.rows[1]?.priorityScore ?? 0);
  });
});
