import type { RepCustomer } from "./types";

export interface CustomerMatchCandidate {
  customer: RepCustomer;
  score: number;
}

export interface CustomerMatchResult {
  /** Best-matched customer, or null when no candidate scored above zero. */
  top: RepCustomer | null;
  /** 0–1. ≥0.7 = auto-accept; <0.7 = present alternates and let the rep pick. */
  confidence: number;
  /** One-line explanation surfaced to the rep ("Heard 'Beacon' 2 times"). */
  reasoning: string;
  /** Top alternates (excluding the winner) for the disambiguation UI. */
  alternates: CustomerMatchCandidate[];
}

const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "in",
  "to",
  "at",
  "by",
  "co",
  "inc",
  "llc",
  "ltd",
  "company",
  "corp",
  "corporation",
  "construction",
  "industries",
  "group",
  "services",
  "service",
  "rental",
  "rentals",
  "equipment",
]);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s,\-\.]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function firstDisplayWord(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.replace(/[^a-zA-Z0-9]/g, "");
}

export function matchCustomerInTranscript(
  transcript: string,
  customers: RepCustomer[],
): CustomerMatchResult {
  const empty: CustomerMatchResult = {
    top: null,
    confidence: 0,
    reasoning: "No customer name detected.",
    alternates: [],
  };

  if (!transcript || customers.length === 0) {
    return empty;
  }

  const text = transcript.toLowerCase();

  const scored: CustomerMatchCandidate[] = customers
    .map((customer) => {
      const tokens = nameTokens(customer.company_name);
      if (tokens.length === 0) return { customer, score: 0 };

      let mentions = 0;

      // Token-by-token mention count.
      for (const token of tokens) {
        const regex = new RegExp(`\\b${escapeRegex(token)}\\b`, "gi");
        const matches = text.match(regex);
        if (matches) mentions += matches.length;
      }

      // Phrase match weighted higher than token-by-token.
      if (tokens.length > 1) {
        const phrase = tokens.join("\\s+");
        const phraseRegex = new RegExp(`\\b${phrase}\\b`, "gi");
        const phraseMatches = text.match(phraseRegex);
        if (phraseMatches) mentions += phraseMatches.length * 2;
      }

      return { customer, score: mentions };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return empty;
  }

  const winner = scored[0];
  const runnerUp = scored[1];

  // Confidence model:
  // - Single-mention winner with no rival: confidence 0.6
  // - 2+ mention winner with no rival: confidence 0.85
  // - 2+ mention winner with decisive lead (>= 2 over rival): confidence 0.9+
  // - Winner tied with rival: confidence 0.4 — present alternates instead.
  let confidence: number;
  if (!runnerUp) {
    confidence = winner.score === 1 ? 0.6 : Math.min(0.95, 0.6 + (winner.score - 1) * 0.15);
  } else {
    const lead = winner.score - runnerUp.score;
    if (lead === 0) {
      confidence = 0.4;
    } else if (lead === 1) {
      confidence = winner.score >= 2 ? 0.75 : 0.55;
    } else {
      confidence = Math.min(0.95, 0.7 + lead * 0.08);
    }
  }

  const firstWord = firstDisplayWord(winner.customer.company_name);
  const reasoning =
    winner.score === 1
      ? `Heard "${firstWord}" once.`
      : `Heard "${firstWord}" ${winner.score} times.`;

  return {
    top: winner.customer,
    confidence,
    reasoning,
    alternates: scored.slice(1, 4),
  };
}
