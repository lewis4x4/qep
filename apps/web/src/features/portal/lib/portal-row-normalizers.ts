export type PortalDocumentType =
  | "operator_manual"
  | "service_manual"
  | "parts_manual"
  | "warranty_certificate"
  | "service_record"
  | "inspection_report"
  | "invoice"
  | "receipt"
  | "photo"
  | "other";

export type PortalFleetItem = {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  stage_label?: string | null;
  last_lat?: number | null;
  last_lng?: number | null;
};

export type PortalMaintenanceScheduleRow = {
  id: string;
  label?: string | null;
  next_due_date?: string | null;
  next_due_hours?: number | null;
};

export type PortalFleetDetailItem = {
  id: string;
  equipment_id?: string | null;
  make: string | null;
  model: string | null;
  name?: string | null;
  year: number | null;
  serial_number: string | null;
  current_hours: number | null;
  warranty_expiry: string | null;
  next_service_due: string | null;
  trade_in_interest?: boolean;
  portal_status?: {
    label: string;
    source_label: string;
    eta: string | null;
    last_updated_at: string | null;
  } | null;
  maintenance_schedules?: PortalMaintenanceScheduleRow[] | null;
};

export type EquipmentDocument = {
  id: string;
  fleet_id: string | null;
  crm_equipment_id: string | null;
  document_type: PortalDocumentType;
  title: string;
  description: string | null;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  customer_visible: boolean;
  created_at: string;
  portal_visibility?: {
    label: string;
    detail: string;
    released_at: string;
  } | null;
};

export type RecentLineItem = {
  part_number?: string;
  quantity?: number;
  description?: string;
  unit_price?: number;
};

export type MachineHistoryRow = {
  fleet_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
  last_ordered_at: string | null;
  total_orders: number;
  recent_line_items:
    | Array<{ li: RecentLineItem[] | RecentLineItem; created_at: string }>
    | null;
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

function documentType(value: unknown): PortalDocumentType {
  return value === "operator_manual" ||
    value === "service_manual" ||
    value === "parts_manual" ||
    value === "warranty_certificate" ||
    value === "service_record" ||
    value === "inspection_report" ||
    value === "invoice" ||
    value === "receipt" ||
    value === "photo" ||
    value === "other"
    ? value
    : "other";
}

export function normalizePortalFleetItems(rows: unknown): PortalFleetItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePortalFleetItem).filter((row): row is PortalFleetItem => row !== null);
}

function normalizePortalFleetItem(value: unknown): PortalFleetItem | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  if (!id) return null;
  return {
    id,
    name: stringValue(value.name, "Equipment"),
    make: nullableString(value.make),
    model: nullableString(value.model),
    year: numberValue(value.year),
    engine_hours: numberValue(value.engine_hours),
    stage_label: nullableString(value.stage_label),
    last_lat: numberValue(value.last_lat),
    last_lng: numberValue(value.last_lng),
  };
}

export function normalizePortalFleetDetailItems(rows: unknown): PortalFleetDetailItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePortalFleetDetailItem).filter((row): row is PortalFleetDetailItem => row !== null);
}

function normalizePortalFleetDetailItem(value: unknown): PortalFleetDetailItem | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  if (!id) return null;
  const status = firstRecord(value.portal_status);
  return {
    id,
    equipment_id: nullableString(value.equipment_id),
    make: nullableString(value.make),
    model: nullableString(value.model),
    name: nullableString(value.name),
    year: numberValue(value.year),
    serial_number: nullableString(value.serial_number),
    current_hours: numberValue(value.current_hours),
    warranty_expiry: nullableString(value.warranty_expiry),
    next_service_due: nullableString(value.next_service_due),
    trade_in_interest: value.trade_in_interest === true,
    portal_status: status
      ? {
          label: stringValue(status.label, "Status"),
          source_label: stringValue(status.source_label, "Portal status"),
          eta: nullableString(status.eta),
          last_updated_at: nullableString(status.last_updated_at),
        }
      : null,
    maintenance_schedules: normalizePortalMaintenanceScheduleRows(value.maintenance_schedules),
  };
}

function normalizePortalMaintenanceScheduleRows(rows: unknown): PortalMaintenanceScheduleRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PortalMaintenanceScheduleRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    if (!id) return null;
    return {
      id,
      label: nullableString(value.label),
      next_due_date: nullableString(value.next_due_date),
      next_due_hours: numberValue(value.next_due_hours),
    };
  }).filter((row): row is PortalMaintenanceScheduleRow => row !== null);
}

export function normalizeEquipmentDocuments(rows: unknown): EquipmentDocument[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeEquipmentDocument).filter((row): row is EquipmentDocument => row !== null);
}

function normalizeEquipmentDocument(value: unknown): EquipmentDocument | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const title = nullableString(value.title);
  const fileUrl = nullableString(value.file_url);
  const createdAt = nullableString(value.created_at);
  if (!id || !title || !fileUrl || !createdAt) return null;
  const visibility = firstRecord(value.portal_visibility);
  return {
    id,
    fleet_id: nullableString(value.fleet_id),
    crm_equipment_id: nullableString(value.crm_equipment_id),
    document_type: documentType(value.document_type),
    title,
    description: nullableString(value.description),
    file_url: fileUrl,
    file_size_bytes: numberValue(value.file_size_bytes),
    mime_type: nullableString(value.mime_type),
    customer_visible: value.customer_visible === true,
    created_at: createdAt,
    portal_visibility: visibility
      ? {
          label: stringValue(visibility.label),
          detail: stringValue(visibility.detail),
          released_at: stringValue(visibility.released_at),
        }
      : null,
  };
}

export function normalizeMachineHistoryRows(rows: unknown): MachineHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeMachineHistoryRow).filter((row): row is MachineHistoryRow => row !== null);
}

function normalizeMachineHistoryRow(value: unknown): MachineHistoryRow | null {
  if (!isRecord(value)) return null;
  const fleetId = nullableString(value.fleet_id);
  if (!fleetId) return null;
  return {
    fleet_id: fleetId,
    make: nullableString(value.make),
    model: nullableString(value.model),
    year: numberValue(value.year),
    serial_number: nullableString(value.serial_number),
    last_ordered_at: nullableString(value.last_ordered_at),
    total_orders: numberValue(value.total_orders) ?? 0,
    recent_line_items: normalizeRecentOrderEntries(value.recent_line_items),
  };
}

function normalizeRecentOrderEntries(rows: unknown): MachineHistoryRow["recent_line_items"] {
  if (!Array.isArray(rows)) return null;
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const createdAt = nullableString(value.created_at);
    if (!createdAt) return null;
    const lineItems = Array.isArray(value.li)
      ? value.li.map(normalizeRecentLineItem).filter((row): row is RecentLineItem => row !== null)
      : normalizeRecentLineItem(value.li);
    if (Array.isArray(lineItems) && lineItems.length === 0) return null;
    if (!Array.isArray(lineItems) && lineItems === null) return null;
    return {
      li: lineItems,
      created_at: createdAt,
    };
  }).filter((row): row is NonNullable<MachineHistoryRow["recent_line_items"]>[number] => row !== null);
}

function normalizeRecentLineItem(value: unknown): RecentLineItem | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  const quantity = numberValue(value.quantity);
  const description = nullableString(value.description);
  const unitPrice = numberValue(value.unit_price);
  return {
    part_number: partNumber,
    ...(quantity !== null ? { quantity } : {}),
    ...(description ? { description } : {}),
    ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
  };
}
