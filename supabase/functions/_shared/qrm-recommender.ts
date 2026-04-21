/**
 * Deterministic rule-based recommender.
 *
 * Translates a list of recent signals into a list of candidate moves. The
 * rules are explicit and table-driven so a human can read exactly why a move
 * was proposed — this is the v1 baseline we'll grade future ML recommenders
 * against.
 *
 * Contract:
 *   recommendMovesFromSignals(signals, opts?) → MoveCreatePayload[]
 *
 * The caller (edge function) is responsible for:
 *   1. Selecting which signals to feed in (typically: recently-created and
 *      not yet acted on).
 *   2. De-duplicating against existing open moves before inserting.
 *
 * This module is deliberately DB-free so it's trivially unit-testable in
 * Deno with no Supabase fixture.
 */

import type {
  MoveCreatePayload,
  MoveEntityType,
  MoveKind,
} from "./qrm-moves.ts";

export type SignalKind =
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

export type SignalSeverity = "low" | "medium" | "high" | "critical";

/**
 * Minimal shape the recommender needs. The real `signals` row is larger; we
 * only take what we read so the test fixtures stay focused.
 */
export interface RecommenderSignal {
  id: string;
  workspace_id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  source: string;
  title: string;
  description: string | null;
  entity_type: MoveEntityType | null;
  entity_id: string | null;
  assigned_rep_id: string | null;
  occurred_at: string;
  suppressed_until: string | null;
  payload: Record<string, unknown>;
}

export interface RecommenderRule {
  /** Human-readable id so logs/tests can point at which rule fired. */
  id: string;
  /** The signal kind this rule handles. One kind can have multiple rules. */
  when: SignalKind;
  /** Optional severity filter (e.g. only fire on critical). */
  severityAtLeast?: SignalSeverity;
  /** The move kind produced. */
  move: MoveKind;
  /** Baseline priority [0,100]. May be boosted by severity. */
  basePriority: number;
  /** Title template; receives signal.title via {title}. */
  titleTemplate: (signal: RecommenderSignal) => string;
  /** Rationale template; the sentence shown under the move card. */
  rationale: (signal: RecommenderSignal) => string;
}

const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const CONFIDENCE_BY_SEVERITY: Record<SignalSeverity, number> = {
  low: 0.5,
  medium: 0.7,
  high: 0.85,
  critical: 0.95,
};

const PRIORITY_BOOST_BY_SEVERITY: Record<SignalSeverity, number> = {
  low: -10,
  medium: 0,
  high: +5,
  critical: +10,
};

/**
 * The core ruleset. Each entry is one deterministic path from a signal to a
 * move. Rules are ordered by intent — the first matching rule wins for a
 * given (kind, severity) pair.
 */
export const DEFAULT_RULES: RecommenderRule[] = [
  // ── CRM-origin signals ──────────────────────────────────────────────────
  {
    id: "sla_breach_call_now",
    when: "sla_breach",
    move: "call_now",
    basePriority: 90,
    titleTemplate: () => "Call now — SLA breached",
    rationale: (s) =>
      s.description ?? "SLA was breached on this deal. A call today protects the pipeline.",
  },
  {
    id: "sla_warning_follow_up",
    when: "sla_warning",
    move: "send_follow_up",
    basePriority: 70,
    titleTemplate: () => "Follow up — SLA warning",
    rationale: (s) => s.description ?? "SLA clock is close to breach. Nudge the customer.",
  },
  {
    id: "stage_change_stalled_escalate",
    when: "stage_change",
    severityAtLeast: "high",
    move: "escalate",
    basePriority: 75,
    titleTemplate: () => "Escalate — deal stage moved off track",
    rationale: (s) =>
      s.description ?? "A deal moved into a risk stage. Loop in a manager before it slips further.",
  },
  {
    id: "quote_viewed_call_now",
    when: "quote_viewed",
    move: "call_now",
    basePriority: 88,
    titleTemplate: () => "Call now — quote just viewed",
    rationale: () =>
      "Customer just opened the quote. They're warm — now is the moment to close on terms.",
  },
  {
    id: "quote_expiring_follow_up",
    when: "quote_expiring",
    move: "send_follow_up",
    basePriority: 72,
    titleTemplate: () => "Follow up — quote expiring",
    rationale: () => "Quote expires soon. Nudge the customer or re-issue with refreshed pricing.",
  },
  {
    id: "deposit_received_schedule",
    when: "deposit_received",
    move: "schedule_meeting",
    basePriority: 82,
    titleTemplate: () => "Schedule delivery meeting",
    rationale: () => "Deposit is in. Line up logistics and close the loop.",
  },
  {
    id: "credit_approved_send_quote",
    when: "credit_approved",
    move: "send_quote",
    basePriority: 85,
    titleTemplate: () => "Send quote — credit approved",
    rationale: () => "Credit cleared. Send the final quote while momentum is high.",
  },
  {
    id: "credit_declined_rescue",
    when: "credit_declined",
    move: "rescue_offer",
    basePriority: 78,
    titleTemplate: () => "Rescue — credit declined",
    rationale: () =>
      "Credit was declined. Offer a rental-to-own path or co-signer route before the lead dies.",
  },

  // ── Inbound signals — customer is talking to us right now ───────────────
  {
    id: "inbound_email_call_now",
    when: "inbound_email",
    move: "call_now",
    basePriority: 92,
    titleTemplate: (s) => s.title,
    rationale: (s) =>
      s.description ?? "A lead just emailed in. Voice beats inbox — call before they shop around.",
  },
  {
    id: "inbound_call_send_follow_up",
    when: "inbound_call",
    move: "send_follow_up",
    basePriority: 85,
    titleTemplate: (s) => s.title,
    rationale: (s) => s.description ?? "Follow up on the call with an email confirming next steps.",
  },
  {
    id: "inbound_sms_call_now",
    when: "inbound_sms",
    move: "call_now",
    basePriority: 90,
    titleTemplate: (s) => s.title,
    rationale: (s) => s.description ?? "A lead just texted in. Answer voice-to-voice within the hour.",
  },

  // ── Telematics / field signals ──────────────────────────────────────────
  {
    id: "telematics_idle_followup",
    when: "telematics_idle",
    move: "send_follow_up",
    basePriority: 58,
    titleTemplate: (s) => s.title,
    rationale: () =>
      "Machine has been idle. Check if the customer still needs it or if we can rotate it back to fleet.",
  },
  {
    id: "telematics_fault_service_escalate",
    when: "telematics_fault",
    move: "service_escalate",
    basePriority: 85,
    titleTemplate: (s) => s.title,
    rationale: () => "Fault code on an in-service machine. Get service onsite before the customer calls us.",
  },

  // ── External market signals ─────────────────────────────────────────────
  {
    id: "permit_filed_call_now",
    when: "permit_filed",
    move: "call_now",
    basePriority: 78,
    titleTemplate: (s) => s.title,
    rationale: () => "Permit was filed — the jobsite is committing to iron. Be first with a quote.",
  },
  {
    id: "auction_listing_follow_up",
    when: "auction_listing",
    move: "send_follow_up",
    basePriority: 62,
    titleTemplate: (s) => s.title,
    rationale: () => "Auction listing hints inventory turnover. Pitch the replacement now.",
  },
  {
    id: "competitor_mention_rescue",
    when: "competitor_mention",
    move: "rescue_offer",
    basePriority: 82,
    titleTemplate: (s) => s.title,
    rationale: () => "Customer mentioned a competitor. Bring a counter-offer before they commit.",
  },
  {
    id: "news_mention_follow_up",
    when: "news_mention",
    move: "send_follow_up",
    basePriority: 52,
    titleTemplate: (s) => s.title,
    rationale: () =>
      "Your customer showed up in the news — congratulate them, then slide into the adjacent need.",
  },

  // ── Fleet / service signals ─────────────────────────────────────────────
  {
    id: "equipment_available_send_quote",
    when: "equipment_available",
    move: "send_quote",
    basePriority: 68,
    titleTemplate: (s) => s.title,
    rationale: () =>
      "A machine just came back to the lot. If a recent lead asked for this spec, quote it while it's hot.",
  },
  {
    id: "equipment_returning_follow_up",
    when: "equipment_returning",
    move: "send_follow_up",
    basePriority: 58,
    titleTemplate: (s) => s.title,
    rationale: () => "Rental is returning soon. Offer extension, buy-out, or a fresh rental.",
  },
  {
    id: "service_due_call_now",
    when: "service_due",
    move: "call_now",
    basePriority: 68,
    titleTemplate: (s) => s.title,
    rationale: () => "Scheduled service is due. Book the appointment before the machine breaks.",
  },
  {
    id: "warranty_expiring_follow_up",
    when: "warranty_expiring",
    move: "send_follow_up",
    basePriority: 62,
    titleTemplate: (s) => s.title,
    rationale: () => "Warranty is about to lapse. Offer the extension while it's still eligible.",
  },
];

export interface RecommendOptions {
  /** Max moves to produce per signal. Default 1 — explicit and auditable. */
  maxMovesPerSignal?: number;
  /** Optional ruleset override for testing. */
  rules?: RecommenderRule[];
  /** Recommender version string stamped on every move. */
  recommenderVersion?: string;
  /** ISO timestamp used for "now" — tests inject a fixed value. */
  now?: string;
}

export function recommendMovesFromSignals(
  signals: RecommenderSignal[],
  opts: RecommendOptions = {},
): Array<MoveCreatePayload & { workspaceId: string; sourceSignalId: string; ruleId: string }> {
  const rules = opts.rules ?? DEFAULT_RULES;
  const maxPerSignal = opts.maxMovesPerSignal ?? 1;
  const version = opts.recommenderVersion ?? "deterministic-v1";
  const now = opts.now ? new Date(opts.now) : new Date();

  const out: Array<
    MoveCreatePayload & { workspaceId: string; sourceSignalId: string; ruleId: string }
  > = [];

  for (const signal of signals) {
    // Skip suppressed signals.
    if (signal.suppressed_until && new Date(signal.suppressed_until) > now) continue;

    const matches = rules.filter((rule) => {
      if (rule.when !== signal.kind) return false;
      if (rule.severityAtLeast) {
        if (SEVERITY_ORDER[signal.severity] < SEVERITY_ORDER[rule.severityAtLeast]) {
          return false;
        }
      }
      return true;
    });

    for (const rule of matches.slice(0, maxPerSignal)) {
      const priority = clampPriority(
        rule.basePriority + PRIORITY_BOOST_BY_SEVERITY[signal.severity],
      );
      const confidence = CONFIDENCE_BY_SEVERITY[signal.severity];

      out.push({
        kind: rule.move,
        title: rule.titleTemplate(signal),
        rationale: rule.rationale(signal),
        confidence,
        priority,
        entityType: signal.entity_type,
        entityId: signal.entity_id,
        assignedRepId: signal.assigned_rep_id,
        signalIds: [signal.id],
        recommender: "deterministic",
        recommenderVersion: version,
        payload: {
          signal_kind: signal.kind,
          signal_source: signal.source,
          rule_id: rule.id,
        },
        // Stamped on the side so the caller can route to workspace-aware inserts.
        workspaceId: signal.workspace_id,
        sourceSignalId: signal.id,
        ruleId: rule.id,
      });
    }
  }

  return out;
}

function clampPriority(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}
