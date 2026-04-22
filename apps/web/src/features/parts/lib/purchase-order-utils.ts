export type VendorPurchaseOrderStatus =
  | "po_requested"
  | "waiting_authorization"
  | "authorized"
  | "on_order"
  | "canceled"
  | "back_order"
  | "completed"
  | "rejected";

export type VendorPurchaseOrderType =
  | "miscellaneous"
  | "equipment"
  | "fixed_asset"
  | "equipment_replenishment";

export function formatVendorPurchaseOrderStatus(status: VendorPurchaseOrderStatus): string {
  switch (status) {
    case "po_requested":
      return "PO Request";
    case "waiting_authorization":
      return "Waiting for Authorization";
    case "authorized":
      return "Authorized";
    case "on_order":
      return "On Order";
    case "canceled":
      return "Canceled";
    case "back_order":
      return "Back Order";
    case "completed":
      return "Completed";
    case "rejected":
      return "Rejected";
  }
}

export function formatVendorPurchaseOrderType(type: VendorPurchaseOrderType): string {
  switch (type) {
    case "miscellaneous":
      return "Miscellaneous";
    case "equipment":
      return "Equipment";
    case "fixed_asset":
      return "Fixed Asset";
    case "equipment_replenishment":
      return "Equipment Replenishment";
  }
}

export function nextVendorPurchaseOrderStatuses(status: VendorPurchaseOrderStatus): VendorPurchaseOrderStatus[] {
  switch (status) {
    case "po_requested":
      return ["waiting_authorization", "canceled"];
    case "waiting_authorization":
      return ["authorized", "rejected", "canceled"];
    case "authorized":
      return ["on_order", "canceled"];
    case "on_order":
      return ["back_order", "completed", "canceled"];
    case "back_order":
      return ["on_order", "completed", "canceled"];
    default:
      return [];
  }
}

export function sumVendorPurchaseOrderLines(
  lines: Array<{ quantity: number; unit_cost_cents: number }>,
): number {
  return lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unit_cost_cents), 0);
}
