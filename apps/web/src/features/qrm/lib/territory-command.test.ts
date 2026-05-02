import { describe, expect, test } from "bun:test";
import {
  computeTerritoryVisitPriorities,
  extractTerritoryCompanyIds,
  normalizeTerritoryActivityRows,
  normalizeTerritoryCompanyRows,
  normalizeTerritoryContactRows,
  normalizeTerritoryDealRows,
  normalizeTerritoryLinkRows,
  normalizeTerritoryRow,
} from "./territory-command";

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

describe("territory row normalizers", () => {
  test("normalizes optional territory fields and rejects missing ids", () => {
    expect(normalizeTerritoryRow({ id: "territory-1", name: "", description: 42, assigned_rep_id: "rep-1" })).toEqual({
      id: "territory-1",
      name: "Unnamed territory",
      description: null,
      assigned_rep_id: "rep-1",
    });
    expect(normalizeTerritoryRow({ name: "No id" })).toBeNull();
  });

  test("dedupes link and company ids from raw rows", () => {
    expect(normalizeTerritoryLinkRows([
      { contact_id: "contact-1" },
      { contact_id: "contact-1" },
      { contact_id: null },
      "bad",
    ])).toEqual([{ contact_id: "contact-1" }]);

    expect(extractTerritoryCompanyIds([
      { primary_company_id: "company-1" },
      { primary_company_id: "company-1" },
      { primary_company_id: "" },
      null,
    ])).toEqual(["company-1"]);
  });

  test("normalizes territory query rows before scoring", () => {
    expect(normalizeTerritoryContactRows([
      { id: "contact-1", first_name: null, last_name: "Jones", primary_company_id: "company-1" },
      { id: null },
    ])).toEqual([
      { id: "contact-1", first_name: "", last_name: "Jones", primary_company_id: "company-1" },
    ]);

    expect(normalizeTerritoryCompanyRows([{ id: "company-1", name: "" }, {}])).toEqual([
      { id: "company-1", name: "Unnamed account" },
    ]);

    expect(normalizeTerritoryDealRows([
      { id: "deal-1", name: "", company_id: "company-1", primary_contact_id: 7, amount: Number.NaN },
    ])).toEqual([
      {
        id: "deal-1",
        name: "Unnamed deal",
        company_id: "company-1",
        primary_contact_id: null,
        amount: null,
        expected_close_on: null,
        next_follow_up_at: null,
      },
    ]);

    expect(normalizeTerritoryActivityRows([
      { occurred_at: "2026-04-10T00:00:00Z", company_id: "company-1", contact_id: 3 },
      { company_id: "company-2" },
    ])).toEqual([
      { occurred_at: "2026-04-10T00:00:00Z", company_id: "company-1", contact_id: null },
    ]);
  });
});
