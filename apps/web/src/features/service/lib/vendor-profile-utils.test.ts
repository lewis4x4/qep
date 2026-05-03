import { describe, expect, test } from "bun:test";
import {
  joinedVendorName,
  normalizeVendorAccessKeyRows,
  normalizeVendorPolicyRows,
  normalizeVendorPriceRows,
  normalizeVendorRows,
  normalizeVendorSubmissionRows,
} from "./vendor-profile-utils";

describe("vendor profile row normalizers", () => {
  test("normalizes vendor rows and defaults unknown supplier types", () => {
    expect(normalizeVendorRows([
      {
        id: "vendor-1",
        name: "Reliable Parts",
        supplier_type: "oem",
        avg_lead_time_hours: "24",
        responsiveness_score: "98.5",
        notes: "Preferred",
      },
      {
        id: "vendor-2",
        name: "Fallback Supplier",
        supplier_type: "unknown",
      },
      {
        id: "",
        name: "Bad vendor",
      },
    ])).toEqual([
      {
        id: "vendor-1",
        name: "Reliable Parts",
        supplier_type: "oem",
        avg_lead_time_hours: 24,
        responsiveness_score: 98.5,
        notes: "Preferred",
      },
      {
        id: "vendor-2",
        name: "Fallback Supplier",
        supplier_type: "general",
        avg_lead_time_hours: null,
        responsiveness_score: null,
        notes: null,
      },
    ]);
  });

  test("normalizes escalation policy rows", () => {
    expect(normalizeVendorPolicyRows([
      { id: "policy-1", name: "Machine down", steps: [{ after_hours: 4 }], is_machine_down: true },
      { id: "bad-flag", name: "Bad", steps: [], is_machine_down: "true" },
    ])).toEqual([
      { id: "policy-1", name: "Machine down", steps: [{ after_hours: 4 }], is_machine_down: true },
    ]);
  });

  test("normalizes portal access key rows and joined vendors", () => {
    const rows = normalizeVendorAccessKeyRows([
      {
        id: "key-1",
        vendor_id: "vendor-1",
        label: "May updates",
        contact_name: "Vera Vendor",
        contact_email: "vera@example.com",
        expires_at: "2026-06-01T00:00:00.000Z",
        revoked_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        vendor_profiles: [{ name: "Reliable Parts" }],
      },
      { id: "missing-vendor", created_at: "2026-05-01T00:00:00.000Z" },
    ]);

    expect(rows).toEqual([
      {
        id: "key-1",
        vendor_id: "vendor-1",
        label: "May updates",
        contact_name: "Vera Vendor",
        contact_email: "vera@example.com",
        expires_at: "2026-06-01T00:00:00.000Z",
        revoked_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        vendor_profiles: { name: "Reliable Parts" },
      },
    ]);
    expect(joinedVendorName(rows[0]?.vendor_profiles)).toBe("Reliable Parts");
    expect(joinedVendorName(null)).toBe("Vendor");
  });

  test("normalizes vendor submissions and filters invalid statuses/prices", () => {
    expect(normalizeVendorSubmissionRows([
      {
        id: "submission-1",
        vendor_id: "vendor-1",
        part_number: "PN-100",
        description: "Filter",
        proposed_list_price: "15.25",
        currency: "USD",
        effective_date: "2026-05-01",
        submission_notes: "New price",
        submitted_by_name: "Vera",
        submitted_by_email: "vera@example.com",
        status: "pending",
        review_notes: null,
        reviewed_at: null,
        vendor_profiles: { name: "Reliable Parts" },
      },
      {
        id: "bad-status",
        vendor_id: "vendor-1",
        part_number: "PN-101",
        proposed_list_price: "10",
        currency: "USD",
        effective_date: "2026-05-01",
        status: "new",
      },
      {
        id: "bad-price",
        vendor_id: "vendor-1",
        part_number: "PN-102",
        proposed_list_price: "bad",
        currency: "USD",
        effective_date: "2026-05-01",
        status: "pending",
      },
    ])).toEqual([
      {
        id: "submission-1",
        vendor_id: "vendor-1",
        part_number: "PN-100",
        description: "Filter",
        proposed_list_price: 15.25,
        currency: "USD",
        effective_date: "2026-05-01",
        submission_notes: "New price",
        submitted_by_name: "Vera",
        submitted_by_email: "vera@example.com",
        status: "pending",
        review_notes: null,
        reviewed_at: null,
        vendor_profiles: { name: "Reliable Parts" },
      },
    ]);
  });

  test("normalizes vendor price rows", () => {
    expect(normalizeVendorPriceRows([
      {
        id: "price-1",
        vendor_id: "vendor-1",
        part_number: "PN-100",
        description: "Filter",
        list_price: "14.75",
        currency: "USD",
        effective_date: "2026-05-01",
      },
      {
        id: "missing-part",
        vendor_id: "vendor-1",
        currency: "USD",
        effective_date: "2026-05-01",
      },
    ])).toEqual([
      {
        id: "price-1",
        vendor_id: "vendor-1",
        part_number: "PN-100",
        description: "Filter",
        list_price: 14.75,
        currency: "USD",
        effective_date: "2026-05-01",
      },
    ]);
  });

  test("returns empty arrays for non-array inputs", () => {
    expect(normalizeVendorRows(null)).toEqual([]);
    expect(normalizeVendorPolicyRows({ id: "policy-1" })).toEqual([]);
    expect(normalizeVendorAccessKeyRows(undefined)).toEqual([]);
    expect(normalizeVendorSubmissionRows("bad")).toEqual([]);
    expect(normalizeVendorPriceRows(null)).toEqual([]);
  });
});
