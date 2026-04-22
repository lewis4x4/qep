import { describe, expect, test } from "bun:test";
import {
  formatVendorPurchaseOrderStatus,
  formatVendorPurchaseOrderType,
  nextVendorPurchaseOrderStatuses,
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
});
