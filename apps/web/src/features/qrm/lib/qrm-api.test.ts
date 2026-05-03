import { describe, expect, it } from "bun:test";
import {
  normalizeActivityRows,
  normalizeActivityTemplateRows,
  normalizeCompanyRows,
  normalizeContactRows,
} from "./qrm-api";

describe("qrm shared api row normalizers", () => {
  it("normalizes contact rows with IntelliDealer metadata", () => {
    expect(normalizeContactRows([
      {
        id: "contact-1",
        workspace_id: "",
        dge_customer_profile_id: null,
        first_name: "Ava",
        last_name: "Fields",
        email: "ava@example.com",
        phone: 42,
        cell: "555-0101",
        direct_phone: null,
        birth_date: null,
        sms_opt_in: true,
        title: "Owner",
        primary_company_id: "company-1",
        assigned_rep_id: null,
        merged_into_contact_id: null,
        metadata: {
          source_customer_number: "C100",
          source_contact_number: "CT200",
          status_code: "A",
          salesperson_code: "SP1",
          mydealer_user: "ava.fields",
        },
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
      { first_name: "Bad" },
    ])).toEqual([
      {
        id: "contact-1",
        workspaceId: "default",
        dgeCustomerProfileId: null,
        firstName: "Ava",
        lastName: "Fields",
        email: "ava@example.com",
        phone: null,
        cell: "555-0101",
        directPhone: null,
        birthDate: null,
        smsOptIn: true,
        title: "Owner",
        primaryCompanyId: "company-1",
        assignedRepId: null,
        mergedIntoContactId: null,
        sourceCustomerNumber: "C100",
        sourceContactNumber: "CT200",
        sourceStatusCode: "A",
        sourceSalespersonCode: "SP1",
        myDealerUser: "ava.fields",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    ]);
  });

  it("normalizes company rows and filters invalid enum values", () => {
    expect(normalizeCompanyRows([
      {
        id: "company-1",
        workspace_id: "workspace-1",
        name: "",
        parent_company_id: null,
        assigned_rep_id: "rep-1",
        legacy_customer_number: "C100",
        status: "active",
        product_category: "business",
        ar_type: "invalid",
        payment_terms_code: "NET30",
        terms_code: null,
        territory_code: "T1",
        pricing_level: Number.NaN,
        do_not_contact: false,
        opt_out_sale_pi: true,
        search_1: "FIELD",
        search_2: null,
        address_line_1: "100 Main",
        address_line_2: null,
        city: "Louisville",
        state: "KY",
        postal_code: "40202",
        country: "US",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
    ])[0]).toMatchObject({
      id: "company-1",
      workspaceId: "workspace-1",
      name: "Unnamed company",
      productCategory: "business",
      arType: null,
      pricingLevel: null,
      legacyCustomerNumber: "C100",
    });
  });

  it("normalizes activities and templates", () => {
    expect(normalizeActivityRows([
      {
        id: "activity-1",
        workspace_id: "workspace-1",
        activity_type: "bad",
        body: "Call customer",
        occurred_at: "2026-04-03T00:00:00.000Z",
        contact_id: "contact-1",
        company_id: "company-1",
        deal_id: null,
        created_by: "rep-1",
        metadata: ["bad"],
        created_at: "2026-04-03T00:00:00.000Z",
        updated_at: "2026-04-03T00:00:00.000Z",
      },
    ])[0]).toMatchObject({
      id: "activity-1",
      activityType: "note",
      metadata: {},
    });

    expect(normalizeActivityTemplateRows([
      {
        id: "template-1",
        activity_type: "task",
        label: "",
        description: null,
        body: "Follow up",
        task_due_minutes: 1440,
        task_status: "completed",
        sort_order: Number.NaN,
        is_active: true,
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
    ])[0]).toMatchObject({
      id: "template-1",
      activityType: "task",
      label: "Untitled template",
      description: "",
      taskDueMinutes: 1440,
      taskStatus: "completed",
      sortOrder: 0,
      source: "workspace",
      isActive: true,
    });
  });

  it("returns empty lists for non-array payloads", () => {
    expect(normalizeContactRows(null)).toEqual([]);
    expect(normalizeCompanyRows({ id: "company-1" })).toEqual([]);
    expect(normalizeActivityRows(undefined)).toEqual([]);
    expect(normalizeActivityTemplateRows("bad")).toEqual([]);
  });
});
