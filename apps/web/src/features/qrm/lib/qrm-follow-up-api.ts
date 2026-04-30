import { crmSupabase, type QrmDatabase } from "./qrm-supabase";
import type {
  QrmEnrollmentStatus,
  QrmFollowUpSequence,
  QrmFollowUpSequenceEditorInput,
  QrmFollowUpStep,
  QrmSequenceEnrollment,
} from "./types";

type SequenceRow = QrmDatabase["public"]["Tables"]["follow_up_sequences"]["Row"];
type StepRow = QrmDatabase["public"]["Tables"]["follow_up_steps"]["Row"];
type EnrollmentRow = QrmDatabase["public"]["Tables"]["sequence_enrollments"]["Row"];

export const ALLOWED_SEQUENCE_TRIGGER_STAGES = ["quote_sent"] as const;

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
  for (const row of (steps ?? []) as StepRow[]) {
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

  const stepMap = await loadSequenceSteps([sequenceId]);
  return {
    id: sequence.id,
    name: sequence.name,
    description: sequence.description,
    triggerStage: sequence.trigger_stage,
    isActive: sequence.is_active,
    createdBy: sequence.created_by,
    createdAt: sequence.created_at,
    updatedAt: sequence.updated_at,
    steps: stepMap.get(sequence.id) ?? [],
  };
}

function toSequenceFromRpc(payload: unknown): QrmFollowUpSequence {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;

  if (!record || typeof record.id !== "string" || typeof record.name !== "string") {
    throw new Error("Saved sequence response was invalid.");
  }

  const steps = Array.isArray(record.steps)
    ? record.steps.map((step) => {
        const stepRecord = step as Record<string, unknown>;
        return {
          id: String(stepRecord.id),
          sequenceId: String(stepRecord.sequenceId),
          stepNumber: Number(stepRecord.stepNumber),
          dayOffset: Number(stepRecord.dayOffset),
          stepType: stepRecord.stepType as QrmFollowUpStep["stepType"],
          subject: typeof stepRecord.subject === "string" ? stepRecord.subject : null,
          bodyTemplate: typeof stepRecord.bodyTemplate === "string" ? stepRecord.bodyTemplate : null,
          taskPriority: typeof stepRecord.taskPriority === "string" ? stepRecord.taskPriority : null,
          createdAt: String(stepRecord.createdAt),
        };
      })
    : [];

  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === "string" ? record.description : null,
    triggerStage: String(record.triggerStage),
    isActive: Boolean(record.isActive),
    createdBy: typeof record.createdBy === "string" ? record.createdBy : null,
    createdAt: String(record.createdAt),
    updatedAt: String(record.updatedAt),
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

  const sequenceRows = (sequences ?? []) as SequenceRow[];
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
  if (!ALLOWED_SEQUENCE_TRIGGER_STAGES.includes(normalizedTriggerStage as (typeof ALLOWED_SEQUENCE_TRIGGER_STAGES)[number])) {
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

  return toSequenceFromRpc(data);
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

  const enrollmentRows = (enrollments ?? []) as EnrollmentRow[];
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

  const sequenceNameById = new Map((sequences ?? []).map((row) => [row.id, row.name]));

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
