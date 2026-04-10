import { describe, expect, test } from "bun:test";
import {
  buildVisitPrepRequest,
  buildVisitPrimaryHref,
  normalizeVisitRecommendations,
} from "./visit-intelligence";

describe("visit intelligence helpers", () => {
  test("normalizes and sorts recommendations by priority", () => {
    const rows = normalizeVisitRecommendations([
      { company_name: "Bravo", priority_score: 20 },
      { company_name: "Alpha", priority_score: 80 },
      { company_name: "Charlie" },
    ]);

    expect(rows.map((row) => row.company_name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  test("prefers company prep requests over contact prep requests", () => {
    expect(
      buildVisitPrepRequest({
        company_name: "Acme Earthworks",
        contact_name: "Taylor Smith",
      }),
    ).toEqual({
      entity_type: "company",
      name: "Acme Earthworks",
    });
  });

  test("builds primary links to the best available entity", () => {
    expect(buildVisitPrimaryHref({ company_id: "company-1" })).toBe("/qrm/accounts/company-1/command");
    expect(buildVisitPrimaryHref({ contact_id: "contact-1" })).toBe("/qrm/contacts/contact-1");
    expect(buildVisitPrimaryHref({})).toBeNull();
  });
});
