export const SERVICE_STAGES = [
  "request_received",
  "triaging",
  "diagnosis_selected",
  "quote_drafted",
  "quote_sent",
  "approved",
  "parts_pending",
  "parts_staged",
  "haul_scheduled",
  "scheduled",
  "in_progress",
  "blocked_waiting",
  "quality_check",
  "ready_for_pickup",
  "invoice_ready",
  "invoiced",
  "paid_closed",
] as const;

export type ServiceStage = (typeof SERVICE_STAGES)[number];

export const STAGE_LABELS: Record<ServiceStage, string> = {
  request_received: "Request Received",
  triaging: "Triaging",
  diagnosis_selected: "Diagnosis Selected",
  quote_drafted: "Quote Drafted",
  quote_sent: "Quote Sent",
  approved: "Approved",
  parts_pending: "Parts Pending",
  parts_staged: "Parts Staged",
  haul_scheduled: "Haul Scheduled",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  blocked_waiting: "Blocked / Waiting",
  quality_check: "Quality Check",
  ready_for_pickup: "Ready for Pickup",
  invoice_ready: "Invoice Ready",
  invoiced: "Invoiced",
  paid_closed: "Paid / Closed",
};

export const STAGE_COLORS: Record<ServiceStage, string> = {
  request_received: "bg-slate-500/15 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  triaging: "bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300",
  diagnosis_selected: "bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
  quote_drafted: "bg-purple-500/15 text-purple-600 dark:bg-purple-400/15 dark:text-purple-300",
  quote_sent: "bg-violet-500/15 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  approved: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  parts_pending: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  parts_staged: "bg-lime-500/15 text-lime-600 dark:bg-lime-400/15 dark:text-lime-300",
  haul_scheduled: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300",
  scheduled: "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300",
  in_progress: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  blocked_waiting: "bg-red-500/15 text-red-600 dark:bg-red-400/15 dark:text-red-300",
  quality_check: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300",
  ready_for_pickup: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  invoice_ready: "bg-yellow-500/15 text-yellow-600 dark:bg-yellow-400/15 dark:text-yellow-300",
  invoiced: "bg-stone-500/15 text-stone-600 dark:bg-stone-400/15 dark:text-stone-300",
  paid_closed: "bg-green-500/20 text-green-600 dark:bg-green-400/20 dark:text-green-300",
};

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  request_received: ["triaging"],
  triaging: ["diagnosis_selected"],
  diagnosis_selected: ["quote_drafted"],
  quote_drafted: ["quote_sent"],
  quote_sent: ["approved", "quote_drafted"],
  approved: ["parts_pending"],
  parts_pending: ["parts_staged"],
  parts_staged: ["scheduled", "haul_scheduled"],
  haul_scheduled: ["scheduled"],
  scheduled: ["in_progress"],
  in_progress: ["blocked_waiting", "quality_check"],
  blocked_waiting: ["in_progress"],
  quality_check: ["ready_for_pickup"],
  ready_for_pickup: ["invoice_ready"],
  invoice_ready: ["invoiced"],
  invoiced: ["paid_closed"],
};

export const BLOCKED_ALLOWED_FROM = new Set([
  "parts_pending",
  "parts_staged",
  "haul_scheduled",
  "scheduled",
  "in_progress",
]);

export const PRIORITY_LABELS = {
  normal: "Normal",
  urgent: "Urgent",
  critical: "Critical",
} as const;

export const PRIORITY_COLORS = {
  normal: "bg-slate-500/15 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  urgent: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  critical: "bg-red-500/15 text-red-600 dark:bg-red-400/15 dark:text-red-300",
} as const;

export const SOURCE_TYPE_LABELS = {
  call: "Phone Call",
  walk_in: "Walk-In",
  field_tech: "Field Tech",
  sales_handoff: "Sales Handoff",
  portal: "Customer Portal",
} as const;

export const REQUEST_TYPE_LABELS = {
  repair: "Repair",
  pm_service: "PM Service",
  inspection: "Inspection",
  machine_down: "Machine Down",
  recall: "Recall",
  warranty: "Warranty",
} as const;

export const STATUS_FLAG_LABELS: Record<string, string> = {
  machine_down: "Machine Down",
  shop_job: "Shop Job",
  field_job: "Field Job",
  internal: "Internal",
  warranty_recall: "Warranty/Recall",
  customer_pay: "Customer Pay",
  good_faith: "Good Faith",
  waiting_customer: "Waiting on Customer",
  waiting_vendor: "Waiting on Vendor",
  waiting_transfer: "Waiting on Transfer",
  waiting_haul: "Waiting on Haul",
};

export const DEFAULT_TAT_TARGETS_HOURS: Record<string, number> = {
  request_received: 2,
  triaging: 4,
  diagnosis_selected: 8,
  quote_drafted: 4,
  quote_sent: 24,
  approved: 2,
  parts_pending: 48,
  parts_staged: 4,
  haul_scheduled: 24,
  scheduled: 48,
  in_progress: 72,
  blocked_waiting: 24,
  quality_check: 4,
  ready_for_pickup: 8,
  invoice_ready: 24,
  invoiced: 168,
};

export const MACHINE_DOWN_TAT_TARGETS_HOURS: Record<string, number> = {
  request_received: 0.5,
  triaging: 1,
  diagnosis_selected: 2,
  quote_drafted: 1,
  quote_sent: 4,
  approved: 0.5,
  parts_pending: 8,
  parts_staged: 1,
  haul_scheduled: 4,
  scheduled: 8,
  in_progress: 24,
  blocked_waiting: 2,
  quality_check: 1,
  ready_for_pickup: 2,
  invoice_ready: 4,
  invoiced: 48,
};
