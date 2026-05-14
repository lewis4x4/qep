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
export type IronQuoteIntakeField = "customer" | "equipment" | "options" | "timeframe";

export interface IronQuoteStructuredIntake {
  customerText: string | null;
  equipmentText: string | null;
  optionsText: string | null;
  timeframeText: string | null;
  applicationText: string | null;
  missingFields: IronQuoteIntakeField[];
}

export interface IronQuoteIntakeIntent {
  rawText: string;
  targetText: string;
  customerSearchCandidates: string[];
  confidence: "high" | "medium";
  structuredIntake: IronQuoteStructuredIntake;
}

const MAX_CANDIDATES = 4;
const INTAKE_REQUIRED_FIELDS: IronQuoteIntakeField[] = ["customer", "equipment", "options", "timeframe"];

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
const TRAILING_PUNCTUATION_RE = /[.!?,;:]+$/;

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

const APPLICATION_TERMS = [
  "underbrushing",
  "brush clearing",
  "land clearing",
  "mulching",
  "grading",
  "site prep",
  "right of way",
  "right-of-way",
  "forestry",
  "demo",
  "demolition",
  "ditch cleaning",
  "drainage",
  "rental",
];

const GENERIC_CUSTOMER_RE = /\b(?:this|that|the)?\s*(?:customer|client|buyer|guy|person)\b/i;
const GENERIC_EQUIPMENT_RE = /\b(?:this|that|the)?\s*(?:piece\s+of\s+)?(?:equipment|machine|unit)\b/i;
const NO_OPTIONS_RE = /\b(?:no|none|standard|stock)\b[\s\S]{0,24}\b(?:options?|attachments?|adds?|accessories)\b|\b(?:no|none)\b/i;
const NO_TIMEFRAME_RE = /\b(?:no|none|not\s+sure|unknown|tbd)\b[\s\S]{0,24}\b(?:timeframe|timeline|date|rush)\b/i;

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

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanText(match?.[1] ?? "");
    if (value.length >= 2) return value;
  }
  return null;
}

function stripTrailingContext(value: string): string {
  return cleanText(value)
    .replace(/\s+\b(?:and|with)\b\s+(?:he|she|they|it|customer|client)\b[\s\S]*$/i, "")
    .replace(/\s+\b(?:needs?|wants?|asked\s+for|by|before|next|this|today|tomorrow|timeframe|timeline)\b[\s\S]*$/i, "")
    .trim();
}

function extractTimeframeText(text: string): string | null {
  if (NO_TIMEFRAME_RE.test(text)) return "not specified";
  return firstMatch(text, [
    /\b((?:asap|right\s+away|urgent|rush))\b/i,
    /\b((?:by|before|after)\s+(?:end\s+of\s+)?(?:today|tomorrow|next\s+week|this\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[a-z]+\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))\b/i,
    /\b((?:today|tomorrow|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)))\b/i,
    /\b((?:this\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)))\b/i,
    /\b((?:within|in)\s+\d+\s+(?:day|days|week|weeks|month|months))\b/i,
    /\b(?:timeframe|timeline|delivery|needed|needs\s+it|wants\s+it)\s*(?:is|:|for|by)?\s*([^,.;]+)$/i,
  ]);
}

function extractApplicationText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of APPLICATION_TERMS) {
    if (lower.includes(term)) return term;
  }
  const value = firstMatch(text, [
    /\b(?:for|doing|job\s+is|application\s+is|use\s+case\s+is)\s+([^,.;]+?)(?:\s+with\s+|\s+by\s+|\s+before\s+|$)/i,
  ]);
  if (!value) return null;
  if (GENERIC_CUSTOMER_RE.test(value) || /\b(?:these?|those)\s+options?|timeframe|timeline\b/i.test(value)) return null;
  return value;
}

function extractOptionsText(text: string): string | null {
  if (NO_OPTIONS_RE.test(text)) return "none specified";
  const value = firstMatch(text, [
    /\b(?:with|including)\s+(?:the\s+)?(?:options?|attachments?|accessories)\s+([^,.;]+?)(?:\s+by\s+|\s+before\s+|\s+next\s+|\s+this\s+|$)/i,
    /\b(?:options?|attachments?|accessories)\s*(?:are|is|:)?\s*([^,.;]+?)(?:\s+by\s+|\s+before\s+|\s+next\s+|\s+this\s+|$)/i,
    /\bwith\s+(.+?)(?:\s+by\s+|\s+before\s+|\s+next\s+|\s+this\s+|\s+needs\s+it\b|\s+wants\s+it\b|$)/i,
  ]);
  if (!value) return null;
  if (/^(?:in|for|with|these?|those|the)?\s*(?:options?|attachments?|accessories)?$/i.test(value)) return null;
  if (/\btimeframe|timeline\b/i.test(value)) return null;
  return value;
}

function looksLikeEquipmentText(value: string): boolean {
  const text = value.toLowerCase();
  if (GENERIC_EQUIPMENT_RE.test(text)) return false;
  return /\b(?:skid\s*steer|track\s*loader|compact\s*track|excavator|mini\s*ex|dozer|loader|backhoe|tractor|telehandler|forklift|mulcher|bucket|grapple|thumb|mower|cutter|rake|trailer|bobcat|kubota|cat|caterpillar|deere|john\s+deere|asv|case|takeuchi|yanmar|toro|rt[-\s]?\d+|t\d{3,4}|e\d{2,3}|kx\d+|svl\d+|ctl|utv)\b/i.test(text)
    || /\b[a-z]{1,6}[-\s]?\d{2,4}[a-z]?\b/i.test(value);
}

function extractEquipmentText(text: string): string | null {
  const cleaned = cleanText(text);
  const beforeCustomer = firstMatch(cleaned, [
    /\b(?:quote|pricing|proposal)\s+(?:a|an|the)?\s*([^,.;]+?)\s+\b(?:for|to)\b/i,
  ]);
  if (beforeCustomer && looksLikeEquipmentText(beforeCustomer)) return stripTrailingContext(beforeCustomer);

  const explicit = firstMatch(cleaned, [
    /\b(?:machine|equipment|unit|model)\s*(?:is|:)?\s*([^,.;]+?)(?:\s+with\s+|\s+for\s+|\s+by\s+|\s+before\s+|$)/i,
    /\b(?:quoting|quote)\s+(?:a|an|the)?\s*([^,.;]+?)(?:\s+for\s+|\s+to\s+|\s+with\s+|\s+by\s+|\s+before\s+|$)/i,
  ]);
  if (explicit && looksLikeEquipmentText(explicit)) return stripTrailingContext(explicit);

  const withSplit = cleaned.match(/^([^,.;]+?)\s+with\s+([^,.;]+?)(?:\s+by\s+|\s+before\s+|\s+next\s+|\s+this\s+|\s+needs\s+it\b|\s+wants\s+it\b|$)/i);
  const beforeWith = cleanText(withSplit?.[1] ?? "");
  if (beforeWith && looksLikeEquipmentText(beforeWith)) return stripTrailingContext(beforeWith);

  const leadingEquipment = cleaned.match(/^([^,.;]+?)(?:\s+with\s+|\s+by\s+|\s+before\s+|\s+next\s+|\s+this\s+|\s+needs\s+it\b|\s+wants\s+it\b|$)/i)?.[1] ?? "";
  const leading = cleanText(leadingEquipment);
  if (leading && looksLikeEquipmentText(leading)) return stripTrailingContext(leading);

  return null;
}

function extractCustomerText(text: string, targetText: string): string | null {
  if (/\b(?:for|to)\s+(?:this|that|the)?\s*(?:customer|client)\b/i.test(text)) return null;

  const explicit = firstMatch(text, [
    /\b(?:customer|client|company)\s*(?:is|:)?\s*([^,.;]+?)(?:\s+and\s+|\s+with\s+|\s+wants?\b|\s+needs?\b|\s+for\s+(?:a|an|the)\b|$)/i,
    /\b(?:for|to)\s+([^,.;]+?)(?:\s+and\s+|\s+with\s+|\s+wants?\b|\s+needs?\b|\s+for\s+(?:a|an|the)\b|\s+on\s+(?:a|an|the)\b|$)/i,
  ]);
  if (explicit && !GENERIC_CUSTOMER_RE.test(explicit) && !looksLikeEquipmentText(explicit)) {
    const explicitCandidates = buildQuoteCustomerSearchCandidates(explicit);
    const explicitLower = explicit.toLowerCase();
    return explicitCandidates.find((item) => item !== explicitLower && item.split(/\s+/).length >= 2)
      ?? stripTrailingContext(explicit);
  }

  if (GENERIC_CUSTOMER_RE.test(targetText)) return null;
  const candidates = buildQuoteCustomerSearchCandidates(targetText);
  const targetLower = targetText.toLowerCase();
  const candidate = candidates.find((item) => item !== targetLower && item.split(/\s+/).length >= 2)
    ?? candidates.find((item) => item.split(/\s+/).length >= 2)
    ?? candidates[0]
    ?? null;
  if (!candidate || GENERIC_CUSTOMER_RE.test(candidate) || looksLikeEquipmentText(candidate)) return null;
  return candidate;
}

function missingFieldsFor(structured: Omit<IronQuoteStructuredIntake, "missingFields">): IronQuoteIntakeField[] {
  return INTAKE_REQUIRED_FIELDS.filter((field) => {
    if (field === "customer") return !structured.customerText;
    if (field === "equipment") return !structured.equipmentText;
    if (field === "options") return !structured.optionsText;
    return !structured.timeframeText;
  });
}

function normalizeStructuredIntake(value: Omit<IronQuoteStructuredIntake, "missingFields">): IronQuoteStructuredIntake {
  const structured = {
    customerText: value.customerText ? cleanText(value.customerText) : null,
    equipmentText: value.equipmentText ? cleanText(value.equipmentText) : null,
    optionsText: value.optionsText ? cleanText(value.optionsText) : null,
    timeframeText: value.timeframeText ? cleanText(value.timeframeText) : null,
    applicationText: value.applicationText ? cleanText(value.applicationText) : null,
  };
  return {
    ...structured,
    missingFields: missingFieldsFor(structured),
  };
}

export function buildQuoteCustomerSearchCandidates(targetText: string): string[] {
  const words = wordsOf(targetText);
  const candidates: string[] = [];
  const seen = new Set<string>();

  addCandidate(candidates, seen, candidateFromWords(words));

  const tailIndex = words.findIndex((word) => WORK_TAIL_TERMS.has(word) || QUOTE_EQUIPMENT_TERMS.has(word));
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

export function extractIronQuoteStructuredIntake(text: string, targetText = extractTargetText(text)): IronQuoteStructuredIntake {
  const rawText = cleanText(text);
  const equipmentText = extractEquipmentText(rawText);
  const optionsText = extractOptionsText(rawText);
  const timeframeText = extractTimeframeText(rawText);
  const applicationText = extractApplicationText(rawText);
  const customerText = extractCustomerText(rawText, targetText);

  return normalizeStructuredIntake({
    customerText,
    equipmentText,
    optionsText,
    timeframeText,
    applicationText,
  });
}

function targetTextForStructured(structured: IronQuoteStructuredIntake, fallback: string): string {
  return [
    structured.customerText,
    structured.applicationText ? `for ${structured.applicationText}` : null,
    structured.equipmentText ? `equipment ${structured.equipmentText}` : null,
    structured.optionsText ? `options ${structured.optionsText}` : null,
    structured.timeframeText ? `timeframe ${structured.timeframeText}` : null,
  ].filter(Boolean).join(" · ") || fallback;
}

function candidatesForStructured(structured: IronQuoteStructuredIntake, fallbackTarget: string): string[] {
  if (structured.customerText) return buildQuoteCustomerSearchCandidates(structured.customerText);
  return buildQuoteCustomerSearchCandidates(fallbackTarget);
}

export function isIronQuoteIntakeReady(intent: IronQuoteIntakeIntent): boolean {
  return intent.structuredIntake.missingFields.length === 0;
}

export function buildIronQuoteIntakeQuestion(intent: IronQuoteIntakeIntent): string {
  const structured = intent.structuredIntake;
  const context = [
    structured.customerText ? `customer: ${structured.customerText}` : null,
    structured.applicationText ? `job: ${structured.applicationText}` : null,
    structured.equipmentText ? `equipment: ${structured.equipmentText}` : null,
  ].filter(Boolean).join("; ");
  const prefix = context ? `Got it (${context}). ` : "Got it — I can start that quote. ";
  const missing = new Set(structured.missingFields);

  if (missing.has("customer") && missing.has("equipment")) {
    return `${prefix}Who is the customer/company, and what equipment or attachment are we quoting? Include options and timeframe if you know them.`;
  }
  if (missing.has("customer")) {
    return `${prefix}What customer or company should I attach this quote to?`;
  }
  if (missing.has("equipment")) {
    return `${prefix}What machine, attachment, or package are we quoting? Include must-have options and timeframe if you know them.`;
  }
  if (missing.has("options") && missing.has("timeframe")) {
    return `${prefix}Any options, attachments, or accessories, and what target timeframe should I carry into the quote?`;
  }
  if (missing.has("options")) {
    return `${prefix}Any options, attachments, or accessories to include? Say “none” if it is a standard setup.`;
  }
  return `${prefix}What target timeframe should I carry into the quote?`;
}

export function mergeIronQuoteIntakeIntent(
  existing: IronQuoteIntakeIntent,
  answerText: string,
): IronQuoteIntakeIntent {
  const cleanedAnswer = cleanText(answerText);
  const parsed = extractIronQuoteStructuredIntake(cleanedAnswer, cleanedAnswer);
  const existingMissing = new Set(existing.structuredIntake.missingFields);

  const fallbackEquipment = existingMissing.has("equipment") && !parsed.equipmentText && !parsed.customerText
    ? stripTrailingContext(cleanedAnswer.replace(/\b(?:no|none|not\s+sure|unknown|tbd)\b[\s\S]*$/i, ""))
    : null;

  const structured = normalizeStructuredIntake({
    customerText: existing.structuredIntake.customerText ?? parsed.customerText,
    equipmentText: existing.structuredIntake.equipmentText ?? parsed.equipmentText ?? (fallbackEquipment && looksLikeEquipmentText(fallbackEquipment) ? fallbackEquipment : null),
    optionsText: existing.structuredIntake.optionsText ?? parsed.optionsText,
    timeframeText: existing.structuredIntake.timeframeText ?? parsed.timeframeText,
    applicationText: existing.structuredIntake.applicationText ?? parsed.applicationText,
  });
  const targetText = targetTextForStructured(structured, existing.targetText);

  return {
    ...existing,
    rawText: [existing.rawText, cleanedAnswer].filter(Boolean).join("\n"),
    targetText,
    customerSearchCandidates: candidatesForStructured(structured, targetText),
    structuredIntake: structured,
  };
}

export function extractIronQuoteIntakeIntent(text: string): IronQuoteIntakeIntent | null {
  const rawText = cleanText(text);
  if (rawText.length < 3) return null;
  if (!hasQuoteCreationIntent(rawText)) return null;

  const targetText = extractTargetText(rawText);
  const structuredIntake = extractIronQuoteStructuredIntake(rawText, targetText);
  const customerSearchCandidates = candidatesForStructured(structuredIntake, targetText);
  const confidence = /\b(?:start|build|create|open|draft|prepare|put\s+together|quote)\b/i.test(rawText)
    ? "high"
    : "medium";

  return {
    rawText,
    targetText,
    customerSearchCandidates,
    confidence,
    structuredIntake,
  };
}
