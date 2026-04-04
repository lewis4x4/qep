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

type NewTables = {
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
  deal_scenarios: TableDef<DealScenariosRow>;
  margin_waterfalls: TableDef<MarginWaterfallsRow>;
  social_accounts: TableDef<SocialAccountsRow>;
};

// ── Merged Database type ──────────────────────────────────────────────────

export type ExtendedDatabase = {
  [K in keyof BaseDatabase]: K extends "public"
    ? {
        Tables: BaseDatabase["public"]["Tables"] & NewTables;
        Views: BaseDatabase["public"]["Views"];
        Functions: BaseDatabase["public"]["Functions"];
        Enums: BaseDatabase["public"]["Enums"];
        CompositeTypes: BaseDatabase["public"]["CompositeTypes"];
      }
    : BaseDatabase[K];
};
