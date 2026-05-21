import {
  classifyDecisionLane,
  type DecisionLane,
} from "../lane-classifier/logic.ts";

export type DecisionOwnerRole =
  | "brian"
  | "rylee"
  | "ryan"
  | "angela"
  | "norman"
  | "tina";

export interface PendingDecisionPayload {
  code?: string | null;
  blocking_decision?: string | null;
  title?: string | null;
  question?: string | null;
  description?: string | null;
  owner_hint?: string | null;
  evidence_link?: string | null;
  task_ids?: string[] | null;
  options?: unknown;
  citations?: unknown;
  context?: string | null;
  apply_update?: boolean;
  upsert?: boolean;
}

export interface TriageCitation {
  source: string;
  ref: string;
  excerpt: string;
}

export interface TriageRecommendation {
  recommended_option: string;
  recommended_rationale: string;
  reversal_cost: string;
  silence_threshold_days: number | null;
}

export interface PrecedentCandidate {
  id: string;
  source_decision_id: string;
  pattern_summary: string;
  applied_answer: string;
  applied_rationale: string | null;
  owner_role: string | null;
}

export interface PrecedentMatch extends PrecedentCandidate {
  score: number;
}

export interface AutoTriageResult {
  code: string;
  question_plain: string;
  lane: DecisionLane;
  owner_role: DecisionOwnerRole;
  options: unknown;
  citations: TriageCitation[];
  recommended_option: string;
  recommended_rationale: string;
  reversal_cost: string;
  silence_threshold_days: number | null;
  ai_prep_packet: {
    triage_version: "auto-triage-pipeline-v1";
    classifier_reason: string;
    classifier_keywords: string[];
    context: string;
    owner_routing_reason: string;
    precedent_match?: {
      precedent_id: string;
      source_decision_id: string;
      pattern_summary: string;
      applied_answer: string;
      applied_rationale: string | null;
      similarity_score: number;
      similarity_threshold: number;
    };
  };
  status: "open";
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function fallbackCode(input: PendingDecisionPayload): string {
  const raw = cleanText(input.blocking_decision) || "PENDING-DECISION";
  return raw.toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/-+/g, "-");
}

export function resolveDecisionCode(input: PendingDecisionPayload): string {
  return cleanText(input.code) || fallbackCode(input);
}

export function rewriteQuestionPlain(input: PendingDecisionPayload): string {
  const explicitQuestion = cleanText(input.question);
  if (explicitQuestion) {
    return /[?.!]$/.test(explicitQuestion)
      ? explicitQuestion
      : `${explicitQuestion}?`;
  }

  const title = cleanText(input.title);
  const description = cleanText(input.description);

  if (title && description) {
    return `Should we ${title.toLowerCase()} considering ${description}?`;
  }
  if (title) return `Should we ${title.toLowerCase()}?`;
  if (description) return `Should we proceed given ${description}?`;

  const blocking = cleanText(input.blocking_decision);
  if (blocking) return `Should we resolve ${blocking}?`;

  return "Should we proceed with this pending decision?";
}

export const PRECEDENT_SIMILARITY_THRESHOLD = 0.85;

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizedTokens(text: string): string[] {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function lexicalSimilarity(leftText: string, rightText: string): number {
  const leftClean = cleanText(leftText).toLowerCase();
  const rightClean = cleanText(rightText).toLowerCase();
  if (!leftClean || !rightClean) return 0;
  if (leftClean === rightClean) return 1;

  const leftSet = new Set(normalizedTokens(leftClean));
  const rightSet = new Set(normalizedTokens(rightClean));
  return Number(jaccardSimilarity(leftSet, rightSet).toFixed(4));
}

export function findBestPrecedentMatch(input: {
  decisionQuestion: string;
  ownerRole: DecisionOwnerRole;
  precedents: PrecedentCandidate[];
  threshold?: number;
}): PrecedentMatch | null {
  const threshold = input.threshold ?? PRECEDENT_SIMILARITY_THRESHOLD;
  let best: PrecedentMatch | null = null;

  for (const precedent of input.precedents) {
    const score = lexicalSimilarity(
      input.decisionQuestion,
      precedent.pattern_summary,
    );
    const ownerBonus =
      precedent.owner_role && precedent.owner_role === input.ownerRole
        ? 0.03
        : 0;
    const adjustedScore = Number(Math.min(1, score + ownerBonus).toFixed(4));

    if (adjustedScore < threshold) continue;
    if (!best || adjustedScore > best.score) {
      best = { ...precedent, score: adjustedScore };
    }
  }

  return best;
}

export function applyPrecedentRecommendation(
  draft: AutoTriageResult,
  match: PrecedentMatch,
  threshold = PRECEDENT_SIMILARITY_THRESHOLD,
): AutoTriageResult {
  return {
    ...draft,
    recommended_option: match.applied_answer,
    recommended_rationale: cleanText(match.applied_rationale) ||
      `Matched precedent ${match.source_decision_id}.`,
    ai_prep_packet: {
      ...draft.ai_prep_packet,
      precedent_match: {
        precedent_id: match.id,
        source_decision_id: match.source_decision_id,
        pattern_summary: match.pattern_summary,
        applied_answer: match.applied_answer,
        applied_rationale: match.applied_rationale,
        similarity_score: match.score,
        similarity_threshold: threshold,
      },
    },
  };
}

export function routeOwnerRole(input: PendingDecisionPayload): {
  owner_role: DecisionOwnerRole;
  reason: string;
} {
  const haystack = [
    cleanText(input.code),
    cleanText(input.blocking_decision),
    cleanText(input.title),
    cleanText(input.question),
    cleanText(input.description),
    cleanText(input.owner_hint),
    cleanText(input.context),
  ].join(" ").toLowerCase();

  if (containsAny(haystack, ["rylee", "sales", "marketing"])) {
    return {
      owner_role: "rylee",
      reason: "Matched sales/marketing routing keywords.",
    };
  }
  if (containsAny(haystack, ["ryan", "owner", "visual", "brand", "scope"])) {
    return {
      owner_role: "ryan",
      reason: "Matched owner/visual/brand routing keywords.",
    };
  }
  if (containsAny(haystack, ["angela", "tila", "compliance", "lending"])) {
    return {
      owner_role: "angela",
      reason: "Matched compliance/lending routing keywords.",
    };
  }
  if (containsAny(haystack, ["norman", "parts"])) {
    return { owner_role: "norman", reason: "Matched parts routing keywords." };
  }
  if (
    containsAny(haystack, [
      "tina",
      "finance",
      "ap",
      "accounting",
      "closed-period",
      "closed period",
    ])
  ) {
    return {
      owner_role: "tina",
      reason: "Matched finance/accounting routing keywords.",
    };
  }

  return {
    owner_role: "brian",
    reason: "No explicit owner signal; default owner is brian.",
  };
}

function normalizeExistingCitations(citations: unknown): TriageCitation[] {
  if (!Array.isArray(citations)) return [];
  const rows: TriageCitation[] = [];

  for (const citation of citations) {
    if (!citation || typeof citation !== "object") continue;
    const record = citation as Record<string, unknown>;
    const source = cleanText(
      typeof record.source === "string" ? record.source : "provided",
    );
    const ref = cleanText(
      typeof record.ref === "string" ? record.ref : "payload.citations",
    );
    const excerpt = cleanText(
      typeof record.excerpt === "string" ? record.excerpt : "Provided citation",
    );
    rows.push({ source, ref, excerpt });
  }

  return rows;
}

export function buildDeterministicCitations(
  input: PendingDecisionPayload,
): TriageCitation[] {
  const citations: TriageCitation[] = [];

  const evidenceLink = cleanText(input.evidence_link);
  if (evidenceLink) {
    citations.push({
      source: "evidence_link",
      ref: evidenceLink,
      excerpt: "Primary evidence link provided with pending decision payload.",
    });
  }

  const taskIds = (input.task_ids ?? []).filter((id) =>
    typeof id === "string" && cleanText(id).length > 0
  );
  for (const taskId of taskIds) {
    citations.push({
      source: "task",
      ref: cleanText(taskId),
      excerpt: `Pending decision references task ${cleanText(taskId)}.`,
    });
  }

  const title = cleanText(input.title);
  if (title) {
    citations.push({
      source: "payload",
      ref: "title",
      excerpt: title,
    });
  }

  const description = cleanText(input.description);
  if (description) {
    citations.push({
      source: "payload",
      ref: "description",
      excerpt: description,
    });
  }

  const context = cleanText(input.context);
  if (context) {
    citations.push({
      source: "payload",
      ref: "context",
      excerpt: context,
    });
  }

  citations.push(...normalizeExistingCitations(input.citations));

  const deduped = new Map<string, TriageCitation>();
  for (const citation of citations) {
    const key = `${citation.source}|${citation.ref}|${citation.excerpt}`;
    if (!deduped.has(key)) deduped.set(key, citation);
  }

  return [...deduped.values()];
}

export function draftRecommendation(lane: DecisionLane): TriageRecommendation {
  if (lane === "authorize") {
    return {
      recommended_option: "escalate_for_authorization",
      recommended_rationale:
        "High-impact or low-reversibility signal detected; require explicit authorization.",
      reversal_cost: "high",
      silence_threshold_days: null,
    };
  }

  if (lane === "auto") {
    return {
      recommended_option: "auto_safe_default",
      recommended_rationale:
        "Low-risk/reversible signal detected; propose conservative default execution.",
      reversal_cost: "low",
      silence_threshold_days: 1,
    };
  }

  return {
    recommended_option: "ratify_with_owner",
    recommended_rationale:
      "Moderate-impact signal detected; route for owner ratification before execution.",
    reversal_cost: "medium",
    silence_threshold_days: 7,
  };
}

export function buildAutoTriageDraft(
  input: PendingDecisionPayload,
): AutoTriageResult {
  const code = resolveDecisionCode(input);
  const question_plain = rewriteQuestionPlain(input);
  const classification = classifyDecisionLane({
    code,
    question_plain,
    text: [
      cleanText(input.title),
      cleanText(input.description),
      cleanText(input.context),
    ].join(" "),
    options: input.options,
    citations: input.citations,
  });
  const ownerRoute = routeOwnerRole(input);
  const citations = buildDeterministicCitations(input);
  const recommendation = draftRecommendation(classification.lane);

  const context = [
    `code=${code}`,
    `title=${cleanText(input.title)}`,
    `description=${cleanText(input.description)}`,
    `context=${cleanText(input.context)}`,
  ].join(" | ");

  return {
    code,
    question_plain,
    lane: classification.lane,
    owner_role: ownerRoute.owner_role,
    options: input.options ?? [],
    citations,
    recommended_option: recommendation.recommended_option,
    recommended_rationale: recommendation.recommended_rationale,
    reversal_cost: recommendation.reversal_cost,
    silence_threshold_days: recommendation.silence_threshold_days,
    ai_prep_packet: {
      triage_version: "auto-triage-pipeline-v1",
      classifier_reason: classification.reason,
      classifier_keywords: classification.matchedKeywords,
      context,
      owner_routing_reason: ownerRoute.reason,
    },
    status: "open",
  };
}
