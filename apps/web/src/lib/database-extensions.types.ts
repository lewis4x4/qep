/**
 * Type augmentations for tables added in migrations 068-091.
 *
 * These fill the gap until `supabase gen types` is re-run against the
 * production schema. Once regenerated, this file can be deleted and
 * all `as any` casts removed.
 *
 * IMPORTANT: Run `supabase gen types typescript --project-id iciddijgonywtxoelous --schema public`
 * to regenerate database.types.ts, then delete this file.
 */

import type { Database as BaseDatabase, Json } from "./database.types";

// ── New table types (migrations 068-091) ──────────────────────────────────

interface NeedsAssessmentsRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  contact_id: string | null;
  application: string | null;
  current_equipment: string | null;
  pain_points: string[] | null;
  must_haves: string[] | null;
  nice_to_haves: string[] | null;
  budget_range: string | null;
  financing_preference: string | null;
  timeline: string | null;
  decision_makers: string | null;
  competitive_mentions: string[] | null;
  site_conditions: Json | null;
  verified_by: string | null;
  verified_at: string | null;
  completeness_score: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface FollowUpCadencesRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  cadence_type: string;
  status: string;
  started_at: string;
  next_touchpoint_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface FollowUpTouchpointsRow {
  id: string;
  cadence_id: string;
  step_number: number;
  channel: string;
  scheduled_date: string;
  completed_at: string | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DepositsRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  amount: number;
  method: string | null;
  status: string;
  received_at: string | null;
  refunded_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DemosRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  equipment_id: string | null;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DemoInspectionsRow {
  id: string;
  demo_id: string;
  inspection_type: string;
  status: string;
  notes: string | null;
  photos: Json | null;
  inspected_by: string | null;
  created_at: string;
}

interface ProspectingKpisRow {
  id: string;
  workspace_id: string;
  rep_id: string;
  kpi_date: string;
  positive_visits: number;
  target: number;
  total_visits: number | null;
  talk_time_minutes: number | null;
  new_contacts: number | null;
  created_at: string;
  updated_at: string;
}

interface CatalogEntriesRow {
  id: string;
  workspace_id: string;
  source: string;
  external_id: string | null;
  make: string;
  model: string;
  year: number | null;
  category: string | null;
  stock_number: string | null;
  serial_number: string | null;
  list_price: number | null;
  dealer_cost: number | null;
  msrp: number | null;
  is_available: boolean;
  branch: string | null;
  condition: string | null;
  attachments: Json;
  photos: Json;
  brochure_url: string | null;
  video_url: string | null;
  imported_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface QuotePackagesRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  contact_id: string | null;
  equipment: Json;
  attachments_included: Json;
  trade_in_valuation_id: string | null;
  trade_allowance: number | null;
  financing_scenarios: Json;
  equipment_total: number | null;
  attachment_total: number | null;
  subtotal: number | null;
  trade_credit: number | null;
  net_total: number | null;
  margin_amount: number | null;
  margin_pct: number | null;
  pdf_url: string | null;
  pdf_generated_at: string | null;
  photos_included: Json;
  brochure_url: string | null;
  credit_app_url: string | null;
  video_url: string | null;
  status: string;
  sent_at: string | null;
  sent_via: string | null;
  expires_at: string | null;
  ai_recommendation: Json | null;
  entry_mode: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface QuoteSignaturesRow {
  id: string;
  workspace_id: string;
  quote_package_id: string;
  deal_id: string | null;
  signer_name: string;
  signer_email: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  signature_image_url: string | null;
  signed_at: string;
  document_hash: string | null;
  is_valid: boolean;
  created_at: string;
  updated_at: string;
}

interface TradeValuationsRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  equipment_description: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  hours: number | null;
  serial_number: string | null;
  condition: string | null;
  market_value: number | null;
  trade_allowance: number | null;
  source: string | null;
  notes: string | null;
  photos: Json | null;
  appraised_by: string | null;
  created_at: string;
  updated_at: string;
}

interface EquipmentIntakeRow {
  id: string;
  workspace_id: string;
  equipment_id: string | null;
  status: string;
  received_at: string | null;
  pdi_status: string | null;
  pdi_completed_at: string | null;
  pdi_notes: string | null;
  bay_assignment: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RentalReturnsRow {
  id: string;
  workspace_id: string;
  equipment_id: string | null;
  subscription_id: string | null;
  status: string;
  returned_at: string | null;
  condition_notes: string | null;
  damage_photos: Json | null;
  hours_at_return: number | null;
  payment_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TrafficTicketsRow {
  id: string;
  workspace_id: string;
  equipment_id: string | null;
  driver_id: string | null;
  ticket_type: string | null;
  status: string;
  issued_at: string | null;
  location: string | null;
  amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface GlRoutingRulesRow {
  id: string;
  workspace_id: string;
  rule_name: string;
  category: string | null;
  gl_code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PredictiveVisitListsRow {
  id: string;
  workspace_id: string;
  rep_id: string;
  visit_date: string;
  customer_id: string | null;
  company_id: string | null;
  priority_score: number | null;
  reason: string | null;
  status: string;
  visited_at: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

interface TelematicsReadingsRow {
  id: string;
  feed_id: string;
  reading_at: string;
  hours: number | null;
  lat: number | null;
  lng: number | null;
  fuel_level: number | null;
  alerts: Json | null;
  raw_payload: Json | null;
  created_at: string;
}

interface TelematisFeedsRow {
  id: string;
  workspace_id: string;
  equipment_id: string | null;
  subscription_id: string | null;
  provider: string;
  device_id: string;
  device_serial: string | null;
  is_active: boolean;
  last_reading_at: string | null;
  last_hours: number | null;
  last_lat: number | null;
  last_lng: number | null;
  sync_interval_minutes: number | null;
  alert_on_excessive_idle: boolean | null;
  created_at: string;
  updated_at: string;
}

interface DealScenariosRow {
  id: string;
  workspace_id: string;
  deal_id: string;
  type: string;
  label: string | null;
  equipment_price: number | null;
  trade_allowance: number | null;
  margin_pct: number | null;
  close_probability: number | null;
  expected_value: number | null;
  reasoning: string | null;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

interface MarginWaterfallsRow {
  id: string;
  scenario_id: string;
  line_item: string;
  amount: number;
  percentage: number | null;
  sort_order: number;
  created_at: string;
}

interface SocialAccountsRow {
  id: string;
  workspace_id: string;
  platform: string;
  account_name: string;
  access_token_encrypted: string | null;
  page_id: string | null;
  is_active: boolean;
  last_posted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** service_jobs (094 + 099 migrations) */
interface ServiceJobsRow {
  id: string;
  workspace_id: string;
  customer_id: string | null;
  contact_id: string | null;
  machine_id: string | null;
  source_type: string;
  request_type: string;
  priority: string;
  current_stage: string;
  current_stage_entered_at: string;
  status_flags: string[];
  branch_id: string | null;
  advisor_id: string | null;
  service_manager_id: string | null;
  technician_id: string | null;
  requested_by_name: string | null;
  customer_problem_summary: string | null;
  ai_diagnosis_summary: string | null;
  selected_job_code_id: string | null;
  haul_required: boolean;
  shop_or_field: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  quote_total: number | null;
  invoice_total: number | null;
  traffic_ticket_id: string | null;
  portal_request_id: string | null;
  tracking_token: string;
  tracking_token_sha256: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

interface ServicePartsRequirementsRow {
  id: string;
  workspace_id: string;
  job_id: string;
  part_number: string;
  description: string | null;
  quantity: number;
  unit_cost: number | null;
  source: string;
  status: string;
  need_by_date: string | null;
  confidence: string;
  vendor_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ServicePartsActionsRow {
  id: string;
  workspace_id: string;
  requirement_id: string;
  job_id: string;
  action_type: string;
  actor_id: string | null;
  from_branch: string | null;
  to_branch: string | null;
  vendor_id: string | null;
  po_reference: string | null;
  expected_date: string | null;
  completed_at: string | null;
  superseded_at: string | null;
  plan_batch_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

interface ServicePartsStagingRow {
  id: string;
  workspace_id: string;
  requirement_id: string;
  job_id: string;
  bin_location: string | null;
  staged_by: string | null;
  staged_at: string;
  created_at: string;
}

interface ServiceBranchConfigRow {
  id: string;
  workspace_id: string;
  branch_id: string;
  default_advisor_pool: Json;
  default_technician_pool: Json;
  parts_team_notify_user_ids: Json;
  planner_rules: Json;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ServiceTatTargetsRow {
  id: string;
  workspace_id: string;
  current_stage: string;
  target_hours: number;
  machine_down_target_hours: number;
  created_at: string;
  updated_at: string;
}

interface PartsInventoryRow {
  id: string;
  workspace_id: string;
  branch_id: string;
  part_number: string;
  qty_on_hand: number;
  bin_location: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface JobCodeTemplateSuggestionsRow {
  id: string;
  workspace_id: string;
  job_code_id: string;
  suggested_parts_template: Json;
  suggested_common_add_ons: Json;
  observation_count: number;
  review_status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

interface ServiceCronRunsRow {
  id: string;
  workspace_id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  error: string | null;
  metadata: Json;
  created_at: string;
}

interface ServiceTatMetricsRow {
  id: string;
  workspace_id: string;
  job_id: string;
  segment_name: string;
  started_at: string;
  completed_at: string | null;
  target_duration_hours: number | null;
  actual_duration_hours: number | null;
  is_machine_down: boolean;
  created_at: string;
  updated_at: string;
}

interface VendorProfilesRow {
  id: string;
  workspace_id: string;
  name: string;
  supplier_type: string;
  category_support: Json;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  after_hours_contact: string | null;
  machine_down_escalation_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Helper to build Insert/Update from Row ────────────────────────────────

type MakeInsert<T> = { [K in keyof T]?: T[K] };
type MakeUpdate<T> = { [K in keyof T]?: T[K] };

interface TableDef<R> {
  Row: R;
  Insert: MakeInsert<R>;
  Update: MakeUpdate<R>;
  Relationships: [];
}

// ── Extended Tables type ──────────────────────────────────────────────────

/** Chat / RAG persistence (not always present in generated database.types snapshot). */
interface ChatConversationsRow {
  id: string;
  title: string | null;
  context: Json | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessagesRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  sources: Json | null;
  trace_id: string | null;
  retrieval_meta: Json | null;
  feedback: string | null;
  created_at: string;
}

type NewTables = {
  chat_conversations: TableDef<ChatConversationsRow>;
  chat_messages: TableDef<ChatMessagesRow>;
  service_jobs: TableDef<ServiceJobsRow>;
  service_parts_requirements: TableDef<ServicePartsRequirementsRow>;
  service_parts_actions: TableDef<ServicePartsActionsRow>;
  service_parts_staging: TableDef<ServicePartsStagingRow>;
  service_branch_config: TableDef<ServiceBranchConfigRow>;
  service_tat_metrics: TableDef<ServiceTatMetricsRow>;
  service_tat_targets: TableDef<ServiceTatTargetsRow>;
  parts_inventory: TableDef<PartsInventoryRow>;
  job_code_template_suggestions: TableDef<JobCodeTemplateSuggestionsRow>;
  service_cron_runs: TableDef<ServiceCronRunsRow>;
  vendor_profiles: TableDef<VendorProfilesRow>;
  needs_assessments: TableDef<NeedsAssessmentsRow>;
  follow_up_cadences: TableDef<FollowUpCadencesRow>;
  follow_up_touchpoints: TableDef<FollowUpTouchpointsRow>;
  deposits: TableDef<DepositsRow>;
  demos: TableDef<DemosRow>;
  demo_inspections: TableDef<DemoInspectionsRow>;
  prospecting_kpis: TableDef<ProspectingKpisRow>;
  catalog_entries: TableDef<CatalogEntriesRow>;
  quote_packages: TableDef<QuotePackagesRow>;
  quote_signatures: TableDef<QuoteSignaturesRow>;
  trade_valuations: TableDef<TradeValuationsRow>;
  equipment_intake: TableDef<EquipmentIntakeRow>;
  rental_returns: TableDef<RentalReturnsRow>;
  traffic_tickets: TableDef<TrafficTicketsRow>;
  gl_routing_rules: TableDef<GlRoutingRulesRow>;
  predictive_visit_lists: TableDef<PredictiveVisitListsRow>;
  telematics_readings: TableDef<TelematicsReadingsRow>;
  telematics_feeds: TableDef<TelematisFeedsRow>;
  // deal_scenarios + margin_waterfalls: use generated definitions in database.types.ts only —
  // re-declaring here intersects with Base and collapses supabase insert types to `never`.
  social_accounts: TableDef<SocialAccountsRow>;
};

// ── Merged Database type ──────────────────────────────────────────────────
// Explicit `public` shape keeps `createClient<ExtendedDatabase>()` compatible with
// `DatabaseWithoutInternals` / `DefaultSchema` inference (Omit<Base, "public"> & … can break it).

/** Overlap with `NewTables` must not use `&` (intersection collapses Row/Insert to `never`). */
type MergedPublicTables = Omit<BaseDatabase["public"]["Tables"], keyof NewTables> & NewTables;

export type ExtendedDatabase = {
  __InternalSupabase: BaseDatabase["__InternalSupabase"];
  public: {
    Tables: MergedPublicTables;
    Views: BaseDatabase["public"]["Views"];
    Functions: BaseDatabase["public"]["Functions"];
    Enums: BaseDatabase["public"]["Enums"];
    CompositeTypes: BaseDatabase["public"]["CompositeTypes"];
  };
};
