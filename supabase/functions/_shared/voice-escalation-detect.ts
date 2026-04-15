/**
 * Voice → Escalation detection (Track 2 Slice 2.5).
 *
 * Pure function that inspects a voice-to-qrm extraction and returns either
 * null (no escalation) or a payload suitable for the `escalation-router`
 * edge function. Runs after the main DB writes so we can include the
 * resolved deal + contact IDs.
 *
 * Heuristics — we accept BOTH explicit model output (`intelligence.escalation`)
 * AND proxy signals that reliably correlate with a complaint the rep wants
 * escalated:
 *   1. `intelligence.escalation` is a structured object with `issue`
 *   2. `intelligence.sentiment === "negative"` AND `needs_assessment.current_equipment_issues`
 *      is a non-trivial string (> 20 chars)
 *   3. Narrative contains explicit escalation verbs ("escalate", "send to
 *      service manager", "manager needs to know") AND an issue description exists
 *
 * We intentionally keep the bar high: false-positive escalations damage trust
 * with reps more than missed escalations (a rep can always file manually).
 */

export interface VoiceEscalationExtraction {
  intelligence?: {
    sentiment?: string | null;
    escalation?: {
      issue?: string | null;
      department?: string | null;
      severity?: string | null;
    } | null;
  } | null;
  needs_assessment?: {
    current_equipment_issues?: string | null;
  } | null;
  qrm_narrative?: string | null;
}

export interface VoiceEscalationPayload {
  deal_id: string;
  contact_id: string | null;
  issue_description: string;
  department: string | null;
  severity: string | null;
  source: "voice_to_qrm";
  reason: "explicit" | "sentiment_with_issue" | "narrative_keyword";
}

const ESCALATION_KEYWORDS = [
  "escalate",
  "escalation",
  "send to service manager",
  "manager needs to know",
  "needs manager attention",
  "bring this up to",
  "loop in",
  "flag for",
];

function hasEscalationKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function nonTrivial(s: string | null | undefined, minLen = 20): s is string {
  return typeof s === "string" && s.trim().length >= minLen;
}

export function detectEscalationFromVoice(
  extracted: VoiceEscalationExtraction | null | undefined,
  context: { dealId: string | null; contactId: string | null },
): VoiceEscalationPayload | null {
  if (!extracted || !context.dealId) return null;

  const intelligence = extracted.intelligence ?? {};
  const explicit = intelligence.escalation;
  const issueFromNa = extracted.needs_assessment?.current_equipment_issues ?? null;

  // Path 1 — model returned a structured escalation block.
  if (explicit && typeof explicit.issue === "string" && explicit.issue.trim().length > 0) {
    return {
      deal_id: context.dealId,
      contact_id: context.contactId,
      issue_description: explicit.issue.trim(),
      department: explicit.department?.trim() || null,
      severity: explicit.severity?.trim() || null,
      source: "voice_to_qrm",
      reason: "explicit",
    };
  }

  // Path 2 — negative sentiment with a real equipment-issue description.
  if (intelligence.sentiment === "negative" && nonTrivial(issueFromNa)) {
    return {
      deal_id: context.dealId,
      contact_id: context.contactId,
      issue_description: issueFromNa,
      department: "Service",
      severity: "medium",
      source: "voice_to_qrm",
      reason: "sentiment_with_issue",
    };
  }

  // Path 3 — explicit escalation keyword in the narrative + an issue to cite.
  if (hasEscalationKeyword(extracted.qrm_narrative) && nonTrivial(issueFromNa, 10)) {
    return {
      deal_id: context.dealId,
      contact_id: context.contactId,
      issue_description: issueFromNa,
      department: null,
      severity: "medium",
      source: "voice_to_qrm",
      reason: "narrative_keyword",
    };
  }

  return null;
}
