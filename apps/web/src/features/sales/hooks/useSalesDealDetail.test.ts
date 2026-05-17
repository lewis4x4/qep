import { describe, expect, test } from "bun:test";
import { adaptDealCompositeToSalesView } from "./useSalesDealDetail";
import type { DealCompositeBundle } from "@/features/qrm/lib/deal-composite-api";

function buildBundle(
  overrides: Partial<DealCompositeBundle> = {},
): DealCompositeBundle {
  return {
    deal: {
      id: "deal-1",
      workspaceId: "ws-1",
      name: "JD 9R Replacement",
      stageId: "stage-decision",
      primaryContactId: "ct-1",
      companyId: "co-1",
      assignedRepId: "rep-1",
      amount: 480_000,
      expectedCloseOn: null,
      nextFollowUpAt: "2026-06-01T10:00:00Z",
      lastActivityAt: "2026-05-15T09:00:00Z",
      closedAt: null,
      hubspotDealId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-05-15T09:00:00Z",
      slaDeadlineAt: null,
      depositStatus: null,
      depositAmount: null,
      sortPosition: null,
      marginPct: 12.4,
      pendingQuoteApproval: false,
    },
    contact: {
      id: "ct-1",
      workspaceId: "ws-1",
      dgeCustomerProfileId: null,
      firstName: "Pat",
      lastName: "Operator",
      email: "pat@farm.example",
      phone: "+1-208-555-0001",
      cell: "+1-208-555-0002",
      directPhone: null,
      birthDate: null,
      smsOptIn: null,
      title: null,
      primaryCompanyId: "co-1",
      assignedRepId: "rep-1",
      mergedIntoContactId: null,
      sourceCustomerNumber: null,
      preferredContactMethod: null,
      preferredLanguage: null,
      address: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      notes: null,
      tags: [],
      role: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-05-15T09:00:00Z",
    } as DealCompositeBundle["contact"],
    company: {
      id: "co-1",
      workspaceId: "ws-1",
      name: "Snake River AG",
      parentCompanyId: null,
      assignedRepId: "rep-1",
      legacyCustomerNumber: null,
      status: null,
      productCategory: "business",
      arType: null,
      paymentTermsCode: null,
      termsCode: null,
      territoryCode: null,
      pricingLevel: null,
      doNotContact: null,
      optOutSalePi: null,
      search1: null,
      search2: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-05-15T09:00:00Z",
    },
    needsAssessment: null,
    cadences: [],
    demos: [],
    activities: [
      {
        id: "act-1",
        workspaceId: "ws-1",
        activityType: "call" as DealCompositeBundle["activities"][number]["activityType"],
        body: "Connected with Pat. Wants pricing on 9R 540.",
        occurredAt: "2026-05-15T09:00:00Z",
        contactId: "ct-1",
        companyId: "co-1",
        dealId: "deal-1",
        createdBy: "rep-1",
        metadata: {},
        createdAt: "2026-05-15T09:00:00Z",
        updatedAt: "2026-05-15T09:00:00Z",
      },
    ],
    lossFields: {
      lostReason: null,
      lostNotes: null,
      lostAt: null,
      competitorId: null,
    } as DealCompositeBundle["lossFields"],
    ...overrides,
  };
}

describe("adaptDealCompositeToSalesView", () => {
  test("projects a deal bundle into the sales-rep view shape", () => {
    const view = adaptDealCompositeToSalesView(buildBundle());
    expect(view.dealId).toBe("deal-1");
    expect(view.name).toBe("JD 9R Replacement");
    expect(view.amount).toBe(480_000);
    expect(view.marginPct).toBe(12.4);
    expect(view.customer.id).toBe("co-1");
    expect(view.customer.name).toBe("Snake River AG");
    expect(view.customer.email).toBe("pat@farm.example");
    expect(view.activities).toHaveLength(1);
    expect(view.lastActivity?.id).toBe("act-1");
  });

  test("prefers cell over direct/phone for tappable tel:", () => {
    const view = adaptDealCompositeToSalesView(buildBundle());
    expect(view.customer.phone).toBe("+1-208-555-0002");
  });

  test("falls back to contact name when company is missing", () => {
    const view = adaptDealCompositeToSalesView(
      buildBundle({ company: null }),
    );
    expect(view.customer.name).toBe("Pat Operator");
    expect(view.customer.id).toBeNull();
  });

  test("returns 'Customer' as a last resort", () => {
    const view = adaptDealCompositeToSalesView(
      buildBundle({ company: null, contact: null }),
    );
    expect(view.customer.name).toBe("Customer");
  });

  test("handles a deal with no activities", () => {
    const view = adaptDealCompositeToSalesView(
      buildBundle({ activities: [] }),
    );
    expect(view.activities).toEqual([]);
    expect(view.lastActivity).toBeNull();
  });
});
