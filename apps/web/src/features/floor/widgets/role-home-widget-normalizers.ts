import type { ServiceStage } from "@/features/service/lib/constants";
import { STAGE_LABELS } from "@/features/service/lib/constants";

export type QuoteStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "approved_with_conditions"
  | "changes_requested"
  | "ready"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted_to_deal"
  | "archived";

export type QuoteRow = {
  id: string;
  deal_id: string | null;
  quote_number: string | null;
  customer_company: string | null;
  customer_name: string | null;
  equipment: unknown;
  net_total: number | null;
  status: QuoteStatus | string;
  sent_at: string | null;
  viewed_at: string | null;
  updated_at: string;
  created_by: string | null;
  deal?: { id: string; assigned_rep_id: string | null; name: string | null } | null;
};

export type CounterInquiryRow = {
  id: string;
  inquiry_type: string;
  query_text: string;
  outcome: string;
  result_parts: string[] | null;
  match_type: string | null;
  machine_description: string | null;
  created_at: string;
};

export type MarginRow = {
  month_bucket: string | null;
  avg_margin_pct: number | null;
  flagged_deal_count: number | null;
  deal_count: number | null;
  total_pipeline: number | null;
  equipment_category: string | null;
};

export type DealRow = {
  id: string;
  name: string;
  amount: number | null;
  margin_pct: number | null;
  stage_changed_at?: string | null;
  expected_close_on: string | null;
  updated_at: string;
  company?: { name: string | null } | { name: string | null }[] | null;
  stage?: { name: string | null } | { name: string | null }[] | null;
  assigned_rep?: { full_name: string | null } | { full_name: string | null }[] | null;
};

export type ApprovalDecisionRow = {
  id: string;
  subject: string;
  status: string;
  decided_at: string | null;
  decision_reason: string | null;
  workflow_slug: string;
  decided_by_profile?: { full_name: string | null } | { full_name: string | null }[] | null;
};

export type ServiceJobRow = {
  id: string;
  current_stage: ServiceStage;
  priority: string;
  status_flags: string[] | null;
  customer_problem_summary: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  current_stage_entered_at: string | null;
  workspace_id: string;
  customer?: { name: string | null } | { name: string | null }[] | null;
  machine?: {
    make: string | null;
    model: string | null;
    serial_number: string | null;
    year: number | null;
  } | {
    make: string | null;
    model: string | null;
    serial_number: string | null;
    year: number | null;
  }[] | null;
};

export type SlaApprovalRow = {
  id: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  due_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : null;
}

function serviceStageValue(value: unknown): ServiceStage | null {
  const stage = nonEmptyString(value);
  return stage && Object.prototype.hasOwnProperty.call(STAGE_LABELS, stage)
    ? (stage as ServiceStage)
    : null;
}

export function normalizeQuoteRows(rows: unknown): QuoteRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeQuoteRow).filter((row): row is QuoteRow => row !== null)
    : [];
}

function normalizeQuoteRow(value: unknown): QuoteRow | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const updatedAt = nonEmptyString(value.updated_at);
  if (!id || !updatedAt) return null;
  const deal = firstRecord(value.deal);
  const dealId = nonEmptyString(deal?.id);
  return {
    id,
    deal_id: nullableString(value.deal_id),
    quote_number: nullableString(value.quote_number),
    customer_company: nullableString(value.customer_company),
    customer_name: nullableString(value.customer_name),
    equipment: value.equipment,
    net_total: numberValue(value.net_total),
    status: nonEmptyString(value.status) ?? "draft",
    sent_at: nullableString(value.sent_at),
    viewed_at: nullableString(value.viewed_at),
    updated_at: updatedAt,
    created_by: nullableString(value.created_by),
    deal: dealId
      ? {
          id: dealId,
          assigned_rep_id: nullableString(deal?.assigned_rep_id),
          name: nullableString(deal?.name),
        }
      : null,
  };
}

export function normalizeCounterInquiryRows(rows: unknown): CounterInquiryRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeCounterInquiryRow).filter((row): row is CounterInquiryRow => row !== null)
    : [];
}

function normalizeCounterInquiryRow(value: unknown): CounterInquiryRow | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const createdAt = nonEmptyString(value.created_at);
  if (!id || !createdAt) return null;
  return {
    id,
    inquiry_type: nonEmptyString(value.inquiry_type) ?? "unknown",
    query_text: nonEmptyString(value.query_text) ?? "Untitled inquiry",
    outcome: nonEmptyString(value.outcome) ?? "pending",
    result_parts: stringArray(value.result_parts),
    match_type: nullableString(value.match_type),
    machine_description: nullableString(value.machine_description),
    created_at: createdAt,
  };
}

export function normalizeMarginRows(rows: unknown): MarginRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeMarginRow).filter((row): row is MarginRow => row !== null)
    : [];
}

function normalizeMarginRow(value: unknown): MarginRow | null {
  if (!isRecord(value)) return null;
  return {
    month_bucket: nullableString(value.month_bucket),
    avg_margin_pct: numberValue(value.avg_margin_pct),
    flagged_deal_count: numberValue(value.flagged_deal_count),
    deal_count: numberValue(value.deal_count),
    total_pipeline: numberValue(value.total_pipeline),
    equipment_category: nullableString(value.equipment_category),
  };
}

export function normalizeSlaApprovalRows(rows: unknown): SlaApprovalRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeSlaApprovalRow).filter((row): row is SlaApprovalRow => row !== null)
    : [];
}

function normalizeSlaApprovalRow(value: unknown): SlaApprovalRow | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const requestedAt = nonEmptyString(value.requested_at);
  if (!id || !requestedAt) return null;
  return {
    id,
    status: nonEmptyString(value.status) ?? "pending",
    requested_at: requestedAt,
    decided_at: nullableString(value.decided_at),
    due_at: nullableString(value.due_at),
  };
}

export function normalizeApprovalDecisionRows(rows: unknown): ApprovalDecisionRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeApprovalDecisionRow).filter((row): row is ApprovalDecisionRow => row !== null)
    : [];
}

function normalizeApprovalDecisionRow(value: unknown): ApprovalDecisionRow | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const subject = nonEmptyString(value.subject);
  if (!id || !subject) return null;
  const decidedBy = firstRecord(value.decided_by_profile);
  return {
    id,
    subject,
    status: nonEmptyString(value.status) ?? "pending",
    decided_at: nullableString(value.decided_at),
    decision_reason: nullableString(value.decision_reason),
    workflow_slug: nonEmptyString(value.workflow_slug) ?? "approval",
    decided_by_profile: decidedBy ? { full_name: nullableString(decidedBy.full_name) } : null,
  };
}

export function normalizeServiceJobRows(rows: unknown): ServiceJobRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeServiceJobRow).filter((row): row is ServiceJobRow => row !== null)
    : [];
}

function normalizeServiceJobRow(value: unknown): ServiceJobRow | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const workspaceId = nonEmptyString(value.workspace_id);
  const currentStage = serviceStageValue(value.current_stage);
  if (!id || !workspaceId || !currentStage) return null;
  const customer = firstRecord(value.customer);
  const machine = firstRecord(value.machine);
  return {
    id,
    current_stage: currentStage,
    priority: nonEmptyString(value.priority) ?? "normal",
    status_flags: stringArray(value.status_flags),
    customer_problem_summary: nullableString(value.customer_problem_summary),
    scheduled_start_at: nullableString(value.scheduled_start_at),
    scheduled_end_at: nullableString(value.scheduled_end_at),
    current_stage_entered_at: nullableString(value.current_stage_entered_at),
    workspace_id: workspaceId,
    customer: customer ? { name: nullableString(customer.name) } : null,
    machine: machine
      ? {
          make: nullableString(machine.make),
          model: nullableString(machine.model),
          serial_number: nullableString(machine.serial_number),
          year: numberValue(machine.year),
        }
      : null,
  };
}

export function normalizeJoinedDealRows(rows: unknown): DealRow[] {
  return Array.isArray(rows)
    ? rows.map(normalizeJoinedDealRow).filter((row): row is DealRow => row !== null)
    : [];
}

function normalizeJoinedDealRow(value: unknown): DealRow | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const name = nonEmptyString(value.name);
  const updatedAt = nonEmptyString(value.updated_at);
  if (!id || !name || !updatedAt) return null;
  const company = firstRecord(value.company);
  const stage = firstRecord(value.stage);
  const assignedRep = firstRecord(value.assigned_rep);
  return {
    id,
    name,
    amount: numberValue(value.amount),
    margin_pct: numberValue(value.margin_pct),
    stage_changed_at: nullableString(value.stage_changed_at),
    expected_close_on: nullableString(value.expected_close_on),
    updated_at: updatedAt,
    company: company ? { name: nullableString(company.name) } : null,
    stage: stage ? { name: nullableString(stage.name) } : null,
    assigned_rep: assignedRep ? { full_name: nullableString(assignedRep.full_name) } : null,
  };
}
