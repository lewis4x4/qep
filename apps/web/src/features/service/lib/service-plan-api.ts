import { supabase } from "@/lib/supabase";
import {
  normalizeServicePlanEnrollment,
  normalizeServicePlanEnrollments,
  normalizeServicePlanEntitlementBalances,
  normalizeServicePlanProgram,
  normalizeServicePlanProgramIntervals,
  normalizeServicePlanPrograms,
  normalizeServicePlanSchedulePrompts,
  type ServicePlanCancellationKind,
  type ServicePlanEnrollment,
  type ServicePlanEnrollmentStatus,
  type ServicePlanEntitlementBalance,
  type ServicePlanProgram,
  type ServicePlanProgramInterval,
  type ServicePlanSchedulePrompt,
} from "./service-plan-utils";

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function listServicePlanPrograms(): Promise<ServicePlanProgram[]> {
  const { data, error } = await supabase
    .from("service_agreement_programs")
    .select(`
      id,
      program_code,
      name,
      sponsor,
      description,
      catalog_owner,
      is_provisional,
      review_status,
      is_active,
      reviewed_by,
      reviewed_at,
      review_notes,
      activated_by,
      activated_at,
      deactivated_at,
      service_agreement_program_intervals (
        id,
        program_id,
        interval_code,
        name,
        interval_hours,
        interval_months,
        interval_days,
        entitlement_unit,
        entitlement_quantity,
        is_active
      )
    `)
    .is("deleted_at", null)
    .order("program_code");
  throwOnError(error);
  return normalizeServicePlanPrograms(data);
}

export async function listOpenServicePlanSchedulePrompts(): Promise<ServicePlanSchedulePrompt[]> {
  const { data, error } = await supabase
    .from("service_plan_schedule_prompts")
    .select(`
      id,
      due_event_id,
      service_job_id,
      prompt_type,
      prompt_key,
      evidence,
      created_at,
      service_plan_pm_due_events (
        status,
        due_basis,
        due_on,
        due_hours,
        service_agreement_id,
        equipment_id
      ),
      service_jobs (
        wo_number,
        tracking_token
      )
    `)
    .order("created_at", { ascending: false });
  throwOnError(error);
  return normalizeServicePlanSchedulePrompts(data).filter(
    (prompt) => prompt.due_status === "detected" || prompt.due_status === "job_created",
  );
}

export async function getServicePlanEnrollmentForAgreement(
  agreementId: string,
): Promise<ServicePlanEnrollment | null> {
  const { data, error } = await supabase
    .from("service_plan_equipment_enrollments")
    .select(`
      id,
      service_agreement_id,
      program_id,
      equipment_id,
      status,
      enrolled_on,
      requested_baseline_hours,
      baseline_hours,
      baseline_source,
      baseline_meter_reading_id,
      enrolled_by,
      ended_at,
      end_reason,
      service_plan_enrollment_schedules (
        id,
        enrollment_id,
        program_interval_id,
        cycle_number,
        baseline_on,
        baseline_hours,
        next_due_on,
        next_due_hours,
        last_completed_job_id,
        last_completed_at
      )
    `)
    .eq("service_agreement_id", agreementId)
    .maybeSingle();
  throwOnError(error);
  return normalizeServicePlanEnrollment(data);
}

export async function listServicePlanEntitlementBalances(
  agreementId: string,
): Promise<ServicePlanEntitlementBalance[]> {
  const { data, error } = await supabase
    .from("service_agreement_entitlement_balances")
    .select("service_agreement_id, unit_code, available_quantity, reserved_quantity, consumed_quantity, granted_quantity")
    .eq("service_agreement_id", agreementId);
  throwOnError(error);
  return normalizeServicePlanEntitlementBalances(data);
}

export async function reviewServicePlanProgram(input: {
  workspaceId: string;
  programId: string;
  reviewerId: string;
  reviewNotes: string;
}): Promise<ServicePlanProgram> {
  const { data, error } = await supabase.rpc("service_plan_review_program", {
    p_workspace_id: input.workspaceId,
    p_program_id: input.programId,
    p_reviewer_id: input.reviewerId,
    p_review_notes: input.reviewNotes,
  });
  throwOnError(error);
  const program = normalizeServicePlanProgram(data);
  if (!program) throw new Error("Review succeeded but returned an unexpected program payload.");
  return program;
}

export async function setServicePlanProgramActivation(input: {
  workspaceId: string;
  programId: string;
  isActive: boolean;
  actorId: string;
}): Promise<ServicePlanProgram> {
  const { data, error } = await supabase.rpc("service_plan_set_program_activation", {
    p_workspace_id: input.workspaceId,
    p_program_id: input.programId,
    p_is_active: input.isActive,
    p_actor_id: input.actorId,
  });
  throwOnError(error);
  const program = normalizeServicePlanProgram(data);
  if (!program) throw new Error("Activation update succeeded but returned an unexpected program payload.");
  return program;
}

export async function saveServicePlanProgramInterval(input: {
  workspaceId: string;
  programId: string;
  intervalCode: string;
  name: string;
  intervalHours: number | null;
  intervalMonths: number | null;
  intervalDays: number | null;
  actorId: string;
  entitlementUnit?: string;
  entitlementQuantity?: number;
}): Promise<ServicePlanProgramInterval> {
  const { data, error } = await supabase.rpc("service_plan_save_program_interval", {
    p_workspace_id: input.workspaceId,
    p_program_id: input.programId,
    p_interval_code: input.intervalCode,
    p_name: input.name,
    p_interval_hours: input.intervalHours,
    p_interval_months: input.intervalMonths,
    p_interval_days: input.intervalDays,
    p_entitlement_unit: input.entitlementUnit ?? "pm_service",
    p_entitlement_quantity: input.entitlementQuantity ?? 1,
    p_source_evidence: {},
    p_actor_id: input.actorId,
  });
  throwOnError(error);
  const interval = normalizeServicePlanProgramIntervals(data ? [data] : [])[0];
  if (!interval) throw new Error("Interval save succeeded but returned an unexpected payload.");
  return interval;
}

export async function enrollServicePlanEquipment(input: {
  workspaceId: string;
  serviceAgreementId: string;
  enrolledOn: string;
  baselineHours: number | null;
  actorId: string;
}): Promise<ServicePlanEnrollment> {
  const { data, error } = await supabase.rpc("service_plan_enroll_equipment", {
    p_workspace_id: input.workspaceId,
    p_service_agreement_id: input.serviceAgreementId,
    p_enrolled_on: input.enrolledOn,
    p_baseline_hours: input.baselineHours,
    p_actor_id: input.actorId,
  });
  throwOnError(error);
  const enrollment = normalizeServicePlanEnrollment(data);
  if (!enrollment) throw new Error("Enrollment succeeded but returned an unexpected payload.");
  return enrollment;
}

export async function setServicePlanEnrollmentStatus(input: {
  workspaceId: string;
  enrollmentId: string;
  status: ServicePlanEnrollmentStatus;
  actorId: string;
  reason?: string | null;
}): Promise<ServicePlanEnrollment> {
  const { data, error } = await supabase.rpc("service_plan_set_enrollment_status", {
    p_workspace_id: input.workspaceId,
    p_enrollment_id: input.enrollmentId,
    p_status: input.status,
    p_actor_id: input.actorId,
    p_reason: input.reason ?? null,
  });
  throwOnError(error);
  const enrollment = normalizeServicePlanEnrollment(data);
  if (!enrollment) throw new Error("Enrollment status update succeeded but returned an unexpected payload.");
  return enrollment;
}

export async function cancelServicePlanPmDueEvent(input: {
  workspaceId: string;
  dueEventId: string;
  cancellationKind: ServicePlanCancellationKind;
  reason: string;
  actorId: string;
}): Promise<void> {
  const { error } = await supabase.rpc("service_plan_cancel_pm_due_event", {
    p_workspace_id: input.workspaceId,
    p_due_event_id: input.dueEventId,
    p_cancellation_kind: input.cancellationKind,
    p_reason: input.reason,
    p_actor_id: input.actorId,
  });
  throwOnError(error);
}

export async function postServicePlanEntitlement(input: {
  workspaceId: string;
  serviceAgreementId: string;
  entryType: "grant" | "reserve" | "release" | "consume";
  unitCode: string;
  quantity: number;
  idempotencyKey: string;
  reason: string;
  actorId: string;
  enrollmentId?: string | null;
  serviceJobId?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("service_plan_post_entitlement", {
    p_workspace_id: input.workspaceId,
    p_service_agreement_id: input.serviceAgreementId,
    p_entry_type: input.entryType,
    p_unit_code: input.unitCode,
    p_quantity: input.quantity,
    p_idempotency_key: input.idempotencyKey,
    p_reason: input.reason,
    p_actor_id: input.actorId,
    p_enrollment_id: input.enrollmentId ?? null,
    p_service_job_id: input.serviceJobId ?? null,
    p_related_entry_id: null,
    p_metadata: {},
  });
  throwOnError(error);
}

export async function listServicePlanEnrollments(): Promise<ServicePlanEnrollment[]> {
  const { data, error } = await supabase
    .from("service_plan_equipment_enrollments")
    .select(`
      id,
      service_agreement_id,
      program_id,
      equipment_id,
      status,
      enrolled_on,
      requested_baseline_hours,
      baseline_hours,
      baseline_source,
      baseline_meter_reading_id,
      enrolled_by,
      ended_at,
      end_reason,
      service_plan_enrollment_schedules (
        id,
        enrollment_id,
        program_interval_id,
        cycle_number,
        baseline_on,
        baseline_hours,
        next_due_on,
        next_due_hours,
        last_completed_job_id,
        last_completed_at
      )
    `)
    .order("enrolled_on", { ascending: false });
  throwOnError(error);
  return normalizeServicePlanEnrollments(data);
}
