/**
 * Escalation Intelligence (Track 2 Slice 2.5).
 *
 * Pure functions for the `escalation-router` to:
 *   - Auto-identify a department manager when the caller didn't pass one
 *   - Score severity from deal value + issue signal + optional sentiment hint
 *   - Suggest a resolution template for the email draft
 *
 * Keeps the decisions testable without spinning up a DB. The router wires
 * DB reads (deal amount, profile lookup) into the inputs these functions take.
 */

// ─── Severity scoring ──────────────────────────────────────────────────────

export type EscalationSeverity = "low" | "medium" | "high";

export interface SeverityInput {
  /** Most-recent deal value (dollars). Acts as the LTV proxy. */
  deal_amount: number | null;
  /** Free-text issue description from the transcript. */
  issue_description: string;
  /** Optional sentiment hint from the upstream voice extractor. */
  sentiment?: string | null;
  /**
   * Explicit severity the caller requested. We accept it unless it under-
   * estimates what the LTV + language suggest — the router should never
   * silently downgrade a "high" flagged by a human.
   */
  explicit?: string | null;
}

const HIGH_SEVERITY_KEYWORDS = [
  "down",
  "broken",
  "stop",
  "stopped",
  "refund",
  "lawyer",
  "legal",
  "furious",
  "fired",
  "fire us",
  "replace",
  "switch",
  "competitor",
  "injured",
  "injury",
  "safety",
];

const MEDIUM_SEVERITY_KEYWORDS = [
  "leak",
  "delay",
  "late",
  "stalled",
  "waiting",
  "slow",
  "overdue",
  "unhappy",
  "upset",
  "frustrat",
];

function normalizeExplicit(explicit: string | null | undefined): EscalationSeverity | null {
  if (!explicit) return null;
  const v = explicit.toLowerCase().trim();
  if (v === "high" || v === "critical" || v === "urgent") return "high";
  if (v === "medium" || v === "normal") return "medium";
  if (v === "low" || v === "minor") return "low";
  return null;
}

/**
 * Compute escalation severity. Priority:
 *   1. Explicit "high" always wins.
 *   2. Issue text with a high-impact keyword or deal > $250k → "high".
 *   3. Deal >= $50k or sentiment="negative" or medium keyword → "medium".
 *   4. Fall back to explicit if present, else "low".
 */
export function scoreEscalationSeverity(input: SeverityInput): EscalationSeverity {
  const explicit = normalizeExplicit(input.explicit);
  if (explicit === "high") return "high";

  const text = (input.issue_description ?? "").toLowerCase();
  const amount = input.deal_amount ?? 0;

  const hasHighKw = HIGH_SEVERITY_KEYWORDS.some((kw) => text.includes(kw));
  if (hasHighKw || amount >= 250_000) return "high";

  const hasMediumKw = MEDIUM_SEVERITY_KEYWORDS.some((kw) => text.includes(kw));
  if (hasMediumKw || amount >= 50_000 || input.sentiment === "negative") return "medium";

  return explicit ?? "low";
}

// ─── Manager resolution ────────────────────────────────────────────────────

export interface ManagerCandidate {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  iron_role?: string | null;
  /** When true, this profile specifically owns the target department. */
  department_match?: boolean;
}

export interface ResolveManagerInput {
  /** Already-supplied name, if the caller knows it. Wins if present. */
  explicit_name?: string | null;
  explicit_email?: string | null;
  department?: string | null;
  candidates: ManagerCandidate[];
}

export interface ResolvedManager {
  name: string | null;
  email: string | null;
  user_id: string | null;
  reason: "explicit" | "department_match" | "iron_manager" | "workspace_admin" | "unknown";
}

/**
 * Pick the best manager target given what the caller supplied + a pool of
 * candidate profiles. Ordering:
 *   1. Explicit name + email from the caller.
 *   2. A candidate with `department_match === true`.
 *   3. A candidate with `iron_role === "iron_manager"`.
 *   4. Any candidate (admin/owner fallback).
 *   5. null (unknown).
 */
export function resolveEscalationManager(input: ResolveManagerInput): ResolvedManager {
  if (input.explicit_name || input.explicit_email) {
    return {
      name: input.explicit_name ?? null,
      email: input.explicit_email ?? null,
      user_id: null,
      reason: "explicit",
    };
  }

  const deptMatch = input.candidates.find((c) => c.department_match === true);
  if (deptMatch) {
    return {
      name: deptMatch.full_name,
      email: deptMatch.email,
      user_id: deptMatch.id,
      reason: "department_match",
    };
  }

  const ironManager = input.candidates.find((c) => c.iron_role === "iron_manager");
  if (ironManager) {
    return {
      name: ironManager.full_name,
      email: ironManager.email,
      user_id: ironManager.id,
      reason: "iron_manager",
    };
  }

  const any = input.candidates.find((c) => ["admin", "manager", "owner"].includes(c.role));
  if (any) {
    return {
      name: any.full_name,
      email: any.email,
      user_id: any.id,
      reason: "workspace_admin",
    };
  }

  return { name: null, email: null, user_id: null, reason: "unknown" };
}

// ─── Resolution suggestion ─────────────────────────────────────────────────

/**
 * Template-based resolution hint surfaced alongside the escalation email so
 * the responder has a concrete first action, not just a complaint to triage.
 * Falls back to a generic suggestion when no pattern matches.
 */
export function suggestResolution(input: { issue_description: string; severity: EscalationSeverity }): string {
  const text = input.issue_description.toLowerCase();
  if (/\b(down|stopped|broken|not running|will not start)\b/.test(text)) {
    return "Dispatch a service technician within 24 hours; offer a loaner if lead time exceeds 48 hours.";
  }
  if (/\b(leak|hydraulic|oil)\b/.test(text)) {
    return "Schedule a hydraulic-system inspection and confirm warranty coverage before customer pays out of pocket.";
  }
  if (/\b(part|parts|backorder|waiting|delivery)\b/.test(text)) {
    return "Expedite the parts order, confirm ETA in writing to the customer, and flag the PO as priority.";
  }
  if (/\b(billing|invoice|charge|refund)\b/.test(text)) {
    return "Route to the A/R team for invoice review; confirm disputed charge in writing within one business day.";
  }
  if (input.severity === "high") {
    return "Call the customer within 4 hours; owner/branch manager confirms resolution plan before EOD.";
  }
  return "Call the customer within 1 business day to confirm the issue is understood and set an expected resolution date.";
}
