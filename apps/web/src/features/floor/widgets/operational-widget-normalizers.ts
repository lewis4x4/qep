export type OperationalMorningBriefEvent = {
  type: string;
  summary: string;
  at: string;
};

export type OperationalMorningBriefData = {
  count: number;
  events: OperationalMorningBriefEvent[];
};

export type OperationalCustomerPartsIntelRow = {
  id: string;
  crm_company_id: string;
  churn_risk: string;
  spend_trend: string;
  order_count_12m: number;
  total_spend_12m: number;
  predicted_next_quarter_spend: number;
  opportunity_value: number;
  days_since_last_order: number | null;
  recommended_outreach: string | null;
  computed_at: string;
  crm_companies?: { id: string; name: string } | { id: string; name: string }[] | null;
};

export type OperationalInvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  balance_due: number | null;
  due_date: string;
  created_at: string;
  crm_companies?: { name: string } | { name: string }[] | null;
};

export type OperationalVendorRow = {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  composite_score: number | null;
  machine_down_priority: boolean;
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

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

export function normalizeOperationalMorningBriefData(value: unknown): OperationalMorningBriefData {
  if (!isRecord(value)) return { count: 0, events: [] };
  const events = Array.isArray(value.events)
    ? value.events.map(normalizeOperationalMorningBriefEvent).filter((event): event is OperationalMorningBriefEvent => event !== null)
    : [];
  return {
    count: numberValue(value.count) ?? events.length,
    events,
  };
}

function normalizeOperationalMorningBriefEvent(value: unknown): OperationalMorningBriefEvent | null {
  if (!isRecord(value)) return null;
  const summary = nullableString(value.summary);
  const at = nullableString(value.at);
  if (!summary || !at) return null;
  return {
    type: nullableString(value.type) ?? "event",
    summary,
    at,
  };
}

export function normalizeOperationalCustomerPartsIntelRows(rows: unknown): OperationalCustomerPartsIntelRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeOperationalCustomerPartsIntelRow).filter((row): row is OperationalCustomerPartsIntelRow => row !== null);
}

function normalizeOperationalCustomerPartsIntelRow(row: unknown): OperationalCustomerPartsIntelRow | null {
  if (!isRecord(row)) return null;
  const id = nullableString(row.id);
  const crmCompanyId = nullableString(row.crm_company_id);
  const computedAt = nullableString(row.computed_at);
  if (!id || !crmCompanyId || !computedAt) return null;
  const company = firstRecord(row.crm_companies);
  const companyId = nullableString(company?.id);
  const companyName = nullableString(company?.name);
  return {
    id,
    crm_company_id: crmCompanyId,
    churn_risk: nullableString(row.churn_risk) ?? "unknown",
    spend_trend: nullableString(row.spend_trend) ?? "unknown",
    order_count_12m: numberValue(row.order_count_12m) ?? 0,
    total_spend_12m: numberValue(row.total_spend_12m) ?? 0,
    predicted_next_quarter_spend: numberValue(row.predicted_next_quarter_spend) ?? 0,
    opportunity_value: numberValue(row.opportunity_value) ?? 0,
    days_since_last_order: numberValue(row.days_since_last_order),
    recommended_outreach: nullableString(row.recommended_outreach),
    computed_at: computedAt,
    crm_companies: companyId && companyName ? { id: companyId, name: companyName } : null,
  };
}

export function normalizeOperationalInvoiceRows(rows: unknown): OperationalInvoiceRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeOperationalInvoiceRow).filter((row): row is OperationalInvoiceRow => row !== null);
}

function normalizeOperationalInvoiceRow(row: unknown): OperationalInvoiceRow | null {
  if (!isRecord(row)) return null;
  const id = nullableString(row.id);
  const invoiceNumber = nullableString(row.invoice_number);
  const status = nullableString(row.status);
  const dueDate = nullableString(row.due_date);
  const createdAt = nullableString(row.created_at);
  if (!id || !invoiceNumber || !status || !dueDate || !createdAt) return null;
  const company = firstRecord(row.crm_companies);
  const companyName = nullableString(company?.name);
  return {
    id,
    invoice_number: invoiceNumber,
    status,
    total: numberValue(row.total) ?? 0,
    balance_due: numberValue(row.balance_due),
    due_date: dueDate,
    created_at: createdAt,
    crm_companies: companyName ? { name: companyName } : null,
  };
}

export function normalizeOperationalVendorRows(rows: unknown): OperationalVendorRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeOperationalVendorRow).filter((row): row is OperationalVendorRow => row !== null);
}

function normalizeOperationalVendorRow(row: unknown): OperationalVendorRow | null {
  if (!isRecord(row)) return null;
  const id = nullableString(row.id);
  const name = nullableString(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    avg_lead_time_hours: numberValue(row.avg_lead_time_hours),
    responsiveness_score: numberValue(row.responsiveness_score),
    fill_rate: numberValue(row.fill_rate),
    composite_score: numberValue(row.composite_score),
    machine_down_priority: booleanValue(row.machine_down_priority),
  };
}
