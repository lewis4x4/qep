/**
 * Frontend-safe types for the normalized signal feed. Mirrors the
 * `_shared/qrm-signals.ts` server contract so the Pulse surface and tests
 * can import without pulling in supabase-js.
 */

export type QrmSignalKind =
  | "stage_change"
  | "sla_breach"
  | "sla_warning"
  | "quote_viewed"
  | "quote_expiring"
  | "deposit_received"
  | "credit_approved"
  | "credit_declined"
  | "inbound_email"
  | "inbound_call"
  | "inbound_sms"
  | "telematics_idle"
  | "telematics_fault"
  | "permit_filed"
  | "auction_listing"
  | "competitor_mention"
  | "news_mention"
  | "equipment_available"
  | "equipment_returning"
  | "service_due"
  | "warranty_expiring"
  | "other";

export type QrmSignalSeverity = "low" | "medium" | "high" | "critical";

export type QrmSignalEntityType =
  | "deal"
  | "contact"
  | "company"
  | "equipment"
  | "activity"
  | "rental"
  | "workspace";

export interface QrmSignal {
  id: string;
  workspace_id: string;
  kind: QrmSignalKind;
  severity: QrmSignalSeverity;
  source: string;
  title: string;
  description: string | null;
  entity_type: QrmSignalEntityType | null;
  entity_id: string | null;
  assigned_rep_id: string | null;
  dedupe_key: string | null;
  occurred_at: string;
  suppressed_until: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
