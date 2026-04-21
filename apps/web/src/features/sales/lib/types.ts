/** Sales Companion type definitions */

export interface DailyBriefing {
  id: string;
  briefing_date: string;
  briefing_content: BriefingContent;
  created_at: string;
}

export interface BriefingContent {
  greeting: string;
  priority_actions: PriorityAction[];
  expiring_quotes: ExpiringQuote[];
  opportunities: Opportunity[];
  prep_cards: PrepCard[];
  stats: PipelineStats;
}

export interface PriorityAction {
  type: string;
  customer_name: string | null;
  deal_id: string | null;
  summary: string;
}

export interface ExpiringQuote {
  quote_id: string;
  customer_name: string | null;
  equipment: string | null;
  status: string;
}

export interface Opportunity {
  type: string;
  summary: string;
}

export interface PrepCard {
  customer_id: string | null;
  customer_name: string | null;
  meeting_time: string | null;
  fleet_summary: string | null;
  last_interaction: string | null;
  talking_points: string[];
}

export interface PipelineStats {
  deals_in_pipeline: number;
  quotes_sent_this_week: number;
  total_pipeline_value: number;
}

export type HeatStatus = "warm" | "cooling" | "cold";

export interface RepPipelineDeal {
  deal_id: string;
  company_id: string;
  customer_name: string;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  stage: string;
  stage_sort: number;
  amount: number | null;
  deal_name: string;
  created_at: string;
  updated_at: string;
  expected_close_on: string | null;
  last_activity_at: string | null;
  next_follow_up_at: string | null;
  days_since_activity: number | null;
  heat_status: HeatStatus;
  deal_score: number | null;
}

export interface RepCustomer {
  customer_id: string;
  company_name: string;
  search_1: string | null;
  search_2: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  city: string | null;
  state: string | null;
  open_deals: number;
  active_quotes: number;
  last_interaction: string | null;
  days_since_contact: number | null;
  opportunity_score: number;
}

export interface CustomerEquipment {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
  engine_hours: number | null;
  condition: string | null;
  name: string | null;
}

export interface CustomerActivity {
  id: string;
  activity_type: string;
  body: string | null;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
}

export type VisitOutcome = "interested" | "quoted" | "follow_up" | "not_interested";
export type NextAction = "follow_up_call" | "send_quote" | "schedule_demo" | "none";

export interface OfflineAction {
  id: string;
  action_type: "log_visit" | "advance_stage" | "create_note" | "schedule_followup";
  payload: Record<string, unknown>;
  queued_at: string;
}
