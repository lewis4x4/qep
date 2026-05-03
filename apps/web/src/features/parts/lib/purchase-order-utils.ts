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

export type VendorOptionRow = {
  id: string;
  name: string;
};

export type PurchaseOrderListRow = {
  id: string;
  po_number: string;
  order_type: VendorPurchaseOrderType;
  status: VendorPurchaseOrderStatus;
  description: string | null;
  location_code: string | null;
  vendor_id: string;
  created_at: string;
  vendor_profiles: { name: string } | null;
};

export type PurchaseOrderHeader = {
  id: string;
  po_number: string;
  vendor_id: string;
  order_type: VendorPurchaseOrderType;
  status: VendorPurchaseOrderStatus;
  location_code: string | null;
  description: string | null;
  crm_company_id: string | null;
  order_comments: string | null;
  shipping_contact_name: string | null;
  shipping_address_line_1: string | null;
  shipping_address_line_2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  shipping_method: string | null;
  shipping_charge_cents: number;
  delivery_notes: string | null;
  terms_and_conditions: string | null;
  long_description: string | null;
  authorized_at: string | null;
  ordered_at: string | null;
  completed_at: string | null;
  created_at: string;
  vendor_profiles: { name: string } | null;
  crm_companies: { name: string } | null;
};

export type PurchaseOrderHeaderUpdate = Partial<Omit<PurchaseOrderHeader, "vendor_profiles" | "crm_companies">>;

export type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  line_number: number;
  line_type: "miscellaneous" | "equipment_base" | "option";
  item_code: string | null;
  description: string;
  quantity: number;
  unit_cost_cents: number;
};

export type PurchaseOrderTouchpoint = {
  id: string;
  purchase_order_id: string;
  contact_name: string | null;
  note: string;
  occurred_at: string;
};

export type PurchaseOrderEquipmentModel = {
  id: string;
  brand_id: string;
  model_code: string;
  name_display: string;
  list_price_cents: number;
};

export type PurchaseOrderAttachment = {
  id: string;
  brand_id: string | null;
  name: string;
  list_price_cents: number;
  compatible_model_ids: string[] | null;
  universal: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return rows.length > 0 ? rows : [];
}

function purchaseOrderStatus(value: unknown): VendorPurchaseOrderStatus {
  return value === "po_requested" ||
    value === "waiting_authorization" ||
    value === "authorized" ||
    value === "on_order" ||
    value === "canceled" ||
    value === "back_order" ||
    value === "completed" ||
    value === "rejected"
    ? value
    : "po_requested";
}

function purchaseOrderType(value: unknown): VendorPurchaseOrderType {
  return value === "miscellaneous" ||
    value === "equipment" ||
    value === "fixed_asset" ||
    value === "equipment_replenishment"
    ? value
    : "miscellaneous";
}

function lineType(value: unknown): PurchaseOrderLine["line_type"] {
  return value === "equipment_base" || value === "option" ? value : "miscellaneous";
}

function joinedName(value: unknown): { name: string } | null {
  const row = firstRecord(value);
  const name = nullableString(row?.name);
  return name ? { name } : null;
}

export function normalizeVendorOptionRows(rows: unknown): VendorOptionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): VendorOptionRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const name = nullableString(value.name);
    return id && name ? { id, name } : null;
  }).filter((row): row is VendorOptionRow => row !== null);
}

export function normalizePurchaseOrderRows(rows: unknown): PurchaseOrderListRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PurchaseOrderListRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const poNumber = nullableString(value.po_number);
    const vendorId = nullableString(value.vendor_id);
    const createdAt = nullableString(value.created_at);
    if (!id || !poNumber || !vendorId || !createdAt) return null;
    return {
      id,
      po_number: poNumber,
      order_type: purchaseOrderType(value.order_type),
      status: purchaseOrderStatus(value.status),
      description: nullableString(value.description),
      location_code: nullableString(value.location_code),
      vendor_id: vendorId,
      created_at: createdAt,
      vendor_profiles: joinedName(value.vendor_profiles),
    };
  }).filter((row): row is PurchaseOrderListRow => row !== null);
}

export function normalizePurchaseOrderHeader(value: unknown): PurchaseOrderHeader | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const poNumber = nullableString(value.po_number);
  const vendorId = nullableString(value.vendor_id);
  const createdAt = nullableString(value.created_at);
  if (!id || !poNumber || !vendorId || !createdAt) return null;
  return {
    id,
    po_number: poNumber,
    vendor_id: vendorId,
    order_type: purchaseOrderType(value.order_type),
    status: purchaseOrderStatus(value.status),
    location_code: nullableString(value.location_code),
    description: nullableString(value.description),
    crm_company_id: nullableString(value.crm_company_id),
    order_comments: nullableString(value.order_comments),
    shipping_contact_name: nullableString(value.shipping_contact_name),
    shipping_address_line_1: nullableString(value.shipping_address_line_1),
    shipping_address_line_2: nullableString(value.shipping_address_line_2),
    shipping_city: nullableString(value.shipping_city),
    shipping_state: nullableString(value.shipping_state),
    shipping_postal_code: nullableString(value.shipping_postal_code),
    shipping_country: nullableString(value.shipping_country),
    shipping_method: nullableString(value.shipping_method),
    shipping_charge_cents: numberValue(value.shipping_charge_cents) ?? 0,
    delivery_notes: nullableString(value.delivery_notes),
    terms_and_conditions: nullableString(value.terms_and_conditions),
    long_description: nullableString(value.long_description),
    authorized_at: nullableString(value.authorized_at),
    ordered_at: nullableString(value.ordered_at),
    completed_at: nullableString(value.completed_at),
    created_at: createdAt,
    vendor_profiles: joinedName(value.vendor_profiles),
    crm_companies: joinedName(value.crm_companies),
  };
}

export function normalizePurchaseOrderLines(rows: unknown): PurchaseOrderLine[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PurchaseOrderLine | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const purchaseOrderId = nullableString(value.purchase_order_id);
    const description = nullableString(value.description);
    if (!id || !purchaseOrderId || !description) return null;
    return {
      id,
      purchase_order_id: purchaseOrderId,
      line_number: numberValue(value.line_number) ?? 0,
      line_type: lineType(value.line_type),
      item_code: nullableString(value.item_code),
      description,
      quantity: numberValue(value.quantity) ?? 0,
      unit_cost_cents: numberValue(value.unit_cost_cents) ?? 0,
    };
  }).filter((row): row is PurchaseOrderLine => row !== null);
}

export function normalizePurchaseOrderTouchpoints(rows: unknown): PurchaseOrderTouchpoint[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PurchaseOrderTouchpoint | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const purchaseOrderId = nullableString(value.purchase_order_id);
    const note = nullableString(value.note);
    const occurredAt = nullableString(value.occurred_at);
    if (!id || !purchaseOrderId || !note || !occurredAt) return null;
    return {
      id,
      purchase_order_id: purchaseOrderId,
      contact_name: nullableString(value.contact_name),
      note,
      occurred_at: occurredAt,
    };
  }).filter((row): row is PurchaseOrderTouchpoint => row !== null);
}

export function normalizePurchaseOrderEquipmentModels(rows: unknown): PurchaseOrderEquipmentModel[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PurchaseOrderEquipmentModel | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const brandId = nullableString(value.brand_id);
    const modelCode = nullableString(value.model_code);
    const nameDisplay = nullableString(value.name_display);
    if (!id || !brandId || !modelCode || !nameDisplay) return null;
    return {
      id,
      brand_id: brandId,
      model_code: modelCode,
      name_display: nameDisplay,
      list_price_cents: numberValue(value.list_price_cents) ?? 0,
    };
  }).filter((row): row is PurchaseOrderEquipmentModel => row !== null);
}

export function normalizePurchaseOrderAttachments(rows: unknown): PurchaseOrderAttachment[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PurchaseOrderAttachment | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    const name = nullableString(value.name);
    if (!id || !name) return null;
    return {
      id,
      brand_id: nullableString(value.brand_id),
      name,
      list_price_cents: numberValue(value.list_price_cents) ?? 0,
      compatible_model_ids: stringArray(value.compatible_model_ids),
      universal: value.universal === true,
    };
  }).filter((row): row is PurchaseOrderAttachment => row !== null);
}

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
