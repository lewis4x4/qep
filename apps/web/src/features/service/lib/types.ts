import type { ServiceStage } from "./constants";

export type ServiceSourceType =
  | "call"
  | "walk_in"
  | "drop_off"
  | "field_request"
  | "internal_request"
  // Legacy/read-only values can still appear on existing jobs.
  | "field_tech"
  | "sales_handoff"
  | "portal";
export type ServiceRequestType =
  | "repair"
  | "pm_service"
  | "warranty"
  | "field_service"
  | "internal"
  | "comeback_rework"
  | "hauling_transport"
  // Legacy/read-only values can still appear on existing jobs.
  | "inspection"
  | "machine_down"
  | "recall";
export type ServicePriority = "normal" | "high" | "emergency" | "urgent" | "critical";
export type ServiceStatusFlag =
  | "machine_down" | "shop_job" | "field_job" | "internal"
  | "warranty_recall" | "customer_pay" | "good_faith"
  | "waiting_customer" | "waiting_vendor" | "waiting_transfer" | "waiting_haul";

export type EstimateAuthorizationStatus = "not_required" | "pending" | "approved" | "reauthorization_required";
export type DocumentationReviewStatus = "not_required" | "pending" | "returned" | "approved";
export type DiagnosticSignoffStatus = "not_required" | "not_submitted" | "submitted" | "returned" | "approved";
export type RepairSignoffStatus = "not_required" | "not_started" | "completed";
export type OverrunStatus = "not_evaluated" | "within_budget" | "overrun_unacknowledged" | "overrun_acknowledged";
export type H8ComebackFaultAttribution = "qep_fault" | "customer_fault" | "oem_fault" | "vendor_fault" | "parts_defect" | "other" | "unknown";
export type H8PayerType = "customer" | "warranty_claim" | "qep_internal" | "oem_policy" | "goodwill" | "other";
export type H8WarrantyClaimStatus = "draft" | "submitted" | "oem_evaluation" | "approved" | "paid" | "denied" | "cancelled";

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
  hour_meter_reading?: number | null;
  odometer_miles?: number | null;
  machine_make?: string | null;
  machine_model?: string | null;
  machine_serial_number?: string | null;
  machine_year?: number | null;
  complaint?: string | null;
  cause?: string | null;
  correction?: string | null;
  promised_at?: string | null;
  field_site_location?: string | null;
  field_site_contact_name?: string | null;
  field_site_contact_phone?: string | null;
  field_site_conditions_access_notes?: string | null;
  quote_total: number | null;
  invoice_total: number | null;
  estimate_authorization_required?: boolean;
  estimate_authorization_status?: EstimateAuthorizationStatus;
  approved_estimate_quote_id?: string | null;
  approved_estimate_approval_id?: string | null;
  approved_estimate_amount?: number | null;
  approved_estimate_authorized_at?: string | null;
  estimate_reauth_threshold_pct?: number | null;
  estimate_reauthorization_required_at?: string | null;
  estimate_reauthorization_reason?: string | null;
  h5_documentation_required?: boolean;
  documentation_review_status?: DocumentationReviewStatus;
  documentation_review_notes?: string | null;
  documentation_return_reason?: string | null;
  lockout_tagout_required?: boolean;
  lockout_tagout_completed?: boolean;
  lockout_tagout_notes?: string | null;
  original_service_job_id?: string | null;
  comeback_fault_attribution?: H8ComebackFaultAttribution | null;
  comeback_responsible_technician_id?: string | null;
  comeback_responsible_segment_id?: string | null;
  comeback_no_rebill?: boolean;
  comeback_notes?: string | null;
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

export interface ServiceSegmentPhoto {
  id: string;
  phase: "before" | "during" | "after";
  category: string;
  storage_bucket: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface ServiceJobSegment {
  id: string;
  segment_number: number;
  description: string | null;
  status: string | null;
  technician_id: string | null;
  estimated_hours: number | null;
  quoted_labor_hours: number | null;
  hours_actual: number | null;
  h5_documentation_required?: boolean;
  diagnostic_signoff_status: DiagnosticSignoffStatus;
  diagnostic_submitted_at: string | null;
  diagnostic_approved_at: string | null;
  repair_signoff_status: RepairSignoffStatus;
  repair_signed_off_at: string | null;
  labor_story: string | null;
  labor_story_complaint_verification: string | null;
  labor_story_diagnostic_steps: string | null;
  labor_story_root_cause: string | null;
  labor_story_parts_used: string | null;
  labor_story_work_performed: string | null;
  overrun_status: OverrunStatus;
  overrun_flagged_at: string | null;
  overrun_acknowledged_at: string | null;
  lockout_tagout_required: boolean;
  lockout_tagout_completed: boolean;
  warranty_parts_turn_in_required: boolean;
  warranty_parts_turn_in_completed: boolean;
  warranty_parts_label: string | null;
  photos?: ServiceSegmentPhoto[];
}

export interface ServiceJobWithRelations extends ServiceJob {
  customer?: { id: string; name: string } | null;
  contact?: { id: string; first_name: string; last_name: string; email: string; phone: string } | null;
  machine?: {
    id: string;
    make: string;
    model: string;
    serial_number: string;
    year: number;
    warranty_registered?: boolean | null;
    warranty_registration_number?: string | null;
    warranty_provider?: string | null;
    warranty_start_date?: string | null;
    warranty_end_date?: string | null;
    warranty_coverage_terms?: string | null;
    warranty_coverage_notes?: Record<string, unknown> | null;
  } | null;
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
  segments?: ServiceJobSegment[];
}

export interface H8WarrantyClaim {
  id: string;
  service_job_id: string;
  status: H8WarrantyClaimStatus;
  claim_number: string | null;
  oem_name: string | null;
  oem_reference: string | null;
  requested_amount_cents: number;
  approved_amount_cents: number | null;
  paid_amount_cents: number | null;
  denied_reason: string | null;
  submitted_at: string | null;
  oem_evaluation_started_at: string | null;
  approved_at: string | null;
  denied_at: string | null;
  paid_at: string | null;
  closed_at: string | null;
  updated_at: string;
}

export interface H8WarrantyClaimLine {
  id: string;
  warranty_claim_id: string;
  source_table: string;
  source_id: string;
  line_type: string;
  description: string | null;
  quantity: number;
  amount_cents: number;
  cost_cents: number;
  payer_type: "warranty_claim";
  included: boolean;
}

export interface H8LinePayerRow {
  id: string;
  line_type: "quote_line" | "labor_ledger" | "billing_row";
  label: string;
  amount_cents: number | null;
  payer_type: H8PayerType | null;
  warranty_claim_id: string | null;
  payer_notes: string | null;
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
  /** job_code_template / ai_suggested lines start suggested until operator accepts. */
  source?: string | null;
  intake_line_status?: "suggested" | "accepted" | "planned" | null;
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
