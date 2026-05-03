import { crmSupabase, type QrmDatabase } from "./qrm-supabase";
import type {
  QrmEnrollmentStatus,
  QrmFollowUpSequence,
  QrmFollowUpSequenceEditorInput,
  QrmFollowUpStep,
  QrmFollowUpStepType,
  QrmSequenceEnrollment,
} from "./types";

type SequenceRow = QrmDatabase["public"]["Tables"]["follow_up_sequences"]["Row"];
type StepRow = QrmDatabase["public"]["Tables"]["follow_up_steps"]["Row"];
type SequenceNameRow = Pick<SequenceRow, "id" | "name">;
type EnrollmentSourceRow = {
  id: string;
  sequence_id: string;
  deal_id: string;
  deal_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner_id: string | null;
  hub_id: string;
  enrolled_at: string;
  current_step: number;
  next_step_due_at: string | null;
  status: QrmEnrollmentStatus;
  completed_at: string | null;
  cancelled_at: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export const ALLOWED_SEQUENCE_TRIGGER_STAGES = ["quote_sent"] as const;
const ALLOWED_SEQUENCE_TRIGGER_STAGE_SET: ReadonlySet<string> = new Set(ALLOWED_SEQUENCE_TRIGGER_STAGES);
const FOLLOW_UP_STEP_TYPES: readonly QrmFollowUpStepType[] = ["task", "email", "call_log", "stalled_alert"];
const FOLLOW_UP_STEP_TYPE_SET: ReadonlySet<string> = new Set(FOLLOW_UP_STEP_TYPES);
const ENROLLMENT_STATUSES: readonly QrmEnrollmentStatus[] = ["active", "completed", "paused", "cancelled"];
const ENROLLMENT_STATUS_SET: ReadonlySet<string> = new Set(ENROLLMENT_STATUSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return { ...value };
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isStepType(value: unknown): value is QrmFollowUpStepType {
  return typeof value === "string" && FOLLOW_UP_STEP_TYPE_SET.has(value);
}

function isEnrollmentStatus(value: unknown): value is QrmEnrollmentStatus {
  return typeof value === "string" && ENROLLMENT_STATUS_SET.has(value);
}

export function normalizeFollowUpStepRows(value: unknown): StepRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const sequenceId = requiredString(row.sequence_id);
    const stepNumber = requiredNumber(row.step_number);
    const dayOffset = requiredNumber(row.day_offset);
    const createdAt = requiredString(row.created_at);
    if (!id || !sequenceId || stepNumber == null || dayOffset == null || !isStepType(row.step_type) || !createdAt) return [];
    return [{
      id,
      sequence_id: sequenceId,
      step_number: stepNumber,
      day_offset: dayOffset,
      step_type: row.step_type,
      subject: nullableString(row.subject),
      body_template: nullableString(row.body_template),
      task_priority: nullableString(row.task_priority),
      created_at: createdAt,
    }];
  });
}

export function normalizeFollowUpSequenceRows(value: unknown): SequenceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const name = requiredString(row.name);
    const triggerStage = requiredString(row.trigger_stage);
    const createdAt = requiredString(row.created_at);
    const updatedAt = requiredString(row.updated_at);
    if (!id || !name || !triggerStage || !createdAt || !updatedAt) return [];
    return [{
      id,
      name,
      description: nullableString(row.description),
      trigger_stage: triggerStage,
      is_active: row.is_active === true,
      created_by: nullableString(row.created_by),
      created_at: createdAt,
      updated_at: updatedAt,
    }];
  });
}

export function normalizeSequenceNameRows(value: unknown): SequenceNameRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const name = requiredString(row.name);
    return id && name ? [{ id, name }] : [];
  });
}

export function normalizeSequenceEnrollmentRows(value: unknown): EnrollmentSourceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const sequenceId = requiredString(row.sequence_id);
    const dealId = requiredString(row.deal_id);
    const hubId = requiredString(row.hub_id);
    const enrolledAt = requiredString(row.enrolled_at);
    const currentStep = requiredNumber(row.current_step);
    const updatedAt = requiredString(row.updated_at);
    if (!id || !sequenceId || !dealId || !hubId || !enrolledAt || currentStep == null || !isEnrollmentStatus(row.status) || !updatedAt) return [];
    return [{
      id,
      sequence_id: sequenceId,
      deal_id: dealId,
      deal_name: nullableString(row.deal_name),
      contact_id: nullableString(row.contact_id),
      contact_name: nullableString(row.contact_name),
      owner_id: nullableString(row.owner_id),
      hub_id: hubId,
      enrolled_at: enrolledAt,
      current_step: currentStep,
      next_step_due_at: nullableString(row.next_step_due_at),
      status: row.status,
      completed_at: nullableString(row.completed_at),
      cancelled_at: nullableString(row.cancelled_at),
      metadata: normalizeJsonRecord(row.metadata),
      updated_at: updatedAt,
    }];
  });
}

function toStep(row: StepRow): QrmFollowUpStep {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    stepNumber: row.step_number,
    dayOffset: row.day_offset,
    stepType: row.step_type,
    subject: row.subject,
    bodyTemplate: row.body_template,
    taskPriority: row.task_priority,
    createdAt: row.created_at,
  };
}

async function loadSequenceSteps(sequenceIds: string[]): Promise<Map<string, QrmFollowUpStep[]>> {
  if (sequenceIds.length === 0) {
    return new Map();
  }

  const { data: steps, error: stepError } = await crmSupabase
    .from("follow_up_steps")
    .select("id, sequence_id, step_number, day_offset, step_type, subject, body_template, task_priority, created_at")
    .in("sequence_id", sequenceIds)
    .order("sequence_id", { ascending: true })
    .order("step_number", { ascending: true });

  if (stepError) {
    throw new Error(stepError.message);
  }

  const stepMap = new Map<string, QrmFollowUpStep[]>();
  for (const row of normalizeFollowUpStepRows(steps)) {
    const mapped = toStep(row);
    const current = stepMap.get(mapped.sequenceId) ?? [];
    current.push(mapped);
    stepMap.set(mapped.sequenceId, current);
  }
  return stepMap;
}

async function getCrmFollowUpSequence(sequenceId: string): Promise<QrmFollowUpSequence> {
  const { data: sequence, error: sequenceError } = await crmSupabase
    .from("follow_up_sequences")
    .select("id, name, description, trigger_stage, is_active, created_by, created_at, updated_at")
    .eq("id", sequenceId)
    .single();

  if (sequenceError || !sequence) {
    throw new Error(sequenceError?.message ?? "Could not reload follow-up sequence.");
  }

  const [sequenceRow] = normalizeFollowUpSequenceRows([sequence]);
  if (!sequenceRow) {
    throw new Error("Follow-up sequence response was invalid.");
  }

  const stepMap = await loadSequenceSteps([sequenceId]);
  return {
    id: sequenceRow.id,
    name: sequenceRow.name,
    description: sequenceRow.description,
    triggerStage: sequenceRow.trigger_stage,
    isActive: sequenceRow.is_active,
    createdBy: sequenceRow.created_by,
    createdAt: sequenceRow.created_at,
    updatedAt: sequenceRow.updated_at,
    steps: stepMap.get(sequenceRow.id) ?? [],
  };
}

export function normalizeFollowUpSequenceRpcPayload(payload: unknown): QrmFollowUpSequence | null {
  if (!isRecord(payload)) return null;
  const id = requiredString(payload.id);
  const name = requiredString(payload.name);
  const triggerStage = requiredString(payload.triggerStage);
  const createdAt = requiredString(payload.createdAt);
  const updatedAt = requiredString(payload.updatedAt);
  if (!id || !name || !triggerStage || !createdAt || !updatedAt) return null;

  const steps = Array.isArray(payload.steps)
    ? payload.steps.flatMap((step): QrmFollowUpStep[] => {
        if (!isRecord(step)) return [];
        const stepId = requiredString(step.id);
        const sequenceId = requiredString(step.sequenceId);
        const stepNumber = requiredNumber(step.stepNumber);
        const dayOffset = requiredNumber(step.dayOffset);
        const stepCreatedAt = requiredString(step.createdAt);
        if (!stepId || !sequenceId || stepNumber == null || dayOffset == null || !isStepType(step.stepType) || !stepCreatedAt) return [];
        return [{
          id: stepId,
          sequenceId,
          stepNumber,
          dayOffset,
          stepType: step.stepType,
          subject: nullableString(step.subject),
          bodyTemplate: nullableString(step.bodyTemplate),
          taskPriority: nullableString(step.taskPriority),
          createdAt: stepCreatedAt,
        }];
      })
    : [];

  return {
    id,
    name,
    description: nullableString(payload.description),
    triggerStage,
    isActive: payload.isActive === true,
    createdBy: nullableString(payload.createdBy),
    createdAt,
    updatedAt,
    steps,
  };
}

export async function listCrmFollowUpSequences(): Promise<QrmFollowUpSequence[]> {
  const { data: sequences, error: sequenceError } = await crmSupabase
    .from("follow_up_sequences")
    .select("id, name, description, trigger_stage, is_active, created_by, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (sequenceError) {
    throw new Error(sequenceError.message);
  }

  const sequenceRows = normalizeFollowUpSequenceRows(sequences);
  if (sequenceRows.length === 0) {
    return [];
  }

  const stepMap = await loadSequenceSteps(sequenceRows.map((row) => row.id));

  return sequenceRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    triggerStage: row.trigger_stage,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: stepMap.get(row.id) ?? [],
  }));
}

export async function saveCrmFollowUpSequence(
  input: QrmFollowUpSequenceEditorInput,
  userId: string,
): Promise<QrmFollowUpSequence> {
  const normalizedTriggerStage = input.triggerStage.trim();
  if (!ALLOWED_SEQUENCE_TRIGGER_STAGE_SET.has(normalizedTriggerStage)) {
    throw new Error("Choose a supported trigger stage.");
  }

  const normalizedName = input.name.trim();
  if (!normalizedName) {
    throw new Error("Sequence name is required.");
  }
  if (input.steps.length === 0) {
    throw new Error("Add at least one sequence step.");
  }

  const normalizedSteps = input.steps.map((step, index) => ({
    stepNumber: index + 1,
    dayOffset: step.dayOffset,
    stepType: step.stepType,
    subject: step.subject?.trim() || null,
    bodyTemplate: step.bodyTemplate?.trim() || null,
    taskPriority: step.taskPriority?.trim() || null,
  }));

  const rpcArgs: QrmDatabase["public"]["Functions"]["save_follow_up_sequence"]["Args"] = {
    p_name: normalizedName,
    p_trigger_stage: normalizedTriggerStage,
    p_is_active: input.isActive,
    p_actor_user_id: userId,
    p_steps: normalizedSteps,
  };
  const normalizedDescription = input.description?.trim();
  if (input.id) rpcArgs.p_sequence_id = input.id;
  if (normalizedDescription) rpcArgs.p_description = normalizedDescription;

  const { data, error } = await crmSupabase.rpc("save_follow_up_sequence", rpcArgs);

  if (error) {
    throw new Error(error.message);
  }

  const sequence = normalizeFollowUpSequenceRpcPayload(data);
  if (!sequence) {
    throw new Error("Saved sequence response was invalid.");
  }
  return sequence;
}

export async function listCrmSequenceEnrollments(): Promise<QrmSequenceEnrollment[]> {
  const { data: enrollments, error: enrollmentError } = await crmSupabase
    .from("sequence_enrollments")
    .select("id, sequence_id, deal_id, deal_name, contact_id, contact_name, owner_id, hub_id, enrolled_at, current_step, next_step_due_at, status, completed_at, cancelled_at, metadata, updated_at")
    .order("updated_at", { ascending: false })
    .limit(150);

  if (enrollmentError) {
    throw new Error(enrollmentError.message);
  }

  const enrollmentRows = normalizeSequenceEnrollmentRows(enrollments);
  if (enrollmentRows.length === 0) {
    return [];
  }

  const sequenceIds = Array.from(new Set(enrollmentRows.map((row) => row.sequence_id)));
  const { data: sequences, error: sequenceError } = await crmSupabase
    .from("follow_up_sequences")
    .select("id, name")
    .in("id", sequenceIds);

  if (sequenceError) {
    throw new Error(sequenceError.message);
  }

  const sequenceNameById = new Map(normalizeSequenceNameRows(sequences).map((row) => [row.id, row.name]));

  return enrollmentRows.map((row) => ({
    id: row.id,
    sequenceId: row.sequence_id,
    sequenceName: sequenceNameById.get(row.sequence_id) ?? "Sequence",
    dealId: row.deal_id,
    dealName: row.deal_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    ownerId: row.owner_id,
    hubId: row.hub_id,
    enrolledAt: row.enrolled_at,
    currentStep: row.current_step,
    nextStepDueAt: row.next_step_due_at,
    status: row.status,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    metadata: normalizeJsonRecord(row.metadata),
    updatedAt: row.updated_at,
  }));
}

export async function updateCrmSequenceEnrollmentStatus(
  enrollmentId: string,
  status: QrmEnrollmentStatus,
): Promise<void> {
  const updates: QrmDatabase["public"]["Tables"]["sequence_enrollments"]["Update"] = {
    status,
  };

  if (status === "cancelled") {
    updates.cancelled_at = new Date().toISOString();
  } else if (status === "active") {
    updates.cancelled_at = null;
  }

  if (status === "active") {
    const { data: current, error: currentError } = await crmSupabase
      .from("sequence_enrollments")
      .select("next_step_due_at")
      .eq("id", enrollmentId)
      .single();

    if (currentError) {
      throw new Error(currentError.message);
    }

    if (!current.next_step_due_at) {
      updates.next_step_due_at = new Date().toISOString();
    }
  }

  const { error } = await crmSupabase
    .from("sequence_enrollments")
    .update(updates)
    .eq("id", enrollmentId);

  if (error) {
    throw new Error(error.message);
  }
}
