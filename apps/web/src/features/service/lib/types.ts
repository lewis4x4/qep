import type { ServiceStage } from "./constants";

export type ServiceSourceType = "call" | "walk_in" | "field_tech" | "sales_handoff" | "portal";
export type ServiceRequestType = "repair" | "pm_service" | "inspection" | "machine_down" | "recall" | "warranty";
export type ServicePriority = "normal" | "urgent" | "critical";
export type ServiceStatusFlag =
  | "machine_down" | "shop_job" | "field_job" | "internal"
  | "warranty_recall" | "customer_pay" | "good_faith"
  | "waiting_customer" | "waiting_vendor" | "waiting_transfer" | "waiting_haul";

export interface ServiceJob {
  id: string;
  workspace_id: string;
  customer_id: string | null;
  contact_id: string | null;
  machine_id: string | null;
  source_type: ServiceSourceType;
  request_type: ServiceRequestType;
  priority: ServicePriority;
  current_stage: ServiceStage;
  status_flags: ServiceStatusFlag[];
  branch_id: string | null;
  advisor_id: string | null;
  service_manager_id: string | null;
  technician_id: string | null;
  requested_by_name: string | null;
  customer_problem_summary: string | null;
  ai_diagnosis_summary: string | null;
  selected_job_code_id: string | null;
  haul_required: boolean;
  shop_or_field: "shop" | "field";
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  quote_total: number | null;
  invoice_total: number | null;
  portal_request_id: string | null;
  /** Same parts fulfillment run as a portal/counter order when shop shares picks/shipping. */
  fulfillment_run_id: string | null;
  tracking_token: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

/** Linked portal service_requests row (customer portal intake). */
export interface PortalServiceRequestSummary {
  id: string;
  status: string;
  request_type: string;
  urgency: string;
  description: string;
  created_at: string;
  portal_customer?: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

export interface ServiceJobWithRelations extends ServiceJob {
  customer?: { id: string; name: string } | null;
  contact?: { id: string; first_name: string; last_name: string; email: string; phone: string } | null;
  machine?: { id: string; make: string; model: string; serial_number: string; year: number } | null;
  advisor?: { id: string; full_name: string; email: string } | null;
  technician?: { id: string; full_name: string; email: string } | null;
  job_code?: JobCode | null;
  events?: ServiceJobEvent[];
  blockers?: ServiceJobBlocker[];
  parts?: ServicePartsRequirement[];
  quotes?: ServiceQuoteSummary[];
  parts_count?: { count: number }[];
  parts_staged_count?: { count: number }[];
  active_blockers?: { count: number }[];
  latest_quote?: ServiceQuoteSummary[];
  fulfillment_run?: { id: string; status: string; created_at: string } | null;
  /** Populated when portal_request_id is set (see service-job-router handleGet). */
  portal_request?: PortalServiceRequestSummary | null;
}

export interface ServiceJobEvent {
  id: string;
  event_type: string;
  actor_id: string | null;
  old_stage: ServiceStage | null;
  new_stage: ServiceStage | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ServiceJobBlocker {
  id: string;
  blocker_type: string;
  description: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface JobCode {
  id: string;
  workspace_id: string;
  make: string;
  model_family: string | null;
  job_name: string;
  manufacturer_estimated_hours: number | null;
  shop_average_hours: number | null;
  senior_tech_average_hours: number | null;
  parts_template: unknown[];
  common_add_ons: unknown[];
  confidence_score: number | null;
  is_system_generated: boolean;
  source_of_truth_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServicePartsRequirement {
  id: string;
  job_id: string;
  part_number: string;
  description: string | null;
  quantity: number;
  status: string;
  need_by_date: string | null;
}

export interface ServiceQuoteSummary {
  id: string;
  version: number;
  total: number;
  status: string;
  sent_at: string | null;
}

export interface ServiceQuote {
  id: string;
  workspace_id: string;
  job_id: string;
  version: number;
  labor_total: number;
  parts_total: number;
  haul_total: number;
  shop_supplies: number;
  total: number;
  status: string;
  sent_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceQuoteLine {
  id: string;
  quote_id: string;
  line_type: "labor" | "part" | "haul" | "shop_supply" | "optional" | "discount";
  description: string;
  quantity: number;
  unit_price: number;
  extended_price: number;
  part_requirement_id: string | null;
  sort_order: number;
}

export interface VendorProfile {
  id: string;
  workspace_id: string;
  name: string;
  supplier_type: string;
  category_support: unknown[];
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  after_hours_contact: string | null;
  machine_down_escalation_path: string | null;
}

export interface TechnicianProfile {
  id: string;
  workspace_id: string;
  user_id: string;
  certifications: unknown[];
  brands_supported: unknown[];
  average_efficiency: number | null;
  active_workload: number;
  branch_id: string | null;
  field_eligible: boolean;
  shop_eligible: boolean;
}

export interface ServiceCompletionFeedback {
  id: string;
  job_id: string;
  actual_problem_fixed: boolean | null;
  additional_issues: unknown[];
  missing_parts: unknown[];
  time_saver_notes: string | null;
  serial_specific_note: string | null;
  return_visit_risk: "none" | "low" | "medium" | "high" | null;
  upsell_suggestions: unknown[];
  submitted_by: string | null;
  created_at: string;
}

export interface MachineKnowledgeNote {
  id: string;
  equipment_id: string | null;
  job_id: string | null;
  note_type: string;
  content: string;
  source_user_id: string | null;
  created_at: string;
}

export interface ServiceListResponse {
  jobs: ServiceJobWithRelations[];
  total: number;
  page: number;
  per_page: number;
}

export interface ServiceListFilters {
  stage?: string;
  stages?: string[];
  priority?: string;
  branch_id?: string;
  advisor_id?: string;
  technician_id?: string;
  status_flag?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
  page?: number;
  per_page?: number;
  include_closed?: boolean;
}
