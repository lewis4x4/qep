import { describe, expect, it } from "bun:test";
import { normalizeQuoteRows } from "./qrm-quotes-api";

describe("qrm quote row normalizers", () => {
  it("normalizes quote rows and filters malformed records", () => {
    expect(normalizeQuoteRows([
      {
        id: "quote-1",
        workspace_id: "",
        created_by: "rep-1",
        crm_contact_id: "contact-1",
        crm_deal_id: null,
        status: "bad",
        title: "Parts quote",
        line_items: [{ sku: "A1", quantity: 2 }],
        customer_snapshot: { customerNumber: "C100" },
        metadata: ["bad"],
        linked_at: null,
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
        deleted_at: null,
      },
      { id: null },
    ])).toEqual([
      {
        id: "quote-1",
        workspaceId: "default",
        createdBy: "rep-1",
        crmContactId: "contact-1",
        crmDealId: null,
        status: "draft",
        title: "Parts quote",
        lineItems: [{ sku: "A1", quantity: 2 }],
        customerSnapshot: { customerNumber: "C100" },
        metadata: {},
        linkedAt: null,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
        deletedAt: null,
      },
    ]);
  });

  it("returns empty lists for non-array payloads", () => {
    expect(normalizeQuoteRows(null)).toEqual([]);
    expect(normalizeQuoteRows({ id: "quote-1" })).toEqual([]);
  });
});
