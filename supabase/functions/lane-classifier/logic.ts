export type DecisionLane = "auto" | "ratify" | "authorize";

export interface LaneClassificationInput {
  code?: string | null;
  question_plain?: string | null;
  recommended_rationale?: string | null;
  reversal_cost?: string | null;
  text?: string | null;
  options?: unknown;
  citations?: unknown;
  ai_prep_packet?: unknown;
}

export interface LaneClassificationResult {
  lane: DecisionLane;
  matchedKeywords: string[];
  reason: string;
}

export function mergeLaneClassificationInput(
  persisted: LaneClassificationInput,
  explicit: LaneClassificationInput,
): LaneClassificationInput {
  const pick = <T>(persistedValue: T | undefined | null, explicitValue: T | undefined | null): T | undefined => {
    if (explicitValue !== undefined && explicitValue !== null) return explicitValue;
    if (persistedValue !== undefined && persistedValue !== null) return persistedValue;
    return undefined;
  };

  return {
    code: pick(persisted.code, explicit.code),
    question_plain: pick(persisted.question_plain, explicit.question_plain),
    recommended_rationale: pick(persisted.recommended_rationale, explicit.recommended_rationale),
    reversal_cost: pick(persisted.reversal_cost, explicit.reversal_cost),
    text: pick(persisted.text, explicit.text),
    options: pick(persisted.options, explicit.options),
    citations: pick(persisted.citations, explicit.citations),
    ai_prep_packet: pick(persisted.ai_prep_packet, explicit.ai_prep_packet),
  };
}

const AUTHORIZE_KEYWORDS = [
  "money",
  "contract",
  "schema",
  "compliance",
  "legal",
  "data cutover",
  "cutover",
  "security",
  "credential",
  "customer data retention",
  "retention",
  "destructive",
  "irreversible",
  "tila",
] as const;

const RATIFY_KEYWORDS = [
  "policy",
  "integration",
  "rule-based",
  "rule based",
  "operational",
  "citation",
  "financial",
] as const;

const AUTO_KEYWORDS = [
  "feature flag",
  "flag",
  "copy",
  "ui default",
  "default",
  "low-risk",
  "low risk",
  "reversible",
  "configurable default",
] as const;

function collectText(input: LaneClassificationInput): string {
  const fragments: string[] = [];
  const pushString = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) fragments.push(value.trim());
  };

  pushString(input.code);
  pushString(input.question_plain);
  pushString(input.recommended_rationale);
  pushString(input.reversal_cost);
  pushString(input.text);

  if (Array.isArray(input.options)) {
    for (const option of input.options) {
      if (typeof option === "string") {
        pushString(option);
      } else if (option && typeof option === "object") {
        const record = option as Record<string, unknown>;
        pushString(record.label);
        pushString(record.description);
        pushString(record.implication);
      }
    }
  }

  if (Array.isArray(input.citations)) {
    for (const citation of input.citations) {
      if (citation && typeof citation === "object") {
        const record = citation as Record<string, unknown>;
        pushString(record.excerpt);
        pushString(record.ref);
      }
    }
  }

  if (input.ai_prep_packet && typeof input.ai_prep_packet === "object") {
    const packet = input.ai_prep_packet as Record<string, unknown>;
    pushString(packet.context);
    pushString(packet.recommended_with_reasoning);
    pushString(packet.reversal_cost);
  }

  return fragments.join(" ").toLowerCase();
}

function findKeywordMatches(haystack: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => haystack.includes(keyword));
}

export function classifyDecisionLane(input: LaneClassificationInput): LaneClassificationResult {
  const haystack = collectText(input);

  const authorizeMatches = findKeywordMatches(haystack, AUTHORIZE_KEYWORDS);
  if (authorizeMatches.length > 0) {
    return {
      lane: "authorize",
      matchedKeywords: authorizeMatches,
      reason: "Matched low-reversibility/high-risk AUTHORIZE heuristics.",
    };
  }

  const ratifyMatches = findKeywordMatches(haystack, RATIFY_KEYWORDS);
  if (ratifyMatches.length > 0) {
    return {
      lane: "ratify",
      matchedKeywords: ratifyMatches,
      reason: "Matched medium-reversibility RATIFY heuristics.",
    };
  }

  const autoMatches = findKeywordMatches(haystack, AUTO_KEYWORDS);
  if (autoMatches.length > 0) {
    return {
      lane: "auto",
      matchedKeywords: autoMatches,
      reason: "Matched high-reversibility AUTO heuristics.",
    };
  }

  return {
    lane: "ratify",
    matchedKeywords: [],
    reason: "No strong AUTO/AUTHORIZE signal; defaulting to RATIFY.",
  };
}
