import { supabase } from "@/lib/supabase";

export type WorkforceRole = "admin" | "manager" | "owner" | "service_writer" | "technician" | string;
export type ScorecardRole = "service_advisor" | "technician";
export type AppraisalReviewType = "90-Day Review" | "Annual Performance Review" | "Merit Review";
export type AppraisalBand = "Sub-Par" | "Normal" | "Excellent";
export type CertificationStatus = "not_started" | "started" | "completed" | "expired";

export const WORKFORCE_ACCESS_ROLES = ["admin", "manager", "owner", "service_writer", "technician"] as const;
export const WORKFORCE_MANAGER_ROLES = ["admin", "manager", "owner"] as const;
export const APPRAISAL_REVIEW_TYPES: AppraisalReviewType[] = [
  "90-Day Review",
  "Annual Performance Review",
  "Merit Review",
];
export const SCORECARD_ROLES: Array<{ value: ScorecardRole; label: string }> = [
  { value: "service_advisor", label: "Service Advisor" },
  { value: "technician", label: "Technician" },
];
export const OEM_VENDORS = ["cummins", "asv", "yanmar", "sennebogen", "develon", "asc"] as const;

export interface WorkforceEmployee {
  id: string;
  profile_id: string | null;
  employee_number: string | null;
  display_name: string | null;
  class_code: string | null;
  profit_center: string | null;
  category_code: string | null;
  hire_date: string | null;
  termination_date: string | null;
  supervisor_id: string | null;
}

export interface ScorecardCategory {
  scorecard_role: ScorecardRole;
  category_key: string;
  display_order: number;
  category_name: string;
  criteria: string[];
  source_document?: string | null;
}

export interface AppraisalScore {
  category_key: string;
  display_order: number;
  category_name: string;
  criteria: string[];
  score: number | null;
  band: AppraisalBand | null;
  notes: string | null;
}

export interface PerformanceAppraisal {
  id: string;
  workspace_id: string;
  subject_employee_id: string;
  subject_profile_id: string;
  reviewer_profile_id: string;
  scorecard_role: ScorecardRole;
  review_type: AppraisalReviewType;
  review_period_start: string;
  review_period_end: string;
  status: "draft" | "finalized";
  manager_summary: string | null;
  key_strengths: string[];
  improvement_areas: string[];
  goals_next_period: string[];
  employee_comments: string | null;
  category_count: number;
  overall_score: number | null;
  performance_band: AppraisalBand | null;
  cost_of_living_raise_pct: number;
  performance_raise_pct: number | null;
  recommended_raise_pct: number | null;
  finalized_at: string | null;
  manager_signed_at: string | null;
  manager_signature_name: string | null;
  employee_acknowledged_at: string | null;
  employee_signature_name: string | null;
  subject_display_name: string | null;
  subject_email: string | null;
  reviewer_name: string | null;
  reviewer_email: string | null;
  scores: AppraisalScore[];
  updated_at: string | null;
}

export interface AppraisalDraftInput {
  subject_employee_id: string;
  review_type: AppraisalReviewType;
  review_period_start: string;
  review_period_end: string;
  scorecard_role: ScorecardRole;
  cost_of_living_raise_pct: number;
  manager_summary?: string | null;
}

export interface AppraisalScoreInput {
  appraisal_id: string;
  scores: Array<{ category_key: string; score: number; notes?: string | null }>;
  manager_summary?: string | null;
  cost_of_living_raise_pct?: number | null;
  key_strengths?: string[] | null;
  improvement_areas?: string[] | null;
  goals_next_period?: string[] | null;
}

export interface MissingRequirement {
  key: string;
  required?: number | string | null;
  required_max?: number | null;
  actual?: number | null;
  vendor?: string;
  certification?: string;
  min_status?: CertificationStatus | "started" | "completed" | string;
  in_person_required?: boolean;
  missing?: string[];
  missing_vendors?: string[];
  configured_current_tier_key?: string;
  pay_ladder_role?: string;
}

export interface RequiredOemCertification {
  vendor: string;
  min_status?: CertificationStatus | "started" | "completed" | string;
  in_person_required?: boolean;
  name?: string;
}

export interface TechnicianProgression {
  workspace_id: string;
  technician_profile_id: string;
  technician_user_id: string;
  technician_name: string;
  pay_ladder_role: "road" | "shop" | "grapple" | string;
  current_tier_key: string | null;
  current_tier_name: string | null;
  current_tier_order: number | null;
  next_tier_key: string | null;
  next_tier_name: string | null;
  next_tier_order: number | null;
  hourly_wage_cents: number | null;
  next_compensation_min_cents: number | null;
  next_compensation_max_cents: number | null;
  tenure_start_date: string | null;
  tenure_months: number | null;
  tool_count: number | null;
  tooling_verified_at: string | null;
  efficiency_pct_180d: number | null;
  standard_hours_180d: number | null;
  actual_hours_180d: number | null;
  efficiency_job_count_180d: number | null;
  h8_qep_fault_comebacks_90d: number | null;
  comeback_gate_count: number | null;
  required_efficiency_pct: number | null;
  efficiency_window_days: number | null;
  required_max_qep_fault_comebacks: number | null;
  comeback_window_days: number | null;
  required_tenure_months: number | null;
  required_oem_certifications: RequiredOemCertification[];
  required_in_house_cert_keys: string[];
  requires_vendor_logins: boolean;
  vendor_login_required_vendors: string[];
  tool_requirement_key: string | null;
  min_tool_count: number | null;
  missing_requirements: MissingRequirement[];
  eligible_for_next_tier: boolean;
  top_tier_reached: boolean;
  snapshot_at: string | null;
}

export interface TechnicianOemCertification {
  id: string;
  technician_profile_id: string;
  vendor: string;
  certification_key: string | null;
  certification_name: string;
  status: CertificationStatus;
  is_in_person: boolean;
  issued_at: string | null;
  expires_at: string | null;
  credential_url: string | null;
  notes: string | null;
}

export interface TechnicianInHouseCertification {
  id: string;
  technician_profile_id: string;
  certification_key: string;
  certification_name: string;
  status: CertificationStatus;
  issued_at: string | null;
  expires_at: string | null;
  instructor_profile_id: string | null;
  notes: string | null;
}

export interface TechnicianVendorLogin {
  id: string;
  technician_profile_id: string;
  vendor: string;
  login_identifier: string | null;
  status: "active" | "pending" | "disabled" | "unknown";
  verified_at: string | null;
  notes: string | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStringArray(value: unknown): string[] {
  return asArray<unknown>(value).map((item) => String(item)).filter(Boolean);
}

function normalizeScore(raw: Record<string, unknown>): AppraisalScore {
  return {
    category_key: String(raw.category_key ?? ""),
    display_order: Number(raw.display_order ?? 0),
    category_name: String(raw.category_name ?? "Scorecard category"),
    criteria: normalizeStringArray(raw.criteria),
    score: asNumber(raw.score),
    band: (raw.band as AppraisalBand | null) ?? null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}

export function scoreToBand(score: number | null | undefined): AppraisalBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score < 4) return "Sub-Par";
  if (score < 8) return "Normal";
  return "Excellent";
}

export function calculateAppraisalRollup(scores: Array<number | null | undefined>, costOfLivingPct: number) {
  const validScores = scores.filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (validScores.length !== 7) {
    return { overallScore: null, band: null, performanceRaisePct: null, recommendedRaisePct: null };
  }
  const overallScore = Math.round((validScores.reduce((sum, score) => sum + score, 0) / 7) * 100) / 100;
  const performanceRaisePct = overallScore;
  const recommendedRaisePct = Math.round((Math.max(0, costOfLivingPct || 0) + performanceRaisePct) * 100) / 100;
  return { overallScore, band: scoreToBand(overallScore), performanceRaisePct, recommendedRaisePct };
}

export function parseListText(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return "Unassigned";
  return role.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatMoneyFromCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function canAccessWorkforce(role: string | null | undefined): boolean {
  return WORKFORCE_ACCESS_ROLES.includes(role as (typeof WORKFORCE_ACCESS_ROLES)[number]);
}

export function canManageWorkforce(role: string | null | undefined): boolean {
  return WORKFORCE_MANAGER_ROLES.includes(role as (typeof WORKFORCE_MANAGER_ROLES)[number]);
}

export function filterManageableEmployees(
  employees: WorkforceEmployee[],
  profileId: string | null | undefined,
  role: string | null | undefined,
): WorkforceEmployee[] {
  if (!profileId || !canManageWorkforce(role)) return [];
  const activeEmployees = employees.filter((employee) => !employee.termination_date && employee.profile_id !== profileId);
  if (role === "admin" || role === "owner") return activeEmployees;
  const managerEmployee = employees.find((employee) => employee.profile_id === profileId && !employee.termination_date);
  if (!managerEmployee) return [];
  return activeEmployees.filter((employee) => employee.supervisor_id === managerEmployee.id);
}

export function normalizeAppraisal(raw: Record<string, unknown>): PerformanceAppraisal {
  return {
    id: String(raw.id),
    workspace_id: String(raw.workspace_id ?? "default"),
    subject_employee_id: String(raw.subject_employee_id ?? ""),
    subject_profile_id: String(raw.subject_profile_id ?? ""),
    reviewer_profile_id: String(raw.reviewer_profile_id ?? ""),
    scorecard_role: (raw.scorecard_role as ScorecardRole) ?? "technician",
    review_type: (raw.review_type as AppraisalReviewType) ?? "Annual Performance Review",
    review_period_start: String(raw.review_period_start ?? ""),
    review_period_end: String(raw.review_period_end ?? ""),
    status: raw.status === "finalized" ? "finalized" : "draft",
    manager_summary: typeof raw.manager_summary === "string" ? raw.manager_summary : null,
    key_strengths: normalizeStringArray(raw.key_strengths),
    improvement_areas: normalizeStringArray(raw.improvement_areas),
    goals_next_period: normalizeStringArray(raw.goals_next_period),
    employee_comments: typeof raw.employee_comments === "string" ? raw.employee_comments : null,
    category_count: Number(raw.category_count ?? 0),
    overall_score: asNumber(raw.overall_score),
    performance_band: (raw.performance_band as AppraisalBand | null) ?? null,
    cost_of_living_raise_pct: asNumber(raw.cost_of_living_raise_pct) ?? 0,
    performance_raise_pct: asNumber(raw.performance_raise_pct),
    recommended_raise_pct: asNumber(raw.recommended_raise_pct),
    finalized_at: typeof raw.finalized_at === "string" ? raw.finalized_at : null,
    manager_signed_at: typeof raw.manager_signed_at === "string" ? raw.manager_signed_at : null,
    manager_signature_name: typeof raw.manager_signature_name === "string" ? raw.manager_signature_name : null,
    employee_acknowledged_at: typeof raw.employee_acknowledged_at === "string" ? raw.employee_acknowledged_at : null,
    employee_signature_name: typeof raw.employee_signature_name === "string" ? raw.employee_signature_name : null,
    subject_display_name: typeof raw.subject_display_name === "string" ? raw.subject_display_name : null,
    subject_email: typeof raw.subject_email === "string" ? raw.subject_email : null,
    reviewer_name: typeof raw.reviewer_name === "string" ? raw.reviewer_name : null,
    reviewer_email: typeof raw.reviewer_email === "string" ? raw.reviewer_email : null,
    scores: asArray<Record<string, unknown>>(raw.scores).map(normalizeScore).sort((a, b) => a.display_order - b.display_order),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
}

export function normalizeProgression(raw: Record<string, unknown>): TechnicianProgression {
  return {
    workspace_id: String(raw.workspace_id ?? "default"),
    technician_profile_id: String(raw.technician_profile_id ?? ""),
    technician_user_id: String(raw.technician_user_id ?? ""),
    technician_name: String(raw.technician_name ?? "Unknown technician"),
    pay_ladder_role: String(raw.pay_ladder_role ?? "shop"),
    current_tier_key: typeof raw.current_tier_key === "string" ? raw.current_tier_key : null,
    current_tier_name: typeof raw.current_tier_name === "string" ? raw.current_tier_name : null,
    current_tier_order: asNumber(raw.current_tier_order),
    next_tier_key: typeof raw.next_tier_key === "string" ? raw.next_tier_key : null,
    next_tier_name: typeof raw.next_tier_name === "string" ? raw.next_tier_name : null,
    next_tier_order: asNumber(raw.next_tier_order),
    hourly_wage_cents: asNumber(raw.hourly_wage_cents),
    next_compensation_min_cents: asNumber(raw.next_compensation_min_cents),
    next_compensation_max_cents: asNumber(raw.next_compensation_max_cents),
    tenure_start_date: typeof raw.tenure_start_date === "string" ? raw.tenure_start_date : null,
    tenure_months: asNumber(raw.tenure_months),
    tool_count: asNumber(raw.tool_count),
    tooling_verified_at: typeof raw.tooling_verified_at === "string" ? raw.tooling_verified_at : null,
    efficiency_pct_180d: asNumber(raw.efficiency_pct_180d),
    standard_hours_180d: asNumber(raw.standard_hours_180d),
    actual_hours_180d: asNumber(raw.actual_hours_180d),
    efficiency_job_count_180d: asNumber(raw.efficiency_job_count_180d),
    h8_qep_fault_comebacks_90d: asNumber(raw.h8_qep_fault_comebacks_90d),
    comeback_gate_count: asNumber(raw.comeback_gate_count),
    required_efficiency_pct: asNumber(raw.required_efficiency_pct),
    efficiency_window_days: asNumber(raw.efficiency_window_days),
    required_max_qep_fault_comebacks: asNumber(raw.required_max_qep_fault_comebacks),
    comeback_window_days: asNumber(raw.comeback_window_days),
    required_tenure_months: asNumber(raw.required_tenure_months),
    required_oem_certifications: asArray<RequiredOemCertification>(raw.required_oem_certifications),
    required_in_house_cert_keys: normalizeStringArray(raw.required_in_house_cert_keys),
    requires_vendor_logins: Boolean(raw.requires_vendor_logins),
    vendor_login_required_vendors: normalizeStringArray(raw.vendor_login_required_vendors),
    tool_requirement_key: typeof raw.tool_requirement_key === "string" ? raw.tool_requirement_key : null,
    min_tool_count: asNumber(raw.min_tool_count),
    missing_requirements: asArray<MissingRequirement>(raw.missing_requirements),
    eligible_for_next_tier: Boolean(raw.eligible_for_next_tier),
    top_tier_reached: Boolean(raw.top_tier_reached),
    snapshot_at: typeof raw.snapshot_at === "string" ? raw.snapshot_at : null,
  };
}

export async function fetchWorkforceEmployees(): Promise<WorkforceEmployee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, profile_id, employee_number, display_name, class_code, profit_center, category_code, hire_date, termination_date, supervisor_id")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: String(row.id),
    profile_id: typeof row.profile_id === "string" ? row.profile_id : null,
    employee_number: typeof row.employee_number === "string" ? row.employee_number : null,
    display_name: typeof row.display_name === "string" ? row.display_name : null,
    class_code: typeof row.class_code === "string" ? row.class_code : null,
    profit_center: typeof row.profit_center === "string" ? row.profit_center : null,
    category_code: typeof row.category_code === "string" ? row.category_code : null,
    hire_date: typeof row.hire_date === "string" ? row.hire_date : null,
    termination_date: typeof row.termination_date === "string" ? row.termination_date : null,
    supervisor_id: typeof row.supervisor_id === "string" ? row.supervisor_id : null,
  }));
}

async function invokePerformanceAppraisals<T>(name: string, options?: { method?: "GET" | "POST" | "PATCH"; body?: Record<string, unknown> }): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    method: options?.method ?? "POST",
    body: options?.body,
  });
  if (error) throw error;
  if (!data) throw new Error("No response from performance appraisals API.");
  return data;
}

export async function fetchScorecards(): Promise<ScorecardCategory[]> {
  const data = await invokePerformanceAppraisals<{ scorecards?: unknown[] }>("performance-appraisals/scorecards", { method: "GET" });
  return asArray<Record<string, unknown>>(data.scorecards).map((row) => ({
    scorecard_role: (row.scorecard_role as ScorecardRole) ?? "technician",
    category_key: String(row.category_key ?? ""),
    display_order: Number(row.display_order ?? 0),
    category_name: String(row.category_name ?? "Scorecard category"),
    criteria: normalizeStringArray(row.criteria),
    source_document: typeof row.source_document === "string" ? row.source_document : null,
  }));
}

export async function fetchAppraisals(): Promise<PerformanceAppraisal[]> {
  const data = await invokePerformanceAppraisals<{ appraisals?: unknown[] }>("performance-appraisals", { method: "GET" });
  return asArray<Record<string, unknown>>(data.appraisals).map(normalizeAppraisal);
}

export async function fetchAppraisal(appraisalId: string): Promise<PerformanceAppraisal> {
  const data = await invokePerformanceAppraisals<{ appraisal?: Record<string, unknown> }>(`performance-appraisals/${appraisalId}`, { method: "GET" });
  if (!data.appraisal) throw new Error("Appraisal not found.");
  return normalizeAppraisal(data.appraisal);
}

export async function createAppraisal(input: AppraisalDraftInput): Promise<string> {
  const data = await invokePerformanceAppraisals<{ appraisal_id?: string }>("performance-appraisals", {
    body: { action: "create", ...input },
  });
  if (!data.appraisal_id) throw new Error("Appraisal API did not return an appraisal id.");
  return data.appraisal_id;
}

export async function scoreAppraisal(input: AppraisalScoreInput): Promise<void> {
  await invokePerformanceAppraisals<{ ok?: boolean }>("performance-appraisals", {
    body: { action: "score", ...input },
  });
}

export async function finalizeAppraisal(input: { appraisal_id: string; manager_summary?: string | null; manager_signature_name?: string | null }): Promise<void> {
  await invokePerformanceAppraisals<{ ok?: boolean }>("performance-appraisals", {
    body: { action: "finalize", ...input },
  });
}

export async function acknowledgeAppraisal(input: { appraisal_id: string; employee_signature_name?: string | null; employee_comments?: string | null }): Promise<void> {
  await invokePerformanceAppraisals<{ ok?: boolean }>("performance-appraisals", {
    body: { action: "acknowledge", ...input },
  });
}

export async function fetchTechnicianProgression(): Promise<TechnicianProgression[]> {
  const { data, error } = await supabase
    .from("v_technician_pay_ladder_progression")
    .select("*")
    .order("technician_name", { ascending: true });
  if (error) throw error;
  return asArray<Record<string, unknown>>(data).map(normalizeProgression);
}

export async function fetchTechnicianOemCertifications(): Promise<TechnicianOemCertification[]> {
  const { data, error } = await supabase
    .from("technician_oem_certifications")
    .select("id, technician_profile_id, vendor, certification_key, certification_name, status, is_in_person, issued_at, expires_at, credential_url, notes")
    .order("vendor", { ascending: true });
  if (error) throw error;
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: String(row.id),
    technician_profile_id: String(row.technician_profile_id ?? ""),
    vendor: String(row.vendor ?? ""),
    certification_key: typeof row.certification_key === "string" ? row.certification_key : null,
    certification_name: String(row.certification_name ?? "Certification"),
    status: (row.status as CertificationStatus) ?? "not_started",
    is_in_person: Boolean(row.is_in_person),
    issued_at: typeof row.issued_at === "string" ? row.issued_at : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    credential_url: typeof row.credential_url === "string" ? row.credential_url : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  }));
}

export async function fetchTechnicianInHouseCertifications(): Promise<TechnicianInHouseCertification[]> {
  const { data, error } = await supabase
    .from("technician_in_house_certifications")
    .select("id, technician_profile_id, certification_key, certification_name, status, issued_at, expires_at, instructor_profile_id, notes")
    .order("certification_name", { ascending: true });
  if (error) throw error;
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: String(row.id),
    technician_profile_id: String(row.technician_profile_id ?? ""),
    certification_key: String(row.certification_key ?? ""),
    certification_name: String(row.certification_name ?? "Certification"),
    status: (row.status as CertificationStatus) ?? "not_started",
    issued_at: typeof row.issued_at === "string" ? row.issued_at : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    instructor_profile_id: typeof row.instructor_profile_id === "string" ? row.instructor_profile_id : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  }));
}

export async function fetchTechnicianVendorLogins(): Promise<TechnicianVendorLogin[]> {
  const { data, error } = await supabase
    .from("technician_vendor_logins")
    .select("id, technician_profile_id, vendor, login_identifier, status, verified_at, notes")
    .order("vendor", { ascending: true });
  if (error) throw error;
  return asArray<Record<string, unknown>>(data).map((row) => ({
    id: String(row.id),
    technician_profile_id: String(row.technician_profile_id ?? ""),
    vendor: String(row.vendor ?? ""),
    login_identifier: typeof row.login_identifier === "string" ? row.login_identifier : null,
    status: (row.status as TechnicianVendorLogin["status"]) ?? "unknown",
    verified_at: typeof row.verified_at === "string" ? row.verified_at : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  }));
}
