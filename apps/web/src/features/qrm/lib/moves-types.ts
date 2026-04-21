/**
 * Pure type declarations for QRM moves. Kept import-free so tests can reach
 * them without dragging in the supabase client.
 */

export type QrmMoveStatus =
  | "suggested"
  | "accepted"
  | "completed"
  | "snoozed"
  | "dismissed"
  | "expired";

export type QrmMoveKind =
  | "call_now"
  | "send_quote"
  | "send_follow_up"
  | "schedule_meeting"
  | "escalate"
  | "drop_deal"
  | "reassign"
  | "field_visit"
  | "send_proposal"
  | "pricing_review"
  | "inventory_reserve"
  | "service_escalate"
  | "rescue_offer"
  | "other";

export type QrmMoveEntityType =
  | "deal"
  | "contact"
  | "company"
  | "equipment"
  | "activity"
  | "rental"
  | "workspace";

export interface QrmMove {
  id: string;
  workspace_id: string;
  kind: QrmMoveKind;
  status: QrmMoveStatus;
  title: string;
  rationale: string | null;
  confidence: number | null;
  priority: number;
  entity_type: QrmMoveEntityType | null;
  entity_id: string | null;
  assigned_rep_id: string | null;
  draft: Record<string, unknown> | null;
  signal_ids: string[];
  due_at: string | null;
  snoozed_until: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  recommender: string | null;
  recommender_version: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type QrmMoveAction =
  | "accept"
  | "snooze"
  | "dismiss"
  | "complete"
  | "reopen";
