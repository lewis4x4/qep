import { describe, expect, test } from "bun:test";
import {
  formatVendorPurchaseOrderStatus,
  formatVendorPurchaseOrderType,
  nextVendorPurchaseOrderStatuses,
  normalizePurchaseOrderAttachments,
  normalizePurchaseOrderEquipmentModels,
  normalizePurchaseOrderHeader,
  normalizePurchaseOrderLines,
  normalizePurchaseOrderRows,
  normalizePurchaseOrderTouchpoints,
  normalizeVendorOptionRows,
  sumVendorPurchaseOrderLines,
} from "./purchase-order-utils";

describe("purchase-order-utils", () => {
  test("formats statuses for the UI", () => {
    expect(formatVendorPurchaseOrderStatus("waiting_authorization")).toBe("Waiting for Authorization");
    expect(formatVendorPurchaseOrderStatus("po_requested")).toBe("PO Request");
  });

  test("formats types for the UI", () => {
    expect(formatVendorPurchaseOrderType("equipment_replenishment")).toBe("Equipment Replenishment");
  });

  test("returns valid next statuses", () => {
    expect(nextVendorPurchaseOrderStatuses("authorized")).toEqual(["on_order", "canceled"]);
    expect(nextVendorPurchaseOrderStatuses("completed")).toEqual([]);
  });

  test("sums extended cost in cents", () => {
    expect(sumVendorPurchaseOrderLines([
      { quantity: 2, unit_cost_cents: 5000 },
      { quantity: 1, unit_cost_cents: 1250 },
    ])).toBe(11250);
  });

  test("normalizes vendor picker rows", () => {
    expect(normalizeVendorOptionRows([
      { id: "vendor-1", name: "Vendor" },
      { id: "", name: "bad" },
    ])).toEqual([{ id: "vendor-1", name: "Vendor" }]);
  });

  test("normalizes purchase order list rows with joined vendors", () => {
    expect(normalizePurchaseOrderRows([
      {
        id: "po-1",
        po_number: "PO-100",
        order_type: "bad",
        status: "bad",
        description: "Equipment",
        location_code: "01",
        vendor_id: "vendor-1",
        created_at: "2026-05-03T12:00:00Z",
        vendor_profiles: [{ name: "Vendor" }],
      },
      { id: "bad", po_number: "missing vendor" },
    ])).toEqual([
      {
        id: "po-1",
        po_number: "PO-100",
        order_type: "miscellaneous",
        status: "po_requested",
        description: "Equipment",
        location_code: "01",
        vendor_id: "vendor-1",
        created_at: "2026-05-03T12:00:00Z",
        vendor_profiles: { name: "Vendor" },
      },
    ]);
  });

  test("normalizes purchase order detail header rows", () => {
    expect(normalizePurchaseOrderHeader({
      id: "po-1",
      po_number: "PO-100",
      vendor_id: "vendor-1",
      order_type: "equipment",
      status: "authorized",
      location_code: "01",
      description: "Equipment",
      crm_company_id: "co-1",
      order_comments: "comment",
      shipping_contact_name: "Dock",
      shipping_address_line_1: "1 Main",
      shipping_address_line_2: "Suite 2",
      shipping_city: "Louisville",
      shipping_state: "KY",
      shipping_postal_code: "40202",
      shipping_country: "US",
      shipping_method: "LTL",
      shipping_charge_cents: "12500",
      delivery_notes: "call",
      terms_and_conditions: "net 30",
      long_description: "long",
      authorized_at: "2026-05-03",
      ordered_at: null,
      completed_at: null,
      created_at: "2026-05-03T12:00:00Z",
      vendor_profiles: { name: "Vendor" },
      crm_companies: [{ name: "Customer" }],
    })).toEqual({
      id: "po-1",
      po_number: "PO-100",
      vendor_id: "vendor-1",
      order_type: "equipment",
      status: "authorized",
      location_code: "01",
      description: "Equipment",
      crm_company_id: "co-1",
      order_comments: "comment",
      shipping_contact_name: "Dock",
      shipping_address_line_1: "1 Main",
      shipping_address_line_2: "Suite 2",
      shipping_city: "Louisville",
      shipping_state: "KY",
      shipping_postal_code: "40202",
      shipping_country: "US",
      shipping_method: "LTL",
      shipping_charge_cents: 12500,
      delivery_notes: "call",
      terms_and_conditions: "net 30",
      long_description: "long",
      authorized_at: "2026-05-03",
      ordered_at: null,
      completed_at: null,
      created_at: "2026-05-03T12:00:00Z",
      vendor_profiles: { name: "Vendor" },
      crm_companies: { name: "Customer" },
    });
  });

  test("normalizes purchase order detail collections", () => {
    expect(normalizePurchaseOrderLines([
      {
        id: "line-1",
        purchase_order_id: "po-1",
        line_number: "2",
        line_type: "option",
        item_code: "OPT",
        description: "Option",
        quantity: "1.5",
        unit_cost_cents: "2500",
      },
      { id: "bad" },
    ])).toEqual([
      {
        id: "line-1",
        purchase_order_id: "po-1",
        line_number: 2,
        line_type: "option",
        item_code: "OPT",
        description: "Option",
        quantity: 1.5,
        unit_cost_cents: 2500,
      },
    ]);

    expect(normalizePurchaseOrderTouchpoints([
      {
        id: "touch-1",
        purchase_order_id: "po-1",
        contact_name: "Rep",
        note: "Called",
        occurred_at: "2026-05-03T12:00:00Z",
      },
    ])).toEqual([
      {
        id: "touch-1",
        purchase_order_id: "po-1",
        contact_name: "Rep",
        note: "Called",
        occurred_at: "2026-05-03T12:00:00Z",
      },
    ]);
  });

  test("normalizes equipment catalog and attachment rows", () => {
    expect(normalizePurchaseOrderEquipmentModels([
      {
        id: "model-1",
        brand_id: "brand-1",
        model_code: "333G",
        name_display: "333G Compact Track Loader",
        list_price_cents: "1000000",
      },
    ])).toEqual([
      {
        id: "model-1",
        brand_id: "brand-1",
        model_code: "333G",
        name_display: "333G Compact Track Loader",
        list_price_cents: 1000000,
      },
    ]);

    expect(normalizePurchaseOrderAttachments([
      {
        id: "attach-1",
        brand_id: "brand-1",
        name: "Bucket",
        list_price_cents: "250000",
        compatible_model_ids: ["model-1", 123],
        universal: true,
      },
    ])).toEqual([
      {
        id: "attach-1",
        brand_id: "brand-1",
        name: "Bucket",
        list_price_cents: 250000,
        compatible_model_ids: ["model-1"],
        universal: true,
      },
    ]);
  });
});
