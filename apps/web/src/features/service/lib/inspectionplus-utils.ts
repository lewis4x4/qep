export type InspectionFindingTemplate = {
  key: string;
  section: string;
  label: string;
  required?: boolean;
  expectedValue?: string;
};

export type InspectionTemplateDefinition = {
  key: string;
  name: string;
  description: string;
  inspectionType: string;
  findings: InspectionFindingTemplate[];
};

export type InspectionFindingDraft = {
  template_item_key: string;
  section_label: string;
  finding_label: string;
  response: "pending";
  sort_order: number;
  expected_value: string | null;
};

export type InspectionFindingProgress = {
  total: number;
  completed: number;
  failed: number;
  pending: number;
};

export type InspectionStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type InspectionApprovalStatus = "not_requested" | "pending" | "approved" | "returned";
export type InspectionFindingResponse = "pending" | "pass" | "fail" | "na";

export type InspectionRow = {
  id: string;
  inspection_number: string;
  title: string;
  template_name: string | null;
  inspection_type: string;
  status: InspectionStatus;
  stock_number: string | null;
  reference_number: string | null;
  customer_name: string | null;
  machine_summary: string | null;
  service_job_id: string | null;
  assignee_name: string | null;
  approver_name: string | null;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type InspectionHeader = InspectionRow & {
  approval_status: InspectionApprovalStatus;
  cancellation_reason: string | null;
};

export type InspectionFinding = {
  id: string;
  inspection_id: string;
  section_label: string;
  finding_label: string;
  response: InspectionFindingResponse;
  sort_order: number;
  expected_value: string | null;
  observed_value: string | null;
  notes: string | null;
  requires_follow_up: boolean;
};

const INSPECTION_STATUSES = new Set<InspectionStatus>(["draft", "in_progress", "completed", "cancelled"]);
const INSPECTION_APPROVAL_STATUSES = new Set<InspectionApprovalStatus>([
  "not_requested",
  "pending",
  "approved",
  "returned",
]);
const INSPECTION_FINDING_RESPONSES = new Set<InspectionFindingResponse>(["pending", "pass", "fail", "na"]);

export const INSPECTIONPLUS_TEMPLATES: InspectionTemplateDefinition[] = [
  {
    key: "general_condition",
    name: "General Condition",
    description: "Machine condition, operating controls, fluids, and visible wear points.",
    inspectionType: "equipment_condition",
    findings: [
      { key: "walkaround", section: "Walkaround", label: "Overall visual condition documented" },
      { key: "leaks", section: "Hydraulics", label: "No active oil or hydraulic leaks" },
      { key: "controls", section: "Operator Station", label: "Controls and display respond correctly" },
      { key: "safety", section: "Safety", label: "Safety decals, horn, lights, and guards present" },
      { key: "wear", section: "Undercarriage", label: "Undercarriage or tire wear captured" },
    ],
  },
  {
    key: "rental_return",
    name: "Rental Return",
    description: "Return-condition audit for rental check-in, damage capture, and charge review.",
    inspectionType: "rental_return",
    findings: [
      { key: "meter", section: "Return Intake", label: "Hour meter / usage recorded" },
      { key: "cleanliness", section: "Return Intake", label: "Unit cleanliness documented" },
      { key: "damage", section: "Damage", label: "Damage photos and notes captured" },
      { key: "attachments", section: "Attachments", label: "Returned attachments and loose items verified" },
      { key: "service_followup", section: "Disposition", label: "Service follow-up required identified" },
    ],
  },
  {
    key: "job_site_safety",
    name: "Job Site Safety",
    description: "Field technician safety walk before or during on-site service execution.",
    inspectionType: "job_site_safety",
    findings: [
      { key: "ppe", section: "Safety", label: "Technician PPE and site requirements confirmed" },
      { key: "access", section: "Access", label: "Machine access path and job-site hazards reviewed" },
      { key: "lockout", section: "Controls", label: "Lockout / isolation needs identified" },
      { key: "environment", section: "Environment", label: "Ground conditions and spill risk checked" },
      { key: "customer_contact", section: "Signoff", label: "Site contact / supervisor acknowledged arrival" },
    ],
  },
  {
    key: "equipment_demo",
    name: "Equipment Demo",
    description: "Structured demo form for machine walkthroughs, performance checks, and follow-up.",
    inspectionType: "equipment_demo",
    findings: [
      { key: "appearance", section: "Presentation", label: "Exterior appearance and branding reviewed" },
      { key: "startup", section: "Operation", label: "Startup, controls, and key functions demonstrated" },
      { key: "attachments", section: "Operation", label: "Attachment / implement operation verified" },
      { key: "customer_questions", section: "Customer", label: "Customer questions and concerns captured" },
      { key: "followup", section: "Follow-up", label: "Next-step action items documented" },
    ],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function inspectionStatusOrNull(value: unknown): InspectionStatus | null {
  return typeof value === "string" && INSPECTION_STATUSES.has(value as InspectionStatus)
    ? value as InspectionStatus
    : null;
}

function inspectionApprovalStatusOrNull(value: unknown): InspectionApprovalStatus | null {
  return typeof value === "string" && INSPECTION_APPROVAL_STATUSES.has(value as InspectionApprovalStatus)
    ? value as InspectionApprovalStatus
    : null;
}

function inspectionFindingResponseOrNull(value: unknown): InspectionFindingResponse | null {
  return typeof value === "string" && INSPECTION_FINDING_RESPONSES.has(value as InspectionFindingResponse)
    ? value as InspectionFindingResponse
    : null;
}

function normalizeInspectionBaseRow(value: Record<string, unknown>): InspectionRow | null {
  const id = requiredString(value.id);
  const inspectionNumber = requiredString(value.inspection_number);
  const title = requiredString(value.title);
  const inspectionType = requiredString(value.inspection_type);
  const status = inspectionStatusOrNull(value.status);
  const createdAt = requiredString(value.created_at);
  if (!id || !inspectionNumber || !title || !inspectionType || !status || !createdAt) return null;
  return {
    id,
    inspection_number: inspectionNumber,
    title,
    template_name: stringOrNull(value.template_name),
    inspection_type: inspectionType,
    status,
    stock_number: stringOrNull(value.stock_number),
    reference_number: stringOrNull(value.reference_number),
    customer_name: stringOrNull(value.customer_name),
    machine_summary: stringOrNull(value.machine_summary),
    service_job_id: stringOrNull(value.service_job_id),
    assignee_name: stringOrNull(value.assignee_name),
    approver_name: stringOrNull(value.approver_name),
    created_by: stringOrNull(value.created_by),
    started_at: stringOrNull(value.started_at),
    completed_at: stringOrNull(value.completed_at),
    created_at: createdAt,
  };
}

export function normalizeInspectionRows(rows: unknown): InspectionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const row = normalizeInspectionBaseRow(value);
    return row ? [row] : [];
  });
}

export function normalizeInspectionHeader(value: unknown): InspectionHeader | null {
  if (!isRecord(value)) return null;
  const row = normalizeInspectionBaseRow(value);
  const approvalStatus = inspectionApprovalStatusOrNull(value.approval_status);
  if (!row || !approvalStatus) return null;
  return {
    ...row,
    approval_status: approvalStatus,
    cancellation_reason: stringOrNull(value.cancellation_reason),
  };
}

export function normalizeInspectionFindings(rows: unknown): InspectionFinding[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const inspectionId = requiredString(value.inspection_id);
    const sectionLabel = requiredString(value.section_label);
    const findingLabel = requiredString(value.finding_label);
    const response = inspectionFindingResponseOrNull(value.response);
    const sortOrder = numberOrNull(value.sort_order);
    if (!id || !inspectionId || !sectionLabel || !findingLabel || !response || sortOrder == null) return [];
    return [{
      id,
      inspection_id: inspectionId,
      section_label: sectionLabel,
      finding_label: findingLabel,
      response,
      sort_order: sortOrder,
      expected_value: stringOrNull(value.expected_value),
      observed_value: stringOrNull(value.observed_value),
      notes: stringOrNull(value.notes),
      requires_follow_up: value.requires_follow_up === true,
    }];
  });
}

export function makeInspectionNumber(now = new Date(), suffix?: string): string {
  const stamp = [
    String(now.getUTCFullYear()).slice(2),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = (suffix ?? Math.random().toString(36).slice(2, 6)).toUpperCase();
  return `IP-${stamp}-${random}`;
}

export function templateByKey(key: string): InspectionTemplateDefinition | null {
  return INSPECTIONPLUS_TEMPLATES.find((template) => template.key === key) ?? null;
}

export function buildInspectionFindingDrafts(template: InspectionTemplateDefinition): InspectionFindingDraft[] {
  return template.findings.map((finding, index) => ({
    template_item_key: finding.key,
    section_label: finding.section,
    finding_label: finding.label,
    response: "pending",
    sort_order: index,
    expected_value: finding.expectedValue ?? null,
  }));
}

export function summarizeInspectionFindings(
  findings: Array<{ response: string }>,
): InspectionFindingProgress {
  return findings.reduce<InspectionFindingProgress>(
    (summary, finding) => {
      summary.total += 1;
      if (finding.response === "fail") summary.failed += 1;
      if (finding.response === "pending") summary.pending += 1;
      if (finding.response !== "pending") summary.completed += 1;
      return summary;
    },
    { total: 0, completed: 0, failed: 0, pending: 0 },
  );
}

export function groupInspectionFindings<T extends { section_label: string; sort_order: number }>(
  findings: T[],
): Array<{ section: string; findings: T[] }> {
  const order: string[] = [];
  const grouped = new Map<string, T[]>();

  for (const finding of findings) {
    if (!grouped.has(finding.section_label)) {
      grouped.set(finding.section_label, []);
      order.push(finding.section_label);
    }
    grouped.get(finding.section_label)!.push(finding);
  }

  return order.map((section) => ({
    section,
    findings: [...(grouped.get(section) ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}
