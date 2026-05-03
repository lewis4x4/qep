export type ShopInvoiceLineRow = {
  id: string;
  line_number: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number | null;
};

export type ShopInvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  description: string | null;
  amount: number;
  tax: number | null;
  total: number;
  status: string;
  service_job_id: string | null;
  crm_company_id: string | null;
  branch_id: string | null;
  customer_invoice_line_items?: ShopInvoiceLineRow[] | null;
};

export type ShopInvoiceSummary = {
  id: string;
  invoice_number: string;
  status: string;
};

export type IntakeResult = {
  machine: Record<string, unknown> | null;
  service_history: unknown[];
  suggested_job_codes: Array<{
    id: string;
    job_name: string;
    make: string;
    model_family: string | null;
    manufacturer_estimated_hours: number | null;
    shop_average_hours: number | null;
    parts_template: unknown[];
    confidence_score: number | null;
  }>;
  likely_parts: unknown[];
  estimated_hours: number | null;
  haul_required: boolean;
  confidence: number;
  suggested_next_step: string;
};

export type PortalPartsOrderRow = {
  id: string;
  status: string;
  fulfillment_run_id: string | null;
  line_items: unknown;
  ai_suggested_pm_kit: boolean | null;
  ai_suggestion_reason: string | null;
  tracking_number: string | null;
  estimated_delivery: string | null;
  shipping_address: unknown;
  created_at: string;
  updated_at: string;
  portal_customers: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  customer_fleet: {
    make: string;
    model: string;
    serial_number: string | null;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  const normalized = stringOrNull(value)?.trim();
  return normalized ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeShopInvoiceLines(rows: unknown): ShopInvoiceLineRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const lineNumber = numberOrNull(value.line_number);
    const description = requiredString(value.description);
    const quantity = numberOrNull(value.quantity);
    const unitPrice = numberOrNull(value.unit_price);
    if (!id || lineNumber == null || !description || quantity == null || unitPrice == null) return [];
    return [{
      id,
      line_number: lineNumber,
      description,
      quantity,
      unit_price: unitPrice,
      line_total: numberOrNull(value.line_total),
    }];
  });
}

export function normalizeShopInvoiceRow(value: unknown): ShopInvoiceRow | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const invoiceNumber = requiredString(value.invoice_number);
  const invoiceDate = requiredString(value.invoice_date);
  const dueDate = requiredString(value.due_date);
  const amount = numberOrNull(value.amount);
  const total = numberOrNull(value.total);
  const status = requiredString(value.status);
  if (!id || !invoiceNumber || !invoiceDate || !dueDate || amount == null || total == null || !status) return null;
  return {
    id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    description: stringOrNull(value.description),
    amount,
    tax: numberOrNull(value.tax),
    total,
    status,
    service_job_id: stringOrNull(value.service_job_id),
    crm_company_id: stringOrNull(value.crm_company_id),
    branch_id: stringOrNull(value.branch_id),
    customer_invoice_line_items: normalizeShopInvoiceLines(value.customer_invoice_line_items),
  };
}

export function normalizeShopInvoiceSummary(value: unknown): ShopInvoiceSummary | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const invoiceNumber = requiredString(value.invoice_number);
  const status = requiredString(value.status);
  return id && invoiceNumber && status
    ? { id, invoice_number: invoiceNumber, status }
    : null;
}

function normalizeSuggestedJobCodes(rows: unknown): IntakeResult["suggested_job_codes"] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const jobName = requiredString(value.job_name);
    const make = requiredString(value.make);
    if (!id || !jobName || !make) return [];
    return [{
      id,
      job_name: jobName,
      make,
      model_family: stringOrNull(value.model_family),
      manufacturer_estimated_hours: numberOrNull(value.manufacturer_estimated_hours),
      shop_average_hours: numberOrNull(value.shop_average_hours),
      parts_template: unknownArray(value.parts_template),
      confidence_score: numberOrNull(value.confidence_score),
    }];
  });
}

export function normalizeIntakeResult(value: unknown): IntakeResult {
  const row = recordOrNull(value);
  return {
    machine: row ? recordOrNull(row.machine) : null,
    service_history: row ? unknownArray(row.service_history) : [],
    suggested_job_codes: row ? normalizeSuggestedJobCodes(row.suggested_job_codes) : [],
    likely_parts: row ? unknownArray(row.likely_parts) : [],
    estimated_hours: row ? numberOrNull(row.estimated_hours) : null,
    haul_required: row?.haul_required === true,
    confidence: row ? numberOrNull(row.confidence) ?? 0 : 0,
    suggested_next_step: row ? stringOrNull(row.suggested_next_step) ?? "" : "",
  };
}

function normalizePortalCustomer(value: unknown): PortalPartsOrderRow["portal_customers"] {
  const row = firstRecord(value);
  if (!row) return null;
  const firstName = requiredString(row.first_name);
  const lastName = requiredString(row.last_name);
  const email = requiredString(row.email);
  return firstName && lastName && email
    ? { first_name: firstName, last_name: lastName, email }
    : null;
}

function normalizeCustomerFleet(value: unknown): PortalPartsOrderRow["customer_fleet"] {
  const row = firstRecord(value);
  if (!row) return null;
  const make = requiredString(row.make);
  const model = requiredString(row.model);
  if (!make || !model) return null;
  return {
    make,
    model,
    serial_number: stringOrNull(row.serial_number),
  };
}

export function normalizePortalPartsOrderRows(rows: unknown): PortalPartsOrderRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const status = requiredString(value.status);
    const createdAt = requiredString(value.created_at);
    const updatedAt = requiredString(value.updated_at);
    if (!id || !status || !createdAt || !updatedAt) return [];
    return [{
      id,
      status,
      fulfillment_run_id: stringOrNull(value.fulfillment_run_id),
      line_items: value.line_items,
      ai_suggested_pm_kit: typeof value.ai_suggested_pm_kit === "boolean" ? value.ai_suggested_pm_kit : null,
      ai_suggestion_reason: stringOrNull(value.ai_suggestion_reason),
      tracking_number: stringOrNull(value.tracking_number),
      estimated_delivery: stringOrNull(value.estimated_delivery),
      shipping_address: value.shipping_address,
      created_at: createdAt,
      updated_at: updatedAt,
      portal_customers: normalizePortalCustomer(value.portal_customers),
      customer_fleet: normalizeCustomerFleet(value.customer_fleet),
    }];
  });
}
