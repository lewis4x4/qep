import { supabase } from "@/lib/supabase";

const SOP_ENGINE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sop-engine`;
const SOP_INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sop-ingest`;
const SOP_SUGGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sop-suggest`;

/* ── Types matching backend schema (migrations 152 + 158) ─────────── */

export type SopDepartment = "sales" | "service" | "parts" | "admin" | "all";
export type SopStatus = "draft" | "active" | "archived";
export type SopExecutionStatus = "in_progress" | "completed" | "abandoned" | "blocked";

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

/* ── Auth helper ─────────────────────────────────────────────────── */

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
    throw new Error((err as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/* ── Template CRUD ───────────────────────────────────────────────── */

export async function listSopTemplates(department?: SopDepartment | "all"): Promise<{ templates: SopTemplate[] }> {
  const qs = department && department !== "all" ? `?department=${department}` : "";
  return request<{ templates: SopTemplate[] }>(`${SOP_ENGINE_URL}/templates${qs}`);
}

export async function createSopTemplate(input: {
  title: string;
  department: SopDepartment;
  description?: string;
  tags?: string[];
  document_id?: string;
}): Promise<{ template: SopTemplate }> {
  return request<{ template: SopTemplate }>(`${SOP_ENGINE_URL}/templates`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function publishSopTemplate(templateId: string): Promise<{ template: SopTemplate }> {
  return request<{ template: SopTemplate }>(`${SOP_ENGINE_URL}/templates/${templateId}/publish`, {
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
  return request<{ step: SopStep }>(`${SOP_ENGINE_URL}/templates/${templateId}/steps`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Fetch a single template with its steps via direct table access (RLS scoped). */
export async function fetchTemplateWithSteps(templateId: string): Promise<{
  template: SopTemplate;
  steps: SopStep[];
}> {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: SopTemplate | null; error: unknown }>;
          order: (c: string, o: Record<string, boolean>) => Promise<{ data: SopStep[] | null; error: unknown }>;
        };
      };
    };
  };

  const { data: template, error: templateError } = await sb
    .from("sop_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (templateError) throw new Error(String((templateError as { message?: string }).message ?? "Failed to load template"));
  if (!template) throw new Error("Template not found");

  const { data: steps, error: stepsError } = await sb
    .from("sop_steps")
    .select("*")
    .eq("sop_template_id", templateId)
    .order("sort_order", { ascending: true });
  if (stepsError) throw new Error(String((stepsError as { message?: string }).message ?? "Failed to load steps"));

  return { template, steps: steps ?? [] };
}

/* ── Executions ──────────────────────────────────────────────────── */

export async function listSopExecutions(): Promise<{ executions: SopExecution[] }> {
  return request<{ executions: SopExecution[] }>(`${SOP_ENGINE_URL}/executions`);
}

export async function startSopExecution(input: {
  sop_template_id: string;
  assigned_to?: string;
  context_entity_type?: string;
  context_entity_id?: string;
}): Promise<{ execution: SopExecution }> {
  return request<{ execution: SopExecution }>(`${SOP_ENGINE_URL}/executions`, {
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
  return request<{ completion: SopStepCompletion }>(
    `${SOP_ENGINE_URL}/executions/${executionId}/complete-step`,
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
  const { error } = await (supabase as unknown as {
    from: (t: string) => { insert: (v: Record<string, unknown>) => Promise<{ error: unknown }> };
  }).from("sop_step_completions").insert({
    sop_execution_id: executionId,
    sop_step_id: stepId,
    completion_state: "not_applicable",
    notes: reason,
  });
  if (error) throw new Error(String((error as { message?: string }).message ?? "NA mark failed"));
}

export async function skipStep(
  executionId: string,
  input: { sop_step_id: string; skip_reason?: string },
): Promise<{ skip: Record<string, unknown> }> {
  return request<{ skip: Record<string, unknown> }>(
    `${SOP_ENGINE_URL}/executions/${executionId}/skip-step`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function closeExecution(
  executionId: string,
  input: { status?: SopExecutionStatus; notes?: string } = {},
): Promise<{ execution: SopExecution }> {
  return request<{ execution: SopExecution }>(
    `${SOP_ENGINE_URL}/executions/${executionId}/close`,
    { method: "POST", body: JSON.stringify(input) },
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
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
          order?: (c: string, o: Record<string, boolean>) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };

  const { data: execution, error: execErr } = await sb
    .from("sop_executions")
    .select("*")
    .eq("id", executionId)
    .maybeSingle();
  if (execErr) throw new Error(String((execErr as { message?: string }).message ?? "Failed to load execution"));
  if (!execution) throw new Error("Execution not found");

  const exec = execution as SopExecution;
  const { template, steps } = await fetchTemplateWithSteps(exec.sop_template_id);

  const { data: completions, error: completionsErr } = await (sb
    .from("sop_step_completions")
    .select("*")
    .eq("sop_execution_id", executionId) as {
    order: (c: string, o: Record<string, boolean>) => Promise<{ data: SopStepCompletion[] | null; error: unknown }>;
  }).order("completed_at", { ascending: true });
  if (completionsErr) throw new Error(String((completionsErr as { message?: string }).message ?? "Failed to load completions"));

  const skippedStepIds: string[] = [];
  try {
    const { data: skipRows } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => Promise<{ data: Array<{ sop_step_id: string }> | null; error: unknown }>;
        };
      };
    })
      .from("sop_step_skips")
      .select("sop_step_id")
      .eq("sop_execution_id", executionId);
    if (Array.isArray(skipRows)) {
      for (const row of skipRows) skippedStepIds.push(row.sop_step_id);
    }
  } catch {
    // Skips are additive signal; ignore load failure and treat as none.
  }

  return {
    execution: exec,
    template,
    steps,
    completions: completions ?? [],
    skipped_step_ids: skippedStepIds,
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
  return request(`${SOP_INGEST_URL}`, {
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
  return request(`${SOP_SUGGEST_URL}/for-context`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
