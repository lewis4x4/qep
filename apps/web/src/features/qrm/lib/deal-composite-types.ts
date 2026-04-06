/** Shared shapes for get_deal_composite + QRM cards (avoids circular imports). */

export interface NeedsAssessment {
  id: string;
  application: string | null;
  work_type: string | null;
  terrain_material: string | null;
  current_equipment: string | null;
  current_equipment_issues: string | null;
  machine_interest: string | null;
  attachments_needed: string[] | null;
  brand_preference: string | null;
  timeline_description: string | null;
  timeline_urgency: string | null;
  budget_type: string | null;
  budget_amount: number | null;
  monthly_payment_target: number | null;
  financing_preference: string | null;
  has_trade_in: boolean;
  trade_in_details: string | null;
  is_decision_maker: boolean | null;
  decision_maker_name: string | null;
  next_step: string | null;
  entry_method: string;
  qrm_narrative: string | null;
  completeness_pct: number | null;
  fields_populated: number;
  fields_total: number;
}

export interface CadenceTouchpoint {
  id: string;
  touchpoint_type: string;
  scheduled_date: string;
  purpose: string;
  suggested_message: string | null;
  value_type: string | null;
  status: "pending" | "completed" | "skipped" | "overdue";
  completed_at: string | null;
  delivery_method: string | null;
}

export interface Cadence {
  id: string;
  cadence_type: "sales" | "post_sale";
  status: string;
  started_at: string;
  follow_up_touchpoints: CadenceTouchpoint[];
}

export interface QrmDealDemoSummary {
  id: string;
  status: string;
  equipment_category: string | null;
  max_hours: number;
  starting_hours: number | null;
  ending_hours: number | null;
  hours_used: number | null;
  total_demo_cost: number | null;
  scheduled_date: string | null;
  followup_due_at: string | null;
  followup_completed: boolean;
  customer_decision: string | null;
  needs_assessment_complete: boolean;
  quote_presented: boolean;
  buying_intent_confirmed: boolean;
  created_at: string;
}
