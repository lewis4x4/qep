import type { Json } from "@/lib/database.types";
import type { IntakeCardRecord } from "./intake-kanban";
import type { ValidationResult } from "./payment-validation";

export interface TrafficTicketRow {
  id: string;
  billing_comments: string;
  completed_at: string | null;
  created_at: string;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_photos: Json | null;
  delivery_signature_url: string | null;
  department: string;
  driver_checklist: Json | null;
  driver_id: string | null;
  from_location: string;
  hour_meter_reading: number | null;
  locked: boolean | null;
  last_printed_at: string | null;
  problems_reported: string | null;
  printed_count: number;
  proof_of_delivery_complete: boolean | null;
  receipt_number: string | null;
  shipping_date: string;
  status: string;
  stock_number: string;
  ticket_type: string;
  to_contact_name: string;
  to_contact_phone: string;
  to_location: string;
  urgency: string | null;
}

export interface PdiCheckResult {
  id: string;
  status: "pass" | "fail" | "skip";
  note?: string;
  photo_url?: string;
  checked_at: string;
}

export interface PdiIntakeRecord {
  id: string;
  stock_number: string | null;
  current_stage: number;
  pdi_checklist: PdiCheckResult[] | null;
  pdi_completed: boolean;
  pdi_signed_off_by: string | null;
  decals_installed: boolean;
  qr_code_installed: boolean;
  attachments_mounted: boolean;
  pdi_photos: string[] | null;
}

export interface RentalReturnRow {
  id: string;
  balance_due: number | null;
  charge_amount: number | null;
  condition_photos: Json | null;
  created_at: string;
  credit_invoice_number: string | null;
  damage_description: string | null;
  decided_by: string | null;
  deposit_amount: number | null;
  deposit_covers_charges: boolean | null;
  equipment_id: string | null;
  has_charges: boolean | null;
  inspection_checklist: Json | null;
  inspection_date: string | null;
  inspector_id: string | null;
  original_payment_method: string | null;
  refund_method: string | null;
  refund_status: string | null;
  rental_contract_reference: string | null;
  status: string;
  work_order_number: string | null;
}

export interface GLRule {
  gl_code: string;
  gl_name: string;
  gl_number: string | null;
  description: string | null;
  equipment_status: string | null;
  ticket_type: string | null;
  is_customer_damage: boolean | null;
  has_ldw: boolean | null;
  is_sales_truck: boolean | null;
  is_event_related: boolean | null;
  requires_ownership_approval: boolean;
  truck_numbers: string[] | null;
  usage_examples: string | null;
}

export interface SopStepAnalysis {
  step_id: string;
  sort_order: number;
  step_title: string;
  completions: number;
  skips: number;
  skip_rate_pct: number;
}

export interface ComplianceRow {
  template_id: string;
  template_title: string;
  department: string;
  version: number;
  total_executions: number;
  completed_executions: number;
  abandoned_executions: number;
  blocked_executions: number;
  completion_rate_pct: number | null;
  avg_duration_minutes: number | null;
  step_analysis: SopStepAnalysis[] | null;
}

const PDI_STATUSES = new Set<PdiCheckResult["status"]>(["pass", "fail", "skip"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteNumberOrDefault(value: unknown, fallback = 0): number {
  return finiteNumberOrNull(value) ?? fallback;
}

function integerOrDefault(value: unknown, fallback = 0): number {
  return Math.trunc(finiteNumberOrDefault(value, fallback));
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function booleanOrDefault(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function validDateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function jsonOrNull(value: unknown): Json | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value as Json;
  return isRecord(value) ? value as Json : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return rows.length > 0 ? rows : null;
}

function normalizePdiCheckResults(value: unknown): PdiCheckResult[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const status = stringOrNull(row.status);
    const checkedAt = validDateStringOrNull(row.checked_at);
    if (!id || !status || !PDI_STATUSES.has(status as PdiCheckResult["status"]) || !checkedAt) return [];
    return [{
      id,
      status: status as PdiCheckResult["status"],
      ...(stringOrNull(row.note) ? { note: stringOrNull(row.note)! } : {}),
      ...(stringOrNull(row.photo_url) ? { photo_url: stringOrNull(row.photo_url)! } : {}),
      checked_at: checkedAt,
    }];
  });
  return rows.length > 0 ? rows : null;
}

function normalizeJoinedEquipment(value: unknown): IntakeCardRecord["crm_equipment"] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      return [{ name: stringOrNull(entry.name) }];
    });
  }
  if (!isRecord(value)) return null;
  return { name: stringOrNull(value.name) };
}

export function normalizeTrafficTicketRows(rows: unknown): TrafficTicketRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const createdAt = validDateStringOrNull(row.created_at);
    const shippingDate = stringOrNull(row.shipping_date);
    const stockNumber = stringOrNull(row.stock_number);
    if (!id || !createdAt || !shippingDate || !stockNumber) return [];

    return [{
      id,
      billing_comments: stringOrNull(row.billing_comments) ?? "",
      completed_at: validDateStringOrNull(row.completed_at),
      created_at: createdAt,
      delivery_address: stringOrNull(row.delivery_address),
      delivery_lat: finiteNumberOrNull(row.delivery_lat),
      delivery_lng: finiteNumberOrNull(row.delivery_lng),
      delivery_photos: jsonOrNull(row.delivery_photos),
      delivery_signature_url: stringOrNull(row.delivery_signature_url),
      department: stringOrNull(row.department) ?? "ops",
      driver_checklist: jsonOrNull(row.driver_checklist),
      driver_id: stringOrNull(row.driver_id),
      from_location: stringOrNull(row.from_location) ?? "Unknown origin",
      hour_meter_reading: finiteNumberOrNull(row.hour_meter_reading),
      locked: booleanOrNull(row.locked),
      last_printed_at: validDateStringOrNull(row.last_printed_at),
      problems_reported: stringOrNull(row.problems_reported),
      printed_count: integerOrDefault(row.printed_count),
      proof_of_delivery_complete: booleanOrNull(row.proof_of_delivery_complete),
      receipt_number: stringOrNull(row.receipt_number),
      shipping_date: shippingDate,
      status: stringOrNull(row.status) ?? "haul_pending",
      stock_number: stockNumber,
      ticket_type: stringOrNull(row.ticket_type) ?? "delivery",
      to_contact_name: stringOrNull(row.to_contact_name) ?? "Unknown contact",
      to_contact_phone: stringOrNull(row.to_contact_phone) ?? "",
      to_location: stringOrNull(row.to_location) ?? "Unknown destination",
      urgency: stringOrNull(row.urgency),
    }];
  });
}

export function normalizeIntakeCardRows(rows: unknown): IntakeCardRecord[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    if (!id) return [];

    return [{
      id,
      current_stage: integerOrDefault(row.current_stage, 1),
      stock_number: stringOrNull(row.stock_number),
      ship_to_branch: stringOrNull(row.ship_to_branch),
      arrival_photos: jsonOrNull(row.arrival_photos),
      pdi_checklist: jsonOrNull(row.pdi_checklist),
      pdi_completed: booleanOrNull(row.pdi_completed),
      photo_ready: booleanOrNull(row.photo_ready),
      listing_photos: jsonOrNull(row.listing_photos),
      crm_equipment: normalizeJoinedEquipment(row.crm_equipment),
    }];
  });
}

export function normalizePdiIntakeRecord(row: unknown): PdiIntakeRecord | null {
  if (!isRecord(row)) return null;
  const id = stringOrNull(row.id);
  if (!id) return null;

  return {
    id,
    stock_number: stringOrNull(row.stock_number),
    current_stage: integerOrDefault(row.current_stage, 1),
    pdi_checklist: normalizePdiCheckResults(row.pdi_checklist),
    pdi_completed: booleanOrDefault(row.pdi_completed),
    pdi_signed_off_by: stringOrNull(row.pdi_signed_off_by),
    decals_installed: booleanOrDefault(row.decals_installed),
    qr_code_installed: booleanOrDefault(row.qr_code_installed),
    attachments_mounted: booleanOrDefault(row.attachments_mounted),
    pdi_photos: stringArrayOrNull(row.pdi_photos),
  };
}

export function normalizeRentalReturnRows(rows: unknown): RentalReturnRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const createdAt = validDateStringOrNull(row.created_at);
    if (!id || !createdAt) return [];

    return [{
      id,
      balance_due: finiteNumberOrNull(row.balance_due),
      charge_amount: finiteNumberOrNull(row.charge_amount),
      condition_photos: jsonOrNull(row.condition_photos),
      created_at: createdAt,
      credit_invoice_number: stringOrNull(row.credit_invoice_number),
      damage_description: stringOrNull(row.damage_description),
      decided_by: stringOrNull(row.decided_by),
      deposit_amount: finiteNumberOrNull(row.deposit_amount),
      deposit_covers_charges: booleanOrNull(row.deposit_covers_charges),
      equipment_id: stringOrNull(row.equipment_id),
      has_charges: booleanOrNull(row.has_charges),
      inspection_checklist: jsonOrNull(row.inspection_checklist),
      inspection_date: validDateStringOrNull(row.inspection_date) ?? stringOrNull(row.inspection_date),
      inspector_id: stringOrNull(row.inspector_id),
      original_payment_method: stringOrNull(row.original_payment_method),
      refund_method: stringOrNull(row.refund_method),
      refund_status: stringOrNull(row.refund_status),
      rental_contract_reference: stringOrNull(row.rental_contract_reference),
      status: stringOrNull(row.status) ?? "inspection_pending",
      work_order_number: stringOrNull(row.work_order_number),
    }];
  });
}

export function normalizeGlRules(rows: unknown): GLRule[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const glCode = stringOrNull(row.gl_code);
    const glName = stringOrNull(row.gl_name);
    if (!glCode || !glName) return [];

    return [{
      gl_code: glCode,
      gl_name: glName,
      gl_number: stringOrNull(row.gl_number),
      description: stringOrNull(row.description),
      equipment_status: stringOrNull(row.equipment_status),
      ticket_type: stringOrNull(row.ticket_type),
      is_customer_damage: booleanOrNull(row.is_customer_damage),
      has_ldw: booleanOrNull(row.has_ldw),
      is_sales_truck: booleanOrNull(row.is_sales_truck),
      is_event_related: booleanOrNull(row.is_event_related),
      requires_ownership_approval: booleanOrDefault(row.requires_ownership_approval),
      truck_numbers: stringArrayOrNull(row.truck_numbers),
      usage_examples: stringOrNull(row.usage_examples),
    }];
  });
}

function normalizeStepAnalysis(value: unknown): SopStepAnalysis[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const stepId = stringOrNull(row.step_id);
    const stepTitle = stringOrNull(row.step_title);
    if (!stepId || !stepTitle) return [];
    return [{
      step_id: stepId,
      sort_order: integerOrDefault(row.sort_order),
      step_title: stepTitle,
      completions: integerOrDefault(row.completions),
      skips: integerOrDefault(row.skips),
      skip_rate_pct: finiteNumberOrDefault(row.skip_rate_pct),
    }];
  });
  return rows.length > 0 ? rows : null;
}

export function normalizeComplianceRows(rows: unknown): ComplianceRow[] {
  if (!Array.isArray(rows)) return [];

  const byTemplate = new Map<string, ComplianceRow>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const templateId = stringOrNull(row.template_id);
    const templateTitle = stringOrNull(row.template_title);
    if (!templateId || !templateTitle) continue;

    const completed = integerOrDefault(row.completed_executions ?? row.completions);
    const skipped = integerOrDefault(row.skips);
    const stepId = stringOrNull(row.step_id);
    const stepTitle = stringOrNull(row.step_title);
    const inlineStepAnalysis = stepId && stepTitle
      ? [{
          step_id: stepId,
          sort_order: integerOrDefault(row.sort_order),
          step_title: stepTitle,
          completions: completed,
          skips: skipped,
          skip_rate_pct: finiteNumberOrDefault(row.step_compliance_pct),
        }]
      : null;

    const existing = byTemplate.get(templateId);
    const stepAnalysis = [
      ...(existing?.step_analysis ?? []),
      ...(normalizeStepAnalysis(row.step_analysis) ?? inlineStepAnalysis ?? []),
    ];

    byTemplate.set(templateId, {
      template_id: templateId,
      template_title: existing?.template_title ?? templateTitle,
      department: existing?.department ?? stringOrNull(row.department) ?? "sop",
      version: existing?.version ?? integerOrDefault(row.version, 1),
      total_executions: existing?.total_executions ?? integerOrDefault(row.total_executions),
      completed_executions: existing?.completed_executions ?? completed,
      abandoned_executions: existing?.abandoned_executions ?? integerOrDefault(row.abandoned_executions),
      blocked_executions: existing?.blocked_executions ?? integerOrDefault(row.blocked_executions),
      completion_rate_pct: existing?.completion_rate_pct ?? finiteNumberOrNull(row.completion_rate_pct),
      avg_duration_minutes: existing?.avg_duration_minutes ?? finiteNumberOrNull(row.avg_duration_minutes),
      step_analysis: stepAnalysis.length > 0 ? stepAnalysis : null,
    });
  }

  return [...byTemplate.values()];
}

export function normalizeValidationResult(payload: unknown): ValidationResult {
  if (!isRecord(payload)) {
    return { passed: false, rule_applied: null, reason: "Validation failed." };
  }

  return {
    passed: booleanOrDefault(payload.passed),
    rule_applied: stringOrNull(payload.rule_applied),
    reason: stringOrNull(payload.reason),
    daily_check_total: finiteNumberOrNull(payload.daily_check_total),
  };
}
