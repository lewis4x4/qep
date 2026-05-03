import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

const SOP_ENGINE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sop-engine`;
const SOP_INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sop-ingest`;
const SOP_SUGGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sop-suggest`;

/* ── Types matching backend schema (migrations 152 + 158) ─────────── */

export type SopDepartment = "sales" | "service" | "parts" | "admin" | "all";
export type SopStatus = "draft" | "active" | "archived";
export type SopExecutionStatus = "in_progress" | "completed" | "abandoned" | "blocked";

const sopSupabase: SupabaseClient<Database> = supabase;

const SOP_DEPARTMENTS = ["sales", "service", "parts", "admin", "all"] as const;

type Tables = Database["public"]["Tables"];
type SopStepRow = Tables["sop_steps"]["Row"];
type SopExecutionRow = Tables["sop_executions"]["Row"];
type SopStepCompletionRow = Tables["sop_step_completions"]["Row"];

export interface SopTemplate {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  department: SopDepartment;
  version: number;
  status: SopStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  document_id: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  /** From sop_steps(count) aggregate in list query. */
  sop_steps?: Array<{ count: number }>;
}

export interface SopStep {
  id: string;
  sop_template_id: string;
  sort_order: number;
  title: string;
  instructions: string | null;
  required_role: string | null;
  estimated_duration_minutes: number | null;
  is_decision_point: boolean;
  decision_options: Array<{ label: string; next_step?: number }> | null;
  attachment_urls: string[];
  created_at: string;
  updated_at: string;
}

export interface SopExecution {
  id: string;
  workspace_id: string;
  sop_template_id: string;
  started_by: string | null;
  assigned_to: string | null;
  context_entity_type: string | null;
  context_entity_id: string | null;
  status: SopExecutionStatus;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sop_templates?: { title: string; department: SopDepartment };
  sop_step_completions?: Array<{ count: number }>;
}

export interface SopStepCompletion {
  id: string;
  sop_execution_id: string;
  sop_step_id: string;
  completed_by: string | null;
  completed_at: string;
  decision_taken: string | null;
  notes: string | null;
  evidence_urls: string[];
  duration_minutes: number | null;
}

export interface SopSuggestion {
  id: string;
  title: string;
  description: string | null;
  department: SopDepartment;
  tags: string[] | null;
  version: number;
  relevance_score: number;
  nudge: string;
}

export interface ActiveSopExecution extends Pick<SopExecution, "id" | "status" | "sop_template_id"> {
  sop_templates?: { title: string } | null;
}

export interface SopSuppressionQueueItem {
  id: string;
  workspace_id: string;
  sop_execution_id: string;
  sop_step_id: string;
  proposed_state: SopCompletionState;
  proposed_evidence: Record<string, unknown> | null;
  confidence_score: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  sop_executions?: {
    id: string;
    sop_template_id: string;
    context_entity_type: string | null;
    context_entity_id: string | null;
    status: SopExecutionStatus;
  };
  sop_steps?: {
    id: string;
    sort_order: number;
    title: string;
    sop_template_id: string;
  };
  sop_templates?: {
    id: string;
    title: string;
    department: SopDepartment;
  };
}

/* ── Unknown-safe normalizers ────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecordField(value: Record<string, unknown>, field: string, fallbackMessage: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue === "string") return fieldValue;
  throw new Error(fallbackMessage);
}

function nullableStringFromRecordField(value: Record<string, unknown>, field: string, fallbackMessage: string): string | null {
  const fieldValue = value[field];
  if (fieldValue === null || fieldValue === undefined) return null;
  if (typeof fieldValue === "string") return fieldValue;
  throw new Error(fallbackMessage);
}

function numberFromRecordField(value: Record<string, unknown>, field: string, fallbackMessage: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) return fieldValue;
  throw new Error(fallbackMessage);
}

function nullableNumberFromRecordField(value: Record<string, unknown>, field: string, fallbackMessage: string): number | null {
  const fieldValue = value[field];
  if (fieldValue === null || fieldValue === undefined) return null;
  if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) return fieldValue;
  throw new Error(fallbackMessage);
}

function booleanFromRecordField(value: Record<string, unknown>, field: string, fallbackMessage: string): boolean {
  const fieldValue = value[field];
  if (typeof fieldValue === "boolean") return fieldValue;
  throw new Error(fallbackMessage);
}

function nullableBooleanFromRecordField(value: Record<string, unknown>, field: string, fallbackMessage: string): boolean | null {
  const fieldValue = value[field];
  if (fieldValue === null || fieldValue === undefined) return null;
  if (typeof fieldValue === "boolean") return fieldValue;
  throw new Error(fallbackMessage);
}

function normalizeStringArray(value: unknown, fallbackMessage: string): string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error(fallbackMessage);
}

function normalizeRecordOrNull(value: unknown, fallbackMessage: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (isRecord(value)) return value;
  throw new Error(fallbackMessage);
}

function normalizeCountAggregate(value: unknown, fallbackMessage: string): Array<{ count: number }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(fallbackMessage);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(fallbackMessage);
    return { count: numberFromRecordField(item, "count", fallbackMessage) };
  });
}

function normalizeDecisionOptions(value: unknown, fallbackMessage: string): Array<{ label: string; next_step?: number }> | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new Error(fallbackMessage);
  return value.map((option) => {
    if (!isRecord(option)) throw new Error(fallbackMessage);
    const label = stringFromRecordField(option, "label", fallbackMessage);
    const nextStep = option.next_step;
    if (nextStep === undefined || nextStep === null) return { label };
    if (typeof nextStep === "number" && Number.isFinite(nextStep)) return { label, next_step: nextStep };
    throw new Error(fallbackMessage);
  });
}

export function isSopDepartment(value: unknown): value is SopDepartment {
  return typeof value === "string" && SOP_DEPARTMENTS.some((department) => department === value);
}

export function normalizeSopDepartment(value: unknown, fallback: SopDepartment = "all"): SopDepartment {
  return isSopDepartment(value) ? value : fallback;
}

function requireSopDepartment(value: unknown, fallbackMessage: string): SopDepartment {
  if (isSopDepartment(value)) return value;
  throw new Error(fallbackMessage);
}

function requireSopStatus(value: unknown, fallbackMessage: string): SopStatus {
  if (value === "draft" || value === "active" || value === "archived") return value;
  throw new Error(fallbackMessage);
}

function requireSopExecutionStatus(value: unknown, fallbackMessage: string): SopExecutionStatus {
  if (value === "in_progress" || value === "completed" || value === "abandoned" || value === "blocked") return value;
  throw new Error(fallbackMessage);
}

function requireSopCompletionState(value: unknown, fallbackMessage: string): SopCompletionState {
  if (
    value === "completed" ||
    value === "skipped" ||
    value === "deferred" ||
    value === "satisfied_elsewhere" ||
    value === "not_applicable"
  ) return value;
  throw new Error(fallbackMessage);
}

export function sopErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value)) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    const error = value.error;
    if (typeof error === "string" && error.trim()) return error.trim();
  }
  return fallback;
}

export function normalizeSopTemplatePayload(value: unknown, fallbackMessage = "Invalid SOP template response"): SopTemplate {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    workspace_id: stringFromRecordField(value, "workspace_id", fallbackMessage),
    title: stringFromRecordField(value, "title", fallbackMessage),
    description: nullableStringFromRecordField(value, "description", fallbackMessage),
    department: requireSopDepartment(value.department, fallbackMessage),
    version: numberFromRecordField(value, "version", fallbackMessage),
    status: requireSopStatus(value.status, fallbackMessage),
    created_by: nullableStringFromRecordField(value, "created_by", fallbackMessage),
    approved_by: nullableStringFromRecordField(value, "approved_by", fallbackMessage),
    approved_at: nullableStringFromRecordField(value, "approved_at", fallbackMessage),
    document_id: nullableStringFromRecordField(value, "document_id", fallbackMessage),
    tags: normalizeStringArray(value.tags, fallbackMessage),
    created_at: stringFromRecordField(value, "created_at", fallbackMessage),
    updated_at: stringFromRecordField(value, "updated_at", fallbackMessage),
    sop_steps: normalizeCountAggregate(value.sop_steps, fallbackMessage),
  };
}

export function normalizeSopStepPayload(value: unknown, fallbackMessage = "Invalid SOP step response"): SopStep {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    sop_template_id: stringFromRecordField(value, "sop_template_id", fallbackMessage),
    sort_order: numberFromRecordField(value, "sort_order", fallbackMessage),
    title: stringFromRecordField(value, "title", fallbackMessage),
    instructions: nullableStringFromRecordField(value, "instructions", fallbackMessage),
    required_role: nullableStringFromRecordField(value, "required_role", fallbackMessage),
    estimated_duration_minutes: nullableNumberFromRecordField(value, "estimated_duration_minutes", fallbackMessage),
    is_decision_point: nullableBooleanFromRecordField(value, "is_decision_point", fallbackMessage) ?? false,
    decision_options: normalizeDecisionOptions(value.decision_options, fallbackMessage),
    attachment_urls: normalizeStringArray(value.attachment_urls, fallbackMessage) ?? [],
    created_at: stringFromRecordField(value, "created_at", fallbackMessage),
    updated_at: stringFromRecordField(value, "updated_at", fallbackMessage),
  };
}

export function normalizeSopExecutionPayload(value: unknown, fallbackMessage = "Invalid SOP execution response"): SopExecution {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  const template = value.sop_templates;
  let sopTemplates: SopExecution["sop_templates"];
  if (template !== undefined && template !== null) {
    if (!isRecord(template)) throw new Error(fallbackMessage);
    sopTemplates = {
      title: stringFromRecordField(template, "title", fallbackMessage),
      department: requireSopDepartment(template.department, fallbackMessage),
    };
  }
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    workspace_id: stringFromRecordField(value, "workspace_id", fallbackMessage),
    sop_template_id: stringFromRecordField(value, "sop_template_id", fallbackMessage),
    started_by: nullableStringFromRecordField(value, "started_by", fallbackMessage),
    assigned_to: nullableStringFromRecordField(value, "assigned_to", fallbackMessage),
    context_entity_type: nullableStringFromRecordField(value, "context_entity_type", fallbackMessage),
    context_entity_id: nullableStringFromRecordField(value, "context_entity_id", fallbackMessage),
    status: requireSopExecutionStatus(value.status, fallbackMessage),
    started_at: stringFromRecordField(value, "started_at", fallbackMessage),
    completed_at: nullableStringFromRecordField(value, "completed_at", fallbackMessage),
    notes: nullableStringFromRecordField(value, "notes", fallbackMessage),
    created_at: stringFromRecordField(value, "created_at", fallbackMessage),
    updated_at: stringFromRecordField(value, "updated_at", fallbackMessage),
    sop_templates: sopTemplates,
    sop_step_completions: normalizeCountAggregate(value.sop_step_completions, fallbackMessage),
  };
}

export function normalizeSopStepCompletionPayload(
  value: unknown,
  fallbackMessage = "Invalid SOP completion response",
): SopStepCompletion {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    sop_execution_id: stringFromRecordField(value, "sop_execution_id", fallbackMessage),
    sop_step_id: stringFromRecordField(value, "sop_step_id", fallbackMessage),
    completed_by: nullableStringFromRecordField(value, "completed_by", fallbackMessage),
    completed_at: stringFromRecordField(value, "completed_at", fallbackMessage),
    decision_taken: nullableStringFromRecordField(value, "decision_taken", fallbackMessage),
    notes: nullableStringFromRecordField(value, "notes", fallbackMessage),
    evidence_urls: normalizeStringArray(value.evidence_urls, fallbackMessage) ?? [],
    duration_minutes: nullableNumberFromRecordField(value, "duration_minutes", fallbackMessage),
  };
}

function normalizeSopSuggestionPayload(value: unknown, fallbackMessage: string): SopSuggestion {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    title: stringFromRecordField(value, "title", fallbackMessage),
    description: nullableStringFromRecordField(value, "description", fallbackMessage),
    department: requireSopDepartment(value.department, fallbackMessage),
    tags: normalizeStringArray(value.tags, fallbackMessage),
    version: numberFromRecordField(value, "version", fallbackMessage),
    relevance_score: numberFromRecordField(value, "relevance_score", fallbackMessage),
    nudge: stringFromRecordField(value, "nudge", fallbackMessage),
  };
}

function normalizeSuppressionQueueItemPayload(value: unknown, fallbackMessage: string): SopSuppressionQueueItem {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  const execution = value.sop_executions;
  const step = value.sop_steps;
  const template = value.sop_templates;
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    workspace_id: stringFromRecordField(value, "workspace_id", fallbackMessage),
    sop_execution_id: stringFromRecordField(value, "sop_execution_id", fallbackMessage),
    sop_step_id: stringFromRecordField(value, "sop_step_id", fallbackMessage),
    proposed_state: requireSopCompletionState(value.proposed_state, fallbackMessage),
    proposed_evidence: normalizeRecordOrNull(value.proposed_evidence, fallbackMessage),
    confidence_score: numberFromRecordField(value, "confidence_score", fallbackMessage),
    reason: nullableStringFromRecordField(value, "reason", fallbackMessage),
    status: requireSuppressionStatus(value.status, fallbackMessage),
    resolved_by: nullableStringFromRecordField(value, "resolved_by", fallbackMessage),
    resolved_at: nullableStringFromRecordField(value, "resolved_at", fallbackMessage),
    created_at: stringFromRecordField(value, "created_at", fallbackMessage),
    updated_at: stringFromRecordField(value, "updated_at", fallbackMessage),
    sop_executions: execution === undefined || execution === null ? undefined : normalizeSuppressionExecution(execution, fallbackMessage),
    sop_steps: step === undefined || step === null ? undefined : normalizeSuppressionStep(step, fallbackMessage),
    sop_templates: template === undefined || template === null ? undefined : normalizeSuppressionTemplate(template, fallbackMessage),
  };
}

function requireSuppressionStatus(value: unknown, fallbackMessage: string): SopSuppressionQueueItem["status"] {
  if (value === "pending" || value === "approved" || value === "rejected") return value;
  throw new Error(fallbackMessage);
}

function normalizeSuppressionExecution(value: unknown, fallbackMessage: string): NonNullable<SopSuppressionQueueItem["sop_executions"]> {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    sop_template_id: stringFromRecordField(value, "sop_template_id", fallbackMessage),
    context_entity_type: nullableStringFromRecordField(value, "context_entity_type", fallbackMessage),
    context_entity_id: nullableStringFromRecordField(value, "context_entity_id", fallbackMessage),
    status: requireSopExecutionStatus(value.status, fallbackMessage),
  };
}

function normalizeSuppressionStep(value: unknown, fallbackMessage: string): NonNullable<SopSuppressionQueueItem["sop_steps"]> {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    sort_order: numberFromRecordField(value, "sort_order", fallbackMessage),
    title: stringFromRecordField(value, "title", fallbackMessage),
    sop_template_id: stringFromRecordField(value, "sop_template_id", fallbackMessage),
  };
}

function normalizeSuppressionTemplate(value: unknown, fallbackMessage: string): NonNullable<SopSuppressionQueueItem["sop_templates"]> {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return {
    id: stringFromRecordField(value, "id", fallbackMessage),
    title: stringFromRecordField(value, "title", fallbackMessage),
    department: requireSopDepartment(value.department, fallbackMessage),
  };
}

function normalizeArray<T>(value: unknown, normalizer: (item: unknown) => T, fallbackMessage: string): T[] {
  if (!Array.isArray(value)) throw new Error(fallbackMessage);
  return value.map(normalizer);
}

function normalizeObjectMember<T>(
  value: unknown,
  field: string,
  normalizer: (item: unknown) => T,
  fallbackMessage: string,
): T {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  return normalizer(value[field]);
}

/* ── Auth helper ─────────────────────────────────────────────────── */

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(url: string, normalize: (payload: unknown) => T, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(sopErrorMessage(payload, `Request failed (${res.status})`));
  }
  return normalize(payload);
}

function normalizeTemplateResponse(payload: unknown): { template: SopTemplate } {
  return { template: normalizeObjectMember(payload, "template", normalizeSopTemplatePayload, "Invalid SOP template response") };
}

function normalizeStepResponse(payload: unknown): { step: SopStep } {
  return { step: normalizeObjectMember(payload, "step", normalizeSopStepPayload, "Invalid SOP step response") };
}

function normalizeExecutionResponse(payload: unknown): { execution: SopExecution } {
  return { execution: normalizeObjectMember(payload, "execution", normalizeSopExecutionPayload, "Invalid SOP execution response") };
}

function normalizeCompletionResponse(payload: unknown): { completion: SopStepCompletion } {
  return {
    completion: normalizeObjectMember(payload, "completion", normalizeSopStepCompletionPayload, "Invalid SOP completion response"),
  };
}

function normalizeSkipResponse(payload: unknown): { skip: Record<string, unknown> } {
  return { skip: normalizeObjectMember(payload, "skip", (item) => normalizeRecordOrNull(item, "Invalid SOP skip response") ?? {}, "Invalid SOP skip response") };
}

function normalizeTemplatesResponse(payload: unknown): { templates: SopTemplate[] } {
  if (!isRecord(payload)) throw new Error("Invalid SOP templates response");
  return {
    templates: normalizeArray(
      payload.templates,
      (item) => normalizeSopTemplatePayload(item, "Invalid SOP templates response"),
      "Invalid SOP templates response",
    ),
  };
}

function normalizeExecutionsResponse(payload: unknown): { executions: SopExecution[] } {
  if (!isRecord(payload)) throw new Error("Invalid SOP executions response");
  return {
    executions: normalizeArray(
      payload.executions,
      (item) => normalizeSopExecutionPayload(item, "Invalid SOP executions response"),
      "Invalid SOP executions response",
    ),
  };
}

function normalizeSuppressionQueueResponse(payload: unknown): { items: SopSuppressionQueueItem[] } {
  if (!isRecord(payload)) throw new Error("Invalid SOP suppression queue response");
  return {
    items: normalizeArray(
      payload.items,
      (item) => normalizeSuppressionQueueItemPayload(item, "Invalid SOP suppression queue response"),
      "Invalid SOP suppression queue response",
    ),
  };
}

function normalizeSuppressionQueueItemResponse(payload: unknown): { item: SopSuppressionQueueItem } {
  return {
    item: normalizeObjectMember(
      payload,
      "item",
      (item) => normalizeSuppressionQueueItemPayload(item, "Invalid SOP suppression queue response"),
      "Invalid SOP suppression queue response",
    ),
  };
}

export function normalizeSopIngestResponse(payload: unknown): {
  ok: boolean;
  template_id: string;
  template_title: string;
  steps_extracted: number;
  total_steps_parsed: number;
  parse_confidence: number;
  status: string;
} {
  const fallbackMessage = "Invalid SOP ingest response";
  if (!isRecord(payload)) throw new Error(fallbackMessage);
  return {
    ok: booleanFromRecordField(payload, "ok", fallbackMessage),
    template_id: stringFromRecordField(payload, "template_id", fallbackMessage),
    template_title: stringFromRecordField(payload, "template_title", fallbackMessage),
    steps_extracted: numberFromRecordField(payload, "steps_extracted", fallbackMessage),
    total_steps_parsed: numberFromRecordField(payload, "total_steps_parsed", fallbackMessage),
    parse_confidence: numberFromRecordField(payload, "parse_confidence", fallbackMessage),
    status: stringFromRecordField(payload, "status", fallbackMessage),
  };
}

export function normalizeSopSuggestionsResponse(payload: unknown): {
  context: { entity_type: string; stage?: string; department: string };
  suggestions: SopSuggestion[];
  total_active_sops: number;
} {
  const fallbackMessage = "Invalid SOP suggestions response";
  if (!isRecord(payload) || !isRecord(payload.context)) throw new Error(fallbackMessage);
  const stage = payload.context.stage;
  if (stage !== undefined && typeof stage !== "string") throw new Error(fallbackMessage);
  return {
    context: {
      entity_type: stringFromRecordField(payload.context, "entity_type", fallbackMessage),
      stage,
      department: stringFromRecordField(payload.context, "department", fallbackMessage),
    },
    suggestions: normalizeArray(
      payload.suggestions,
      (item) => normalizeSopSuggestionPayload(item, fallbackMessage),
      fallbackMessage,
    ),
    total_active_sops: numberFromRecordField(payload, "total_active_sops", fallbackMessage),
  };
}

/* ── Template CRUD ───────────────────────────────────────────────── */

export async function listSopTemplates(department?: SopDepartment | "all"): Promise<{ templates: SopTemplate[] }> {
  const qs = department && department !== "all" ? `?department=${department}` : "";
  return request(`${SOP_ENGINE_URL}/templates${qs}`, normalizeTemplatesResponse);
}

export async function createSopTemplate(input: {
  title: string;
  department: SopDepartment;
  description?: string;
  tags?: string[];
  document_id?: string;
}): Promise<{ template: SopTemplate }> {
  return request(`${SOP_ENGINE_URL}/templates`, normalizeTemplateResponse, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function publishSopTemplate(templateId: string): Promise<{ template: SopTemplate }> {
  return request(`${SOP_ENGINE_URL}/templates/${templateId}/publish`, normalizeTemplateResponse, {
    method: "POST",
  });
}

export async function addSopStep(
  templateId: string,
  input: {
    title: string;
    sort_order: number;
    instructions?: string;
    required_role?: string;
    estimated_duration_minutes?: number;
    is_decision_point?: boolean;
  },
): Promise<{ step: SopStep }> {
  return request(`${SOP_ENGINE_URL}/templates/${templateId}/steps`, normalizeStepResponse, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Fetch a single template with its steps via direct table access (RLS scoped). */
export async function fetchTemplateWithSteps(templateId: string): Promise<{
  template: SopTemplate;
  steps: SopStep[];
}> {
  const { data: template, error: templateError } = await sopSupabase
    .from("sop_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (templateError) throw new Error(sopErrorMessage(templateError, "Failed to load template"));
  if (!template) throw new Error("Template not found");

  const { data: steps, error: stepsError } = await sopSupabase
    .from("sop_steps")
    .select("*")
    .eq("sop_template_id", templateId)
    .order("sort_order", { ascending: true });
  if (stepsError) throw new Error(sopErrorMessage(stepsError, "Failed to load steps"));

  return {
    template: normalizeSopTemplatePayload(template, "Invalid SOP template response"),
    steps: (steps ?? []).map((step: SopStepRow) => normalizeSopStepPayload(step, "Invalid SOP step response")),
  };
}

/* ── Executions ──────────────────────────────────────────────────── */

export async function listSopExecutions(): Promise<{ executions: SopExecution[] }> {
  return request(`${SOP_ENGINE_URL}/executions`, normalizeExecutionsResponse);
}

export async function startSopExecution(input: {
  sop_template_id: string;
  assigned_to?: string;
  context_entity_type?: string;
  context_entity_id?: string;
}): Promise<{ execution: SopExecution }> {
  return request(`${SOP_ENGINE_URL}/executions`, normalizeExecutionResponse, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type SopCompletionState =
  | "completed" | "skipped" | "deferred" | "satisfied_elsewhere" | "not_applicable";

export async function completeStep(
  executionId: string,
  input: {
    sop_step_id: string;
    decision_taken?: string;
    notes?: string;
    evidence_urls?: string[];
    duration_minutes?: number;
    /** Phase 2E: false-positive protection state. Default 'completed'. */
    completion_state?: SopCompletionState;
    /** Phase 2E: AI confidence in step→evidence mapping (0-1). */
    confidence_score?: number;
  },
): Promise<{ completion: SopStepCompletion }> {
  return request(
    `${SOP_ENGINE_URL}/executions/${executionId}/complete-step`,
    normalizeCompletionResponse,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * Mark a step as Not Applicable. Direct supabase write since the
 * sop-engine edge function doesn't yet route NA through complete-step.
 * RLS scopes by execution workspace.
 */
export async function markStepNotApplicable(
  executionId: string,
  stepId: string,
  reason: string,
): Promise<void> {
  const { error } = await sopSupabase.from("sop_step_completions").insert({
    sop_execution_id: executionId,
    sop_step_id: stepId,
    completion_state: "not_applicable",
    notes: reason,
  });
  if (error) throw new Error(sopErrorMessage(error, "NA mark failed"));
}

export async function skipStep(
  executionId: string,
  input: { sop_step_id: string; skip_reason?: string },
): Promise<{ skip: Record<string, unknown> }> {
  return request(
    `${SOP_ENGINE_URL}/executions/${executionId}/skip-step`,
    normalizeSkipResponse,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function closeExecution(
  executionId: string,
  input: { status?: SopExecutionStatus; notes?: string } = {},
): Promise<{ execution: SopExecution }> {
  return request(
    `${SOP_ENGINE_URL}/executions/${executionId}/close`,
    normalizeExecutionResponse,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function listSuppressionQueue(
  status: "pending" | "approved" | "rejected" = "pending",
): Promise<{ items: SopSuppressionQueueItem[] }> {
  return request(
    `${SOP_ENGINE_URL}/suppression-queue?status=${status}`,
    normalizeSuppressionQueueResponse,
  );
}

export async function resolveSuppressionQueueItem(
  itemId: string,
  status: "approved" | "rejected",
): Promise<{ item: SopSuppressionQueueItem }> {
  return request(
    `${SOP_ENGINE_URL}/suppression-queue/${itemId}/resolve`,
    normalizeSuppressionQueueItemResponse,
    {
      method: "POST",
      body: JSON.stringify({ status }),
    },
  );
}

/** Fetch execution details with all step completions and skips for the execution page. */
export async function fetchExecutionContext(executionId: string): Promise<{
  execution: SopExecution;
  template: SopTemplate;
  steps: SopStep[];
  completions: SopStepCompletion[];
  skipped_step_ids: string[];
}> {
  const { data: execution, error: execErr } = await sopSupabase
    .from("sop_executions")
    .select("*")
    .eq("id", executionId)
    .maybeSingle();
  if (execErr) throw new Error(sopErrorMessage(execErr, "Failed to load execution"));
  if (!execution) throw new Error("Execution not found");

  const exec = normalizeSopExecutionPayload(execution, "Invalid SOP execution response");
  const { template, steps } = await fetchTemplateWithSteps(exec.sop_template_id);

  const { data: completions, error: completionsErr } = await sopSupabase
    .from("sop_step_completions")
    .select("*")
    .eq("sop_execution_id", executionId)
    .order("completed_at", { ascending: true });
  if (completionsErr) throw new Error(sopErrorMessage(completionsErr, "Failed to load completions"));

  const skippedStepIds: string[] = [];
  try {
    const { data: skipRows } = await sopSupabase
      .from("sop_step_skips")
      .select("sop_step_id")
      .eq("sop_execution_id", executionId);
    if (Array.isArray(skipRows)) {
      for (const row of skipRows) {
        if (typeof row.sop_step_id === "string") skippedStepIds.push(row.sop_step_id);
      }
    }
  } catch {
    // Skips are additive signal; ignore load failure and treat as none.
  }

  return {
    execution: exec,
    template,
    steps,
    completions: (completions ?? []).map((completion: SopStepCompletionRow) =>
      normalizeSopStepCompletionPayload(completion, "Invalid SOP completion response"),
    ),
    skipped_step_ids: skippedStepIds,
  };
}

export async function fetchActiveSopExecutionForContext(input: {
  contextEntityType: "deal";
  contextEntityId: string;
}): Promise<{ activeExecution: ActiveSopExecution | null; skippedCount: number }> {
  const { data, error } = await sopSupabase
    .from("sop_executions")
    .select("id, status, sop_template_id")
    .eq("context_entity_type", input.contextEntityType)
    .eq("context_entity_id", input.contextEntityId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(sopErrorMessage(error, "Failed to load SOP execution."));

  const activeRow = (data ?? []).find((row: Pick<SopExecutionRow, "status">) => row.status === "in_progress");
  if (!activeRow) return { activeExecution: null, skippedCount: 0 };

  const active: ActiveSopExecution = {
    id: activeRow.id,
    status: requireSopExecutionStatus(activeRow.status, "Invalid SOP execution response"),
    sop_template_id: activeRow.sop_template_id,
    sop_templates: null,
  };

  const [skipResult, templateResult] = await Promise.all([
    sopSupabase
      .from("sop_step_skips")
      .select("*", { count: "exact", head: true })
      .eq("sop_execution_id", active.id),
    sopSupabase
      .from("sop_templates")
      .select("title")
      .eq("id", active.sop_template_id)
      .maybeSingle(),
  ]);

  if (skipResult.error) throw new Error(sopErrorMessage(skipResult.error, "Failed to load SOP skips."));
  if (templateResult.error) throw new Error(sopErrorMessage(templateResult.error, "Failed to load SOP template."));
  if (templateResult.data) {
    active.sop_templates = { title: templateResult.data.title };
  }

  return {
    activeExecution: active,
    skippedCount: skipResult.count ?? 0,
  };
}

/* ── AI Ingest ────────────────────────────────────────────────────── */

export async function ingestSopDocument(input: {
  text: string;
  department?: SopDepartment;
  title?: string;
  source_filename?: string;
  document_id?: string;
}): Promise<{
  ok: boolean;
  template_id: string;
  template_title: string;
  steps_extracted: number;
  total_steps_parsed: number;
  parse_confidence: number;
  status: string;
}> {
  return request(`${SOP_INGEST_URL}`, normalizeSopIngestResponse, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ── Suggestions (for SopSuggestionWidget in Task 9) ───────────── */

export async function fetchSopSuggestions(input: {
  entity_type: string;
  entity_id?: string;
  stage?: string;
  department?: SopDepartment;
}): Promise<{
  context: { entity_type: string; stage?: string; department: string };
  suggestions: SopSuggestion[];
  total_active_sops: number;
}> {
  return request(`${SOP_SUGGEST_URL}/for-context`, normalizeSopSuggestionsResponse, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
