export type ServicePlanReviewStatus = "draft" | "reviewed" | "changes_requested" | "retired";

export type ServicePlanEnrollmentStatus = "active" | "paused" | "ended";

export type ServicePlanBaselineSource = "explicit" | "primary_actual_meter" | "not_required";

export type ServicePlanDueEventStatus = "detected" | "job_created" | "completed" | "cancelled";

export type ServicePlanCancellationKind = "cancelled" | "deleted" | "abandoned";

export type ServicePlanProgramInterval = {
  id: string;
  program_id: string;
  interval_code: string;
  name: string;
  interval_hours: number | null;
  interval_months: number | null;
  interval_days: number | null;
  entitlement_unit: string;
  entitlement_quantity: number;
  is_active: boolean;
};

export type ServicePlanProgram = {
  id: string;
  program_code: string;
  name: string;
  sponsor: string | null;
  description: string | null;
  catalog_owner: string | null;
  is_provisional: boolean;
  review_status: ServicePlanReviewStatus;
  is_active: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  activated_by: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  intervals: ServicePlanProgramInterval[];
};

export type ServicePlanEnrollmentSchedule = {
  id: string;
  enrollment_id: string;
  program_interval_id: string;
  cycle_number: number;
  baseline_on: string;
  baseline_hours: number | null;
  next_due_on: string | null;
  next_due_hours: number | null;
  last_completed_job_id: string | null;
  last_completed_at: string | null;
};

export type ServicePlanEnrollment = {
  id: string;
  service_agreement_id: string;
  program_id: string;
  equipment_id: string;
  status: ServicePlanEnrollmentStatus;
  enrolled_on: string;
  requested_baseline_hours: number | null;
  baseline_hours: number | null;
  baseline_source: ServicePlanBaselineSource;
  baseline_meter_reading_id: string | null;
  enrolled_by: string | null;
  ended_at: string | null;
  end_reason: string | null;
  schedules: ServicePlanEnrollmentSchedule[];
};

export type ServicePlanEntitlementBalance = {
  service_agreement_id: string;
  unit_code: string;
  available_quantity: number;
  reserved_quantity: number;
  consumed_quantity: number;
  granted_quantity: number;
};

export type ServicePlanSchedulePrompt = {
  id: string;
  due_event_id: string;
  service_job_id: string;
  prompt_type: string;
  prompt_key: string;
  evidence: Record<string, unknown>;
  created_at: string;
  due_basis: string | null;
  due_on: string | null;
  due_hours: number | null;
  due_status: ServicePlanDueEventStatus | null;
  service_agreement_id: string | null;
  equipment_id: string | null;
  job_number: string | null;
  scheduled_start_at: string | null;
};

export type ActivationReadiness = {
  ready: boolean;
  reasons: string[];
};

export type EnrollmentReadiness = {
  ready: boolean;
  reasons: string[];
};

const REVIEW_STATUSES = new Set<ServicePlanReviewStatus>([
  "draft",
  "reviewed",
  "changes_requested",
  "retired",
]);

const ENROLLMENT_STATUSES = new Set<ServicePlanEnrollmentStatus>(["active", "paused", "ended"]);

const BASELINE_SOURCES = new Set<ServicePlanBaselineSource>([
  "explicit",
  "primary_actual_meter",
  "not_required",
]);

const DUE_STATUSES = new Set<ServicePlanDueEventStatus>([
  "detected",
  "job_created",
  "completed",
  "cancelled",
]);

const ELEVATED_ROLES = new Set(["admin", "manager", "owner"]);

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

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function canMutateServicePlans(role: string | null | undefined): boolean {
  return ELEVATED_ROLES.has(role ?? "");
}

export function formatServicePlanReviewStatus(status: ServicePlanReviewStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "reviewed":
      return "Reviewed";
    case "changes_requested":
      return "Changes requested";
    case "retired":
      return "Retired";
  }
}

export function provisionalProgramDisclosure(program: Pick<ServicePlanProgram, "is_provisional" | "catalog_owner" | "is_active">): string {
  if (program.is_active && !program.is_provisional) {
    return "Active for enrollment. Cadence terms remain subject to OEM/model and commercial validation.";
  }
  if (program.is_provisional) {
    return `${program.catalog_owner ?? "Catalog"} draft — not customer-live until QEP review and activation.`;
  }
  return "Reviewed but inactive. Activate only after confirming OEM/model fit, kit, labor, and commercial terms.";
}

export function summarizeProgramInterval(interval: ServicePlanProgramInterval): string {
  const parts: string[] = [];
  if (interval.interval_hours != null) parts.push(`${interval.interval_hours}h`);
  if (interval.interval_months != null) parts.push(`${interval.interval_months}mo`);
  if (interval.interval_days != null) parts.push(`${interval.interval_days}d`);
  return parts.length > 0 ? parts.join(" / ") : "No cadence";
}

export function getProgramActivationReadiness(
  program: Pick<
    ServicePlanProgram,
    "review_status" | "is_provisional" | "is_active" | "reviewed_by" | "reviewed_at" | "review_notes" | "intervals"
  >,
): ActivationReadiness {
  const reasons: string[] = [];
  if (program.is_active) reasons.push("Program is already active.");
  if (
    program.review_status !== "reviewed"
    || !program.reviewed_by
    || !program.reviewed_at
    || !program.review_notes?.trim()
  ) {
    reasons.push("Record a QEP review with notes first.");
  }
  if (program.is_provisional) reasons.push("Provisional programs cannot be activated.");
  const hasActiveInterval = program.intervals.some((interval) => interval.is_active);
  if (!hasActiveInterval) reasons.push("At least one active interval is required.");
  return { ready: reasons.length === 0, reasons };
}

export function getAgreementEnrollmentReadiness(input: {
  status: string;
  program_id: string | null;
  equipment_id: string | null;
  starts_on: string | null;
  expires_on: string | null;
  enrolled_on: string;
  programIsActive?: boolean;
  programReviewed?: boolean;
  programProvisional?: boolean;
}): EnrollmentReadiness {
  const reasons: string[] = [];
  if (input.status !== "active") reasons.push("Agreement must be active.");
  if (!input.program_id) reasons.push("Bind a catalog program before enrollment.");
  if (!input.equipment_id) reasons.push("Agreement must cover a machine.");
  if (input.starts_on && input.starts_on > input.enrolled_on) {
    reasons.push("Enrollment date is before the agreement start.");
  }
  if (input.expires_on && input.expires_on < input.enrolled_on) {
    reasons.push("Enrollment date is after the agreement expiry.");
  }
  if (input.program_id) {
    if (input.programIsActive !== true) reasons.push("Bound program must be active.");
    if (input.programReviewed !== true) reasons.push("Bound program must be reviewed.");
    if (input.programProvisional !== false) reasons.push("Bound program must not be provisional.");
  }
  return { ready: reasons.length === 0, reasons };
}

export function normalizeServicePlanProgramIntervals(rows: unknown): ServicePlanProgramInterval[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const programId = requiredString(value.program_id);
    const intervalCode = requiredString(value.interval_code);
    const name = requiredString(value.name);
    if (!id || !programId || !intervalCode || !name) return [];
    return [{
      id,
      program_id: programId,
      interval_code: intervalCode,
      name,
      interval_hours: numberOrNull(value.interval_hours),
      interval_months: numberOrNull(value.interval_months),
      interval_days: numberOrNull(value.interval_days),
      entitlement_unit: requiredString(value.entitlement_unit) ?? "pm_service",
      entitlement_quantity: numberOrNull(value.entitlement_quantity) ?? 1,
      is_active: booleanOrDefault(value.is_active, true),
    }];
  });
}

export function normalizeServicePlanPrograms(rows: unknown): ServicePlanProgram[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const programCode = requiredString(value.program_code);
    const name = requiredString(value.name);
    const reviewStatus = requiredString(value.review_status);
    if (!id || !programCode || !name) return [];
    if (!reviewStatus || !REVIEW_STATUSES.has(reviewStatus as ServicePlanReviewStatus)) return [];
    const nestedIntervals = value.service_agreement_program_intervals ?? value.intervals ?? [];
    return [{
      id,
      program_code: programCode,
      name,
      sponsor: stringOrNull(value.sponsor),
      description: stringOrNull(value.description),
      catalog_owner: stringOrNull(value.catalog_owner),
      is_provisional: booleanOrDefault(value.is_provisional, true),
      review_status: reviewStatus as ServicePlanReviewStatus,
      is_active: booleanOrDefault(value.is_active, false),
      reviewed_by: stringOrNull(value.reviewed_by),
      reviewed_at: stringOrNull(value.reviewed_at),
      review_notes: stringOrNull(value.review_notes),
      activated_by: stringOrNull(value.activated_by),
      activated_at: stringOrNull(value.activated_at),
      deactivated_at: stringOrNull(value.deactivated_at),
      intervals: normalizeServicePlanProgramIntervals(nestedIntervals),
    }];
  });
}

export function normalizeServicePlanProgram(row: unknown): ServicePlanProgram | null {
  return normalizeServicePlanPrograms(row ? [row] : [])[0] ?? null;
}

export function normalizeServicePlanEnrollmentSchedules(rows: unknown): ServicePlanEnrollmentSchedule[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const enrollmentId = requiredString(value.enrollment_id);
    const programIntervalId = requiredString(value.program_interval_id);
    const baselineOn = requiredString(value.baseline_on);
    if (!id || !enrollmentId || !programIntervalId || !baselineOn) return [];
    return [{
      id,
      enrollment_id: enrollmentId,
      program_interval_id: programIntervalId,
      cycle_number: numberOrNull(value.cycle_number) ?? 1,
      baseline_on: baselineOn,
      baseline_hours: numberOrNull(value.baseline_hours),
      next_due_on: stringOrNull(value.next_due_on),
      next_due_hours: numberOrNull(value.next_due_hours),
      last_completed_job_id: stringOrNull(value.last_completed_job_id),
      last_completed_at: stringOrNull(value.last_completed_at),
    }];
  });
}

export function normalizeServicePlanEnrollments(rows: unknown): ServicePlanEnrollment[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const agreementId = requiredString(value.service_agreement_id);
    const programId = requiredString(value.program_id);
    const equipmentId = requiredString(value.equipment_id);
    const status = requiredString(value.status);
    const enrolledOn = requiredString(value.enrolled_on);
    const baselineSource = requiredString(value.baseline_source);
    if (!id || !agreementId || !programId || !equipmentId || !enrolledOn) return [];
    if (!status || !ENROLLMENT_STATUSES.has(status as ServicePlanEnrollmentStatus)) return [];
    if (!baselineSource || !BASELINE_SOURCES.has(baselineSource as ServicePlanBaselineSource)) return [];
    const nestedSchedules = value.service_plan_enrollment_schedules ?? value.schedules ?? [];
    return [{
      id,
      service_agreement_id: agreementId,
      program_id: programId,
      equipment_id: equipmentId,
      status: status as ServicePlanEnrollmentStatus,
      enrolled_on: enrolledOn,
      requested_baseline_hours: numberOrNull(value.requested_baseline_hours),
      baseline_hours: numberOrNull(value.baseline_hours),
      baseline_source: baselineSource as ServicePlanBaselineSource,
      baseline_meter_reading_id: stringOrNull(value.baseline_meter_reading_id),
      enrolled_by: stringOrNull(value.enrolled_by),
      ended_at: stringOrNull(value.ended_at),
      end_reason: stringOrNull(value.end_reason),
      schedules: normalizeServicePlanEnrollmentSchedules(nestedSchedules),
    }];
  });
}

export function normalizeServicePlanEnrollment(row: unknown): ServicePlanEnrollment | null {
  return normalizeServicePlanEnrollments(row ? [row] : [])[0] ?? null;
}

export function normalizeServicePlanEntitlementBalances(rows: unknown): ServicePlanEntitlementBalance[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const agreementId = requiredString(value.service_agreement_id);
    const unitCode = requiredString(value.unit_code);
    if (!agreementId || !unitCode) return [];
    return [{
      service_agreement_id: agreementId,
      unit_code: unitCode,
      available_quantity: numberOrNull(value.available_quantity) ?? 0,
      reserved_quantity: numberOrNull(value.reserved_quantity) ?? 0,
      consumed_quantity: numberOrNull(value.consumed_quantity) ?? 0,
      granted_quantity: numberOrNull(value.granted_quantity) ?? 0,
    }];
  });
}

export function normalizeServicePlanSchedulePrompts(rows: unknown): ServicePlanSchedulePrompt[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const dueEventId = requiredString(value.due_event_id);
    const serviceJobId = requiredString(value.service_job_id);
    const promptType = requiredString(value.prompt_type);
    const promptKey = requiredString(value.prompt_key);
    const createdAt = requiredString(value.created_at);
    if (!id || !dueEventId || !serviceJobId || !promptType || !promptKey || !createdAt) return [];

    const dueEvent = one(
      value.service_plan_pm_due_events as Record<string, unknown> | Record<string, unknown>[] | null | undefined,
    );
    const job = one(
      value.service_jobs as Record<string, unknown> | Record<string, unknown>[] | null | undefined,
    );
    const dueStatusRaw = dueEvent ? stringOrNull(dueEvent.status) : null;
    const dueStatus =
      dueStatusRaw && DUE_STATUSES.has(dueStatusRaw as ServicePlanDueEventStatus)
        ? (dueStatusRaw as ServicePlanDueEventStatus)
        : null;

    return [{
      id,
      due_event_id: dueEventId,
      service_job_id: serviceJobId,
      prompt_type: promptType,
      prompt_key: promptKey,
      evidence: isRecord(value.evidence) ? value.evidence : {},
      created_at: createdAt,
      due_basis: dueEvent ? stringOrNull(dueEvent.due_basis) : null,
      due_on: dueEvent ? stringOrNull(dueEvent.due_on) : null,
      due_hours: dueEvent ? numberOrNull(dueEvent.due_hours) : null,
      due_status: dueStatus,
      service_agreement_id: dueEvent ? stringOrNull(dueEvent.service_agreement_id) : null,
      equipment_id: dueEvent ? stringOrNull(dueEvent.equipment_id) : null,
      job_number: job ? stringOrNull(job.wo_number) ?? stringOrNull(job.tracking_token) : null,
      scheduled_start_at: job ? stringOrNull(job.scheduled_start_at) : null,
    }];
  });
}

export function isOpenSchedulePrompt(
  prompt: Pick<ServicePlanSchedulePrompt, "due_status" | "scheduled_start_at">,
): boolean {
  return (prompt.due_status === "detected" || prompt.due_status === "job_created")
    && prompt.scheduled_start_at === null;
}

export function parseBaselineHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Baseline hours must be a non-negative number.");
  }
  return Math.round(parsed * 10) / 10;
}
