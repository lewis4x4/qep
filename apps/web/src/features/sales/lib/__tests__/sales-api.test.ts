import { describe, expect, test } from "bun:test";
import {
  buildSalesActivityInsertPayload,
  resolveSalesActivitySubject,
} from "../sales-api";

describe("sales activity payload helpers", () => {
  test("enforces subject precedence (deal > company > contact)", () => {
    expect(
      resolveSalesActivitySubject({
        dealId: "deal-1",
        companyId: "company-1",
        contactId: "contact-1",
      }),
    ).toEqual({ deal_id: "deal-1", company_id: null, contact_id: null });

    expect(
      resolveSalesActivitySubject({ companyId: "company-1", contactId: "contact-1" }),
    ).toEqual({ deal_id: null, company_id: "company-1", contact_id: null });

    expect(resolveSalesActivitySubject({ contactId: "contact-1" })).toEqual({
      deal_id: null,
      company_id: null,
      contact_id: "contact-1",
    });
  });

  test("rejects a missing activity subject before insert payload creation", () => {
    expect(() => resolveSalesActivitySubject({})).toThrow(
      "A company, deal, or contact subject is required",
    );
  });

  test("builds RLS-safe insert payload with created_by and exactly one subject", () => {
    const payload = buildSalesActivityInsertPayload({
      workspaceId: "ws-1",
      userId: "rep-1",
      activityType: "call",
      body: "Called customer",
      subject: { companyId: "company-1", dealId: "deal-1" },
    });

    expect(payload.workspace_id).toBe("ws-1");
    expect(payload.created_by).toBe("rep-1");
    expect(payload.activity_type).toBe("call");
    expect(payload.deal_id).toBe("deal-1");
    expect(payload.company_id).toBeNull();
    expect(payload.contact_id).toBeNull();
    expect(payload.metadata).toMatchObject({ source: "sales_companion" });
    expect(typeof payload.occurred_at).toBe("string");
  });

  test("maps visit logs to meeting activity inserts and preserves caller metadata", () => {
    const payload = buildSalesActivityInsertPayload({
      workspaceId: "ws-1",
      userId: "rep-1",
      activityType: "visit",
      body: "Visited customer",
      subject: { companyId: "company-1" },
      metadata: { outcome: "demo" },
    });

    expect(payload.activity_type).toBe("meeting");
    expect(payload.company_id).toBe("company-1");
    expect(payload.deal_id).toBeNull();
    expect(payload.contact_id).toBeNull();
    expect(payload.metadata).toEqual({ source: "sales_companion", outcome: "demo" });
  });
});
