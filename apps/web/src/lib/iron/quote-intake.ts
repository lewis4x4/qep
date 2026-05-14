/**
 * Iron quote intake foundation.
 *
 * North star: Iron should behave like a QEP operator/trainer/manager/admin
 * assistant for newer desk personnel — not a chat search box and not a dumb
 * redirect. Natural messy phrases that imply quote creation should be routed
 * deterministically into Quote Builder, with the raw spoken context preserved
 * as intake/training notes. Customer resolution is best-effort only; the
 * workflow should still open with guardrails so the rep verifies customer,
 * equipment, options, and timeframe before pricing.
 *
 * Keep read-only SOP/process/quote-status questions out of this path so they
 * continue to route to Iron knowledge.
 */
export interface IronQuoteIntakeIntent {
  rawText: string;
  targetText: string;
  customerSearchCandidates: string[];
  confidence: "high" | "medium";
}

const MAX_CANDIDATES = 4;

const READ_OR_STATUS_RE = /\b(?:show|list|find|lookup|look\s+up|search|status|pending|approved|approval|sent|accepted|rejected|existing|old|previous|history)\b[\s\S]*\bquotes?\b|\bquotes?\b[\s\S]*\b(?:status|pending|approval|approved|sent|accepted|rejected|history)\b/i;

const ACTION_QUOTE_RE = /\b(?:start|build|create|open|draft|prepare|make|write|generate|assemble)\b[\s\S]{0,80}\b(?:quote|proposal|pricing)\b/i;
const PUT_TOGETHER_RE = /\bput\s+together\b[\s\S]{0,80}\b(?:quote|proposal|pricing)\b/i;
const NEED_QUOTE_RE = /\b(?:i|we)\s+(?:need|want|gotta|have\s+to|need\s+to|want\s+to)\b[\s\S]{0,120}\b(?:quote|proposal|pricing)\b|\b(?:i|we)\s+(?:need|want|gotta|have\s+to|need\s+to|want\s+to)\s+(?:to\s+)?quote\b/i;
const CUSTOMER_WANTS_RE = /\b(?:customer|client|he|she|they)\b[\s\S]{0,80}\b(?:wants?|needs?|asked\s+for)\b[\s\S]{0,80}\b(?:quote|proposal|pricing)\b/i;

const TARGET_CAPTURE_PATTERNS = [
  /\b(?:quote)\s+(?:this|that)?\s*(?:piece\s+of\s+)?(?:equipment|machine)?\s*(?:for|with|to|on)\s+(.+)$/i,
  /\b(?:quote|proposal|pricing)\s+(?:for|with|to|on)\s+(.+)$/i,
  /\b(?:quote|proposal|pricing)\s+(.+)$/i,
  /\b(?:for|with|to|on)\s+(.+)$/i,
];

const LEADING_FILLER_RE = /^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|will\s+you\s+)?(?:help\s+me\s+)?/i;
const TRAILING_PUNCTUATION_RE = /[.!?]+$/;

const WORK_TAIL_TERMS = new Set([
  "next",
  "week",
  "weeks",
  "tomorrow",
  "today",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "by",
  "before",
  "after",
  "underbrushing",
  "brush",
  "brushing",
  "clearing",
  "mulching",
  "mulcher",
  "land",
  "grading",
  "rental",
  "delivery",
  "demo",
  "timeframe",
  "timeline",
  "options",
  "option",
]);

const SINGLE_TOKEN_STOPWORDS = new Set([
  "this",
  "that",
  "customer",
  "client",
  "equipment",
  "machine",
  "piece",
  "quote",
  "proposal",
  "pricing",
]);

const QUOTE_EQUIPMENT_TERMS = new Set([
  "quote",
  "proposal",
  "pricing",
  "machine",
  "equipment",
  "attachment",
  "attachments",
  "piece",
  "customer",
  "client",
]);

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(TRAILING_PUNCTUATION_RE, "").trim();
}

function stripIntro(text: string): string {
  return cleanText(text).replace(LEADING_FILLER_RE, "").trim();
}

function hasQuoteCreationIntent(text: string): boolean {
  if (!/\b(?:quote|proposal|pricing)\b|\bquote\b/i.test(text)) return false;
  if (READ_OR_STATUS_RE.test(text)) return false;
  return ACTION_QUOTE_RE.test(text)
    || PUT_TOGETHER_RE.test(text)
    || NEED_QUOTE_RE.test(text)
    || CUSTOMER_WANTS_RE.test(text);
}

function extractTargetText(text: string): string {
  const cleaned = stripIntro(text);
  for (const pattern of TARGET_CAPTURE_PATTERNS) {
    const match = cleaned.match(pattern);
    const captured = cleanText(match?.[1] ?? "");
    if (captured.length >= 2) return captured;
  }
  return cleaned;
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'&\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function candidateFromWords(words: string[]): string {
  return words.join(" ").trim();
}

function addCandidate(candidates: string[], seen: Set<string>, candidate: string): void {
  const cleaned = cleanText(candidate.toLowerCase());
  if (cleaned.length < 2) return;
  if (seen.has(cleaned)) return;
  seen.add(cleaned);
  candidates.push(cleaned);
}

export function buildQuoteCustomerSearchCandidates(targetText: string): string[] {
  const words = wordsOf(targetText);
  const candidates: string[] = [];
  const seen = new Set<string>();

  addCandidate(candidates, seen, candidateFromWords(words));

  let tailIndex = words.findIndex((word) => WORK_TAIL_TERMS.has(word) || QUOTE_EQUIPMENT_TERMS.has(word));
  if (tailIndex > 0) {
    addCandidate(candidates, seen, candidateFromWords(words.slice(0, tailIndex)));
  }

  const connectiveIndex = words.findIndex((word) => ["and", "with", "wants", "want", "needs", "need", "for"].includes(word));
  if (connectiveIndex > 1) {
    addCandidate(candidates, seen, candidateFromWords(words.slice(0, connectiveIndex)));
  }

  for (let length = Math.min(words.length, 4); length >= 2 && candidates.length < MAX_CANDIDATES; length -= 1) {
    addCandidate(candidates, seen, candidateFromWords(words.slice(0, length)));
  }

  if (words.length > 0 && !SINGLE_TOKEN_STOPWORDS.has(words[0]!) && candidates.length < MAX_CANDIDATES) {
    addCandidate(candidates, seen, words[0]!);
  }

  return candidates.slice(0, MAX_CANDIDATES);
}

export function extractIronQuoteIntakeIntent(text: string): IronQuoteIntakeIntent | null {
  const rawText = cleanText(text);
  if (rawText.length < 3) return null;
  if (!hasQuoteCreationIntent(rawText)) return null;

  const targetText = extractTargetText(rawText);
  const customerSearchCandidates = buildQuoteCustomerSearchCandidates(targetText);
  const confidence = /\b(?:start|build|create|open|draft|prepare|put\s+together|quote)\b/i.test(rawText)
    ? "high"
    : "medium";

  return {
    rawText,
    targetText,
    customerSearchCandidates,
    confidence,
  };
}
