/**
 * Wave 7 Iron — classifier output validation + prompt injection guard.
 *
 * This module is the security spine of Iron. Every classifier response must
 * pass these checks BEFORE the orchestrator trusts the result:
 *
 *   1. Schema validation (hand-rolled, no zod dep) — catches malformed JSON
 *      or missing fields.
 *   2. Output regex blocklist — catches obvious LLM jailbreak / SQL fragments
 *      / system-prompt-leak tokens that should never appear in classifier
 *      output regardless of user input.
 *   3. Flow allowlist — flow_id must exist in the loaded flow_workflow_definitions
 *      with surface in (iron_conversational, iron_voice). The orchestrator
 *      passes the loaded list in.
 *
 * Role re-check is enforced by the orchestrator, NOT here, because role
 * lookup needs DB access.
 */

export type IronClassifierCategory =
  | "FLOW_DISPATCH"
  | "READ_ANSWER"
  | "AGENTIC_TASK"
  | "HUMAN_ESCALATION"
  | "CLARIFY";

export interface IronClassifierResult {
  category: IronClassifierCategory;
  confidence: number;
  flow_id: string | null;
  prefilled_slots: Record<string, unknown> | null;
  answer_query: string | null;
  agentic_brief: string | null;
  escalation_reason: string | null;
  clarification_needed: string | null;
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  "FLOW_DISPATCH",
  "READ_ANSWER",
  "AGENTIC_TASK",
  "HUMAN_ESCALATION",
  "CLARIFY",
]);

const SUSPICIOUS_PATTERNS: RegExp[] = [
  /\bignore\s+previous\s+instructions?\b/i,
  /\b(system|assistant)\s*:\s*(you\s+are|new\s+instructions)/i,
  /\bdrop\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\btruncate\s+table\b/i,
  /<\|im_(start|end)\|>/i,
  /\.\.\/|\\\.\\\./, // path traversal
  /\bENV\b|\bANTHROPIC_API_KEY\b|\bSUPABASE_SERVICE_ROLE_KEY\b/,
  /\{\{\s*workspace\.|\{\{\s*credentials/i,
  /reveal\s+system\s+prompt/i,
  /<\/(user_input|system|tool_use)>/i,
];

const FLOW_ID_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type GuardResult =
  | { ok: true; result: IronClassifierResult }
  | { ok: false; reason: string; raw?: string };

/**
 * Parse + validate raw classifier text. Returns a typed result or rejection
 * reason. Caller must additionally verify the flow_id against the loaded
 * flow_workflow_definitions allowlist (this module is DB-free for testability).
 */
export function parseAndGuardClassifierOutput(rawText: string): GuardResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    return { ok: false, reason: "classifier_output_not_json", raw: rawText.slice(0, 200) };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "classifier_output_not_object" };
  }

  const obj = parsed as Record<string, unknown>;

  const category = obj.category;
  if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
    return { ok: false, reason: `invalid_category:${String(category).slice(0, 32)}` };
  }

  const confidence = obj.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: "invalid_confidence" };
  }

  const flowIdRaw = obj.flow_id;
  let flowId: string | null = null;
  if (flowIdRaw != null) {
    if (typeof flowIdRaw !== "string") {
      return { ok: false, reason: "flow_id_not_string" };
    }
    if (flowIdRaw.length > 64) {
      return { ok: false, reason: "flow_id_too_long" };
    }
    if (!FLOW_ID_RE.test(flowIdRaw)) {
      return { ok: false, reason: "flow_id_invalid_format" };
    }
    flowId = flowIdRaw;
  }

  const prefilledSlotsRaw = obj.prefilled_slots;
  let prefilledSlots: Record<string, unknown> | null = null;
  if (prefilledSlotsRaw != null) {
    if (typeof prefilledSlotsRaw !== "object" || Array.isArray(prefilledSlotsRaw)) {
      return { ok: false, reason: "prefilled_slots_not_object" };
    }
    // Lightly scan slot string values for SQL fragments — defense in depth.
    // The action layer also validates, but rejecting here keeps logs clean.
    for (const v of Object.values(prefilledSlotsRaw)) {
      if (typeof v === "string") {
        for (const re of SUSPICIOUS_PATTERNS) {
          if (re.test(v)) {
            return { ok: false, reason: "prefilled_slot_suspicious_value" };
          }
        }
      }
    }
    prefilledSlots = prefilledSlotsRaw as Record<string, unknown>;
  }

  // Optional string fields with size + pattern guards
  const answerQuery = stringOrNull(obj.answer_query, 500);
  const agenticBrief = stringOrNull(obj.agentic_brief, 2000);
  const escalationReason = stringOrNull(obj.escalation_reason, 500);
  const clarificationNeeded = stringOrNull(obj.clarification_needed, 500);

  // Suspicious-pattern scan across the long text fields.
  for (const field of [answerQuery, agenticBrief, escalationReason, clarificationNeeded]) {
    if (field == null) continue;
    for (const re of SUSPICIOUS_PATTERNS) {
      if (re.test(field)) {
        return { ok: false, reason: "classifier_output_suspicious" };
      }
    }
  }

  const result: IronClassifierResult = {
    category: category as IronClassifierCategory,
    confidence,
    flow_id: flowId,
    prefilled_slots: prefilledSlots,
    answer_query: answerQuery,
    agentic_brief: agenticBrief,
    escalation_reason: escalationReason,
    clarification_needed: clarificationNeeded,
  };

  return { ok: true, result };
}

function stringOrNull(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Final defense-in-depth check after the guard passes. Caller passes the set
 * of allowed flow IDs (already filtered by surface + role). Returns true if
 * the result's flow_id is allowed (or null for non-FLOW_DISPATCH).
 */
export function isFlowAllowed(
  result: IronClassifierResult,
  allowedFlowIds: ReadonlySet<string>,
): boolean {
  if (result.category !== "FLOW_DISPATCH") return true;
  if (result.flow_id == null) return false;
  return allowedFlowIds.has(result.flow_id);
}
