// ============================================================
// Parts Companion — TypeScript type definitions
// ============================================================

// ── Request Types ───────────────────────────────────────────

export type RequestSource =
  | "service"
  | "sales"
  | "customer_walkin"
  | "customer_phone"
  | "internal";

export type RequestPriority = "critical" | "urgent" | "normal" | "low";

export type RequestStatus =
  | "requested"
  | "acknowledged"
  | "locating"
  | "pulled"
  | "ready"
  | "fulfilled"
  | "cancelled"
  | "backordered";

export interface RequestItem {
  part_number: string;
  description: string | null;
  quantity: number;
  status: "pending" | "locating" | "pulled" | "backordered";
  notes: string | null;
}

export interface PartsRequest {
  id: string;
  workspace_id: string;
  requested_by: string;
  assigned_to: string | null;
  request_source: RequestSource;
  priority: RequestPriority;
  status: RequestStatus;
  customer_id: string | null;
  customer_name: string | null;
  machine_profile_id: string | null;
  machine_description: string | null;
  work_order_number: string | null;
  bay_number: string | null;
  items: RequestItem[];
  notes: string | null;
  estimated_completion: string | null;
  auto_escalated: boolean;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
  cancelled_at: string | null;
}

/** Enriched queue row from v_parts_queue view */
export interface QueueItem extends PartsRequest {
  requester_name: string | null;
  assignee_name: string | null;
  machine_manufacturer: string | null;
  machine_model: string | null;
  machine_category: string | null;
  age_minutes: number;
  priority_sort: number;
  is_overdue: boolean;
}

export type ActivityAction =
  | "status_change"
  | "note_added"
  | "item_added"
  | "item_removed"
  | "assigned"
  | "escalated"
  | "customer_notified"
  | "created";

export interface RequestActivity {
  id: string;
  request_id: string;
  user_id: string;
  action: ActivityAction;
  from_value: string | null;
  to_value: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ── Machine Profile Types ───────────────────────────────────

export interface MaintenanceInterval {
  interval_hours: number;
  tasks: string[];
  parts?: string[];
}

export interface FluidCapacity {
  capacity: string;
  spec: string;
}

export interface WearPart {
  part_number: string;
  description: string;
  avg_replace_hours?: number;
}

export interface MachineProfile {
  id: string;
  workspace_id: string;
  manufacturer: string;
  model: string;
  model_family: string | null;
  year_range_start: number | null;
  year_range_end: number | null;
  category: string;
  specs: Record<string, unknown>;
  maintenance_schedule: MaintenanceInterval[];
  fluid_capacities: Record<string, FluidCapacity>;
  common_wear_parts: Record<string, WearPart[]>;
  source_documents: string[];
  extraction_confidence: number;
  manually_verified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Parts Catalog (extended) ────────────────────────────────

export interface CrossReference {
  source: string;
  part_number: string;
  verified: boolean;
  note?: string;
}

export interface CatalogPart {
  id: string;
  part_number: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  list_price: number | null;
  cost_price: number | null;
  cross_references: CrossReference[];
  compatible_machines: string[];
  frequently_ordered_with: string[];
  superseded_by: string | null;
  supersedes: string | null;
  extraction_confidence: number;
  manually_verified: boolean;
}

// ── Search Types ────────────────────────────────────────────

export type QueryType =
  | "part_number"
  | "machine_component"
  | "natural_language"
  | "cross_reference";

export type MatchType =
  | "exact"
  | "semantic"
  | "fts"
  | "hybrid"
  | "cross_ref"
  | "machine_compat";

export interface PartSearchResult {
  part_id: string;
  part_number: string;
  description: string | null;
  manufacturer: string | null;
  category: string | null;
  confidence: number;
  match_type: MatchType;
  cross_references: CrossReference[];
  frequently_ordered_with: Array<{
    part_number: string;
    description: string;
  }>;
  compatible_machines: string[];
  intellidealer_status: "not_connected";
  notes: string | null;
  source: "catalog" | "rag" | "cross_ref";
}

export interface KbEvidence {
  source_title: string;
  excerpt: string;
  confidence: number;
  page_number?: number | null;
}

export interface SearchResponse {
  query_type: QueryType;
  machine_identified: {
    id: string;
    manufacturer: string;
    model: string;
  } | null;
  results: PartSearchResult[];
  kb_evidence: KbEvidence[];
  total_results: number;
  search_time_ms: number;
  degraded: boolean;
  degraded_reason?: string;
  match_mix?: {
    semantic: number;
    fts: number;
    hybrid: number;
    exact: number;
    cross_ref: number;
    machine_compat: number;
  };
}

// ── Counter Inquiry Types ───────────────────────────────────

export type InquiryType =
  | "lookup"
  | "stock_check"
  | "price_check"
  | "cross_reference"
  | "technical";

export type InquiryOutcome =
  | "resolved"
  | "ordered"
  | "referred"
  | "unresolved";

export interface CounterInquiry {
  id: string;
  user_id: string;
  inquiry_type: InquiryType;
  machine_profile_id: string | null;
  machine_description: string | null;
  query_text: string;
  result_parts: string[];
  outcome: InquiryOutcome;
  duration_seconds: number | null;
  created_at: string;
}

// ── Preferences ─────────────────────────────────────────────

export type QueueFilter =
  | "all"
  | "mine"
  | "unassigned"
  | "service"
  | "customer";

export interface PartsPreferences {
  id: string;
  user_id: string;
  dark_mode: boolean;
  queue_panel_collapsed: boolean;
  default_queue_filter: QueueFilter;
  show_fulfilled_requests: boolean;
  keyboard_shortcuts_enabled: boolean;
  sound_notifications: boolean;
}

// ── AI Assistant ────────────────────────────────────────────

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    title: string;
    source: string;
    page_number?: number;
    excerpt?: string;
  }>;
  pending?: boolean;
  created_at: number;
}

// ── Arrivals ────────────────────────────────────────────────

export interface PartsArrival {
  id: string;
  description: string;
  customer_name: string | null;
  ordered_date: string | null;
  bin_location: string | null;
  type: "special_order" | "backorder" | "restock";
  request_id: string | null;
}
