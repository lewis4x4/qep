import type { RepCustomer } from "./types";

export interface CustomerMatchCandidate {
  customer: RepCustomer;
  score: number;
  signals: SignalHit[];
}

export interface CustomerMatchResult {
  /** Best-matched customer, or null when no candidate scored above zero. */
  top: RepCustomer | null;
  /** 0–1. ≥0.7 = auto-accept; <0.7 = present alternates and let the rep pick. */
  confidence: number;
  /** One-line reasoning surfaced to the rep — multi-clause when multiple signals fired. */
  reasoning: string;
  /** Structured signal breakdown — UI can re-render as chips later. */
  signals: SignalHit[];
  /** Top alternates (excluding the winner) for the disambiguation UI. */
  alternates: CustomerMatchCandidate[];
}

export interface ExtractedMatchSignals {
  /** AI-extracted customer/company name mentions. */
  customer_mentions?: string[];
  /** AI-extracted person/contact name mentions. */
  contact_mentions?: string[];
  /** AI-extracted phone number mentions, ideally pre-normalized to digits-only. */
  phone_mentions?: string[];
  /** AI-extracted location mentions (cities, regions). */
  location_mentions?: string[];
  /** AI-extracted equipment phrases ("5T forklift", "Yanmar ViO 55"). */
  equipment_mentioned?: string[];
}

export interface MatcherOptions {
  /** Signals from the AI extraction pass; trigger a richer second-pass match. */
  extracted?: ExtractedMatchSignals;
  /**
   * pgvector cosine results — map of customer_id → cosine similarity in [0,1].
   * Folded into the score when similarity ≥ 0.7. Empty/absent map = no-op lane.
   */
  semantic?: Map<string, number>;
}

export type SignalKind =
  | "company_name"
  | "company_phrase"
  | "alias"
  | "contact_name"
  | "city"
  | "state"
  | "ai_customer"
  | "ai_contact"
  | "ai_phone"
  | "ai_location"
  | "ai_equipment"
  | "semantic";

export interface SignalHit {
  kind: SignalKind;
  /** Human-readable phrase that fired ("Beacon", "Frank Acres", "555-1212"). */
  phrase: string;
  /** How many times the phrase matched. */
  count: number;
  /** Score this signal contributed before the recency multiplier. */
  weight: number;
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

/** Single-signal weights — accumulated per customer per matched phrase. */
const W = {
  company_token: 1.0,
  company_phrase: 2.0,
  alias_token: 1.5,
  contact_first: 2.5,
  contact_last: 2.5,
  contact_full: 4.0,
  city: 1.0,
  state: 1.0,
  ai_customer_token: 1.5,
  ai_contact_full: 2.5,
  ai_phone_exact: 5.0,
  ai_location_token: 1.5,
  ai_equipment: 3.0,
  /** Slice B — pgvector cosine. Applied to max(0, similarity − 0.7). */
  semantic: 2.0,
} as const;

/**
 * Equipment-vocabulary stopwords. We deliberately KEEP class words like
 * "forklift" or "excavator" — those carry signal even though `nameTokens`
 * would strip them as generic. We only drop filler that adds no value to
 * a fleet-row token bag.
 */
const EQUIPMENT_STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "in",
  "to",
  "at",
  "by",
  "with",
  "a",
  "an",
  "on",
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

function equipmentTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/[\s,\-\.\/]+/)
    .filter((token) => token.length >= 2 && !EQUIPMENT_STOPWORDS.has(token));
}

function firstDisplayWord(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.replace(/[^a-zA-Z0-9]/g, "");
}

function countMatches(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  return m ? m.length : 0;
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\D+/g, "").replace(/^1(?=\d{10}$)/, "");
}

function parseContactName(name: string | null): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/** Compute the recency multiplier from a customer's days_since_contact. */
function recencyMultiplier(daysSinceContact: number | null | undefined): number {
  if (daysSinceContact == null || daysSinceContact < 0) return 1;
  if (daysSinceContact <= 7) return 1.3;
  if (daysSinceContact <= 30) return 1.15;
  return 1;
}

interface SignalAccumulator {
  hits: SignalHit[];
  rawScore: number;
}

interface EquipmentPhraseHit {
  /** Reasoning label e.g. "Yanmar ViO 55" or "forklift". */
  label: string;
}

/**
 * Check whether a single fleet row matches an equipment phrase.
 * Hit when at least 2 tokens overlap OR when the fleet's `model` appears as a
 * substring in the phrase (case-insensitive).
 */
function fleetRowMatchesPhrase(
  row: { make: string | null; model: string | null; category: string | null; name: string | null },
  phrase: string,
  phraseTokens: Set<string>,
  phraseLower: string,
): EquipmentPhraseHit | null {
  const modelLower = row.model?.toLowerCase().trim() ?? "";
  if (modelLower.length >= 2 && phraseLower.includes(modelLower)) {
    const label = [row.make, row.model].filter(Boolean).join(" ").trim();
    return { label: label || row.category || row.name || "equipment" };
  }

  const rowTokens = new Set<string>();
  for (const field of [row.make, row.model, row.category, row.name]) {
    for (const token of equipmentTokens(field)) rowTokens.add(token);
  }
  let overlap = 0;
  for (const token of rowTokens) {
    if (phraseTokens.has(token)) overlap += 1;
    if (overlap >= 2) break;
  }
  if (overlap >= 2) {
    const label = [row.make, row.model].filter(Boolean).join(" ").trim()
      || row.category
      || row.name
      || "equipment";
    return { label };
  }
  return null;
}

/**
 * For each phrase, find at most ONE matching fleet row per customer.
 * Returns the per-customer match (or null if no row matched).
 */
function findEquipmentHit(
  customer: RepCustomer,
  phrase: string,
): EquipmentPhraseHit | null {
  if (!customer.equipment_summary?.length) return null;
  const phraseLower = phrase.toLowerCase();
  const phraseTokens = new Set(equipmentTokens(phrase));
  if (phraseTokens.size === 0 && phraseLower.length < 2) return null;

  for (const row of customer.equipment_summary) {
    const hit = fleetRowMatchesPhrase(row, phrase, phraseTokens, phraseLower);
    if (hit) return hit;
  }
  return null;
}

/**
 * Per-phrase damping factor. Generic phrases that match many customers in the
 * rep's book carry less signal — divide weight by sqrt(N) when N >= 3 so a
 * "forklift" mention against 5 customers stops dominating.
 */
function buildEquipmentDampingMap(
  customers: RepCustomer[],
  phrases: string[],
): Map<string, number> {
  const damping = new Map<string, number>();
  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    let matchingCustomers = 0;
    for (const customer of customers) {
      if (findEquipmentHit(customer, trimmed)) matchingCustomers += 1;
    }
    const factor = matchingCustomers >= 3 ? 1 / Math.sqrt(matchingCustomers) : 1;
    damping.set(trimmed, factor);
  }
  return damping;
}

function addSignal(
  acc: SignalAccumulator,
  kind: SignalKind,
  phrase: string,
  count: number,
  perHitWeight: number,
): void {
  if (count <= 0) return;
  const weight = count * perHitWeight;
  acc.hits.push({ kind, phrase, count, weight });
  acc.rawScore += weight;
}

function scoreCustomer(
  customer: RepCustomer,
  transcriptLower: string,
  extracted: ExtractedMatchSignals | undefined,
  equipmentDamping: Map<string, number> | null,
  semantic: Map<string, number> | undefined,
): { signals: SignalHit[]; score: number } {
  const acc: SignalAccumulator = { hits: [], rawScore: 0 };

  // ── Lane 1: company_name tokens + phrase ─────────────────────
  const companyTokens = nameTokens(customer.company_name);
  for (const token of companyTokens) {
    const count = countMatches(transcriptLower, new RegExp(`\\b${escapeRegex(token)}\\b`, "g"));
    addSignal(acc, "company_name", token, count, W.company_token);
  }
  if (companyTokens.length > 1) {
    const phrase = companyTokens.join("\\s+");
    const phraseCount = countMatches(transcriptLower, new RegExp(`\\b${phrase}\\b`, "g"));
    addSignal(acc, "company_phrase", companyTokens.join(" "), phraseCount, W.company_phrase);
  }

  // ── Lane 2: search aliases (search_1, search_2) ──────────────
  for (const alias of [customer.search_1, customer.search_2]) {
    if (!alias) continue;
    const aliasTokens = nameTokens(alias);
    for (const token of aliasTokens) {
      const count = countMatches(transcriptLower, new RegExp(`\\b${escapeRegex(token)}\\b`, "g"));
      addSignal(acc, "alias", token, count, W.alias_token);
    }
  }

  // ── Lane 3: primary contact name (first / last / full) ───────
  const { first, last } = parseContactName(customer.primary_contact_name);
  if (first && first.length >= 3) {
    const count = countMatches(
      transcriptLower,
      new RegExp(`\\b${escapeRegex(first.toLowerCase())}\\b`, "g"),
    );
    addSignal(acc, "contact_name", first, count, W.contact_first);
  }
  if (last && last.length >= 3 && last.toLowerCase() !== first?.toLowerCase()) {
    const count = countMatches(
      transcriptLower,
      new RegExp(`\\b${escapeRegex(last.toLowerCase())}\\b`, "g"),
    );
    addSignal(acc, "contact_name", last, count, W.contact_last);
  }
  if (first && last) {
    const full = `${first.toLowerCase()}\\s+${last.toLowerCase()}`;
    const count = countMatches(transcriptLower, new RegExp(`\\b${full}\\b`, "g"));
    addSignal(
      acc,
      "contact_name",
      `${first} ${last}`,
      count,
      W.contact_full - (W.contact_first + W.contact_last),
    );
  }

  // ── Lane 4: city / state (only when the customer has them) ───
  if (customer.city) {
    const city = customer.city.toLowerCase();
    if (city.length >= 3) {
      const count = countMatches(transcriptLower, new RegExp(`\\b${escapeRegex(city)}\\b`, "g"));
      addSignal(acc, "city", customer.city, count, W.city);
    }
  }
  if (customer.state) {
    const st = customer.state.toLowerCase();
    if (st.length >= 2 && st.length <= 3) {
      const count = countMatches(transcriptLower, new RegExp(`\\b${escapeRegex(st)}\\b`, "g"));
      addSignal(acc, "state", customer.state, count, W.state);
    }
  }

  // ── Lane 5: AI-extracted customer_mentions ───────────────────
  if (extracted?.customer_mentions?.length) {
    const corpus = [
      customer.company_name,
      customer.search_1 ?? "",
      customer.search_2 ?? "",
    ]
      .map((s) => s.toLowerCase())
      .join(" ");
    for (const mention of extracted.customer_mentions) {
      const mentionTokens = nameTokens(mention);
      let hits = 0;
      for (const token of mentionTokens) {
        if (corpus.includes(token)) hits += 1;
      }
      if (hits > 0) {
        addSignal(acc, "ai_customer", mention, hits, W.ai_customer_token);
      }
    }
  }

  // ── Lane 6: AI-extracted contact_mentions vs primary_contact_name ─
  if (extracted?.contact_mentions?.length && customer.primary_contact_name) {
    const primary = customer.primary_contact_name.toLowerCase();
    for (const mention of extracted.contact_mentions) {
      const mLower = mention.toLowerCase().trim();
      if (!mLower) continue;
      // Full-name overlap: any token in mention also appears in primary.
      const tokens = mLower.split(/\s+/).filter((t) => t.length >= 3);
      const hit = tokens.some((t) => primary.includes(t));
      if (hit) addSignal(acc, "ai_contact", mention, 1, W.ai_contact_full);
    }
  }

  // ── Lane 7: AI-extracted phone_mentions exact match ──────────
  if (extracted?.phone_mentions?.length && customer.primary_contact_phone) {
    const primaryPhone = normalizePhone(customer.primary_contact_phone);
    if (primaryPhone) {
      for (const mention of extracted.phone_mentions) {
        if (normalizePhone(mention) === primaryPhone) {
          addSignal(acc, "ai_phone", mention, 1, W.ai_phone_exact);
        }
      }
    }
  }

  // ── Lane 8: AI-extracted location_mentions vs city/state ─────
  if (extracted?.location_mentions?.length) {
    const cityLower = customer.city?.toLowerCase() ?? "";
    const stateLower = customer.state?.toLowerCase() ?? "";
    for (const mention of extracted.location_mentions) {
      const mLower = mention.toLowerCase();
      if (cityLower && mLower.includes(cityLower)) {
        addSignal(acc, "ai_location", mention, 1, W.ai_location_token);
      } else if (stateLower && mLower.includes(stateLower)) {
        addSignal(acc, "ai_location", mention, 1, W.ai_location_token);
      }
    }
  }

  // ── Lane 9: AI-extracted equipment_mentioned vs owned fleet ──
  if (extracted?.equipment_mentioned?.length && customer.equipment_summary?.length) {
    const seen = new Set<string>();
    for (const rawPhrase of extracted.equipment_mentioned) {
      const phrase = rawPhrase.trim();
      if (!phrase || seen.has(phrase)) continue;
      seen.add(phrase);
      const hit = findEquipmentHit(customer, phrase);
      if (!hit) continue;
      const damping = equipmentDamping?.get(phrase) ?? 1;
      addSignal(acc, "ai_equipment", hit.label, 1, W.ai_equipment * damping);
    }
  }

  // ── Lane 10: pgvector semantic similarity (Slice B) ──────────
  // Cosine score lives in [-1, 1]; we only fold in hits ≥ 0.7 so paraphrase
  // matches need to be meaningfully close before they sway the rank. The
  // delta-from-threshold weighting (2.0 * (s − 0.7)) means a 0.7 just-on-
  // the-line hit contributes nothing, while a 0.9 confident match adds 0.4.
  if (semantic) {
    const sim = semantic.get(customer.customer_id);
    if (typeof sim === "number" && sim >= 0.7) {
      const weight = W.semantic * Math.max(0, sim - 0.7);
      if (weight > 0) addSignal(acc, "semantic", `semantic match (${sim.toFixed(2)})`, 1, weight);
    }
  }

  // ── Apply recency multiplier ─────────────────────────────────
  const recency = recencyMultiplier(customer.days_since_contact);
  const score = acc.rawScore * recency;
  return { signals: acc.hits, score };
}

function buildReasoning(signals: SignalHit[], customer: RepCustomer): string {
  if (signals.length === 0) return "No matching signals.";

  const clauses: string[] = [];
  const nameHits = signals.filter((s) => s.kind === "company_name" || s.kind === "company_phrase" || s.kind === "alias");
  if (nameHits.length > 0) {
    const top = nameHits.reduce((a, b) => (b.count > a.count ? b : a));
    // Prefer the original company-name capitalization for display ("Beacon"
    // not "beacon") since we lowercased the transcript for matching.
    const word = firstDisplayWord(customer.company_name);
    clauses.push(top.count === 1 ? `Heard "${word}"` : `Heard "${word}" ${top.count}×`);
  }

  const contact = signals.find((s) => s.kind === "contact_name" || s.kind === "ai_contact");
  if (contact) {
    clauses.push(`${contact.phrase} (primary contact)`);
  }

  const phone = signals.find((s) => s.kind === "ai_phone");
  if (phone) clauses.push("phone matches");

  const loc = signals.find((s) => s.kind === "city" || s.kind === "state" || s.kind === "ai_location");
  if (loc) clauses.push(`location matches ${loc.phrase}`);

  const equipment = signals.find((s) => s.kind === "ai_equipment");
  if (equipment) clauses.push(`owns matching ${equipment.phrase}`);

  const semantic = signals.find((s) => s.kind === "semantic");
  if (semantic) {
    // Pull the cosine value back out of the phrase ("semantic match (0.82)").
    const m = semantic.phrase.match(/\(([0-9.]+)\)/);
    const sim = m ? Number(m[1]) : null;
    clauses.push(sim != null ? `matches by meaning (${sim.toFixed(2)})` : "matches by meaning");
  }

  const recency = recencyMultiplier(customer.days_since_contact);
  if (recency > 1 && customer.days_since_contact != null) {
    clauses.push(`active ${customer.days_since_contact}d ago`);
  }

  return clauses.join(" · ") + ".";
}

export function matchCustomerInTranscript(
  transcript: string,
  customers: RepCustomer[],
  options: MatcherOptions = {},
): CustomerMatchResult {
  const empty: CustomerMatchResult = {
    top: null,
    confidence: 0,
    reasoning: "No customer name detected.",
    signals: [],
    alternates: [],
  };

  const haveExtraction = !!(
    options.extracted?.customer_mentions?.length ||
    options.extracted?.contact_mentions?.length ||
    options.extracted?.phone_mentions?.length ||
    options.extracted?.location_mentions?.length ||
    options.extracted?.equipment_mentioned?.length
  );
  const haveSemantic = !!(options.semantic && options.semantic.size > 0);

  if (!transcript && !haveExtraction && !haveSemantic) return empty;
  if (customers.length === 0) return empty;

  const text = (transcript ?? "").toLowerCase();

  // Pre-pass: damping for equipment phrases that match many customers.
  // Done once per call so each scoreCustomer pass sees the same factors.
  const equipmentDamping = options.extracted?.equipment_mentioned?.length
    ? buildEquipmentDampingMap(customers, options.extracted.equipment_mentioned)
    : null;

  const scored: CustomerMatchCandidate[] = customers
    .map((customer) => {
      const { signals, score } = scoreCustomer(
        customer,
        text,
        options.extracted,
        equipmentDamping,
        options.semantic,
      );
      return { customer, score, signals };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return empty;

  const winner = scored[0];
  const runnerUp = scored[1];

  // Confidence math — same conceptual scale as the original but driven
  // by the richer multi-lane score. A score of 1 is roughly one weak
  // mention; 5+ is a multi-signal pile-on.
  let confidence: number;
  if (!runnerUp) {
    confidence = winner.score <= 1 ? 0.6 : Math.min(0.95, 0.6 + (winner.score - 1) * 0.07);
  } else {
    const lead = winner.score - runnerUp.score;
    if (lead === 0) {
      confidence = 0.4;
    } else if (lead < 1) {
      confidence = winner.score >= 2 ? 0.7 : 0.5;
    } else if (lead < 2) {
      confidence = winner.score >= 2 ? 0.75 : 0.55;
    } else {
      confidence = Math.min(0.95, 0.7 + lead * 0.05);
    }
  }

  return {
    top: winner.customer,
    confidence,
    reasoning: buildReasoning(winner.signals, winner.customer),
    signals: winner.signals,
    alternates: scored.slice(1, 4),
  };
}
