/**
 * Pure scoring + tokenization helpers for decision-room-ghost-propose.
 *
 * Split out of index.ts so they can be unit-tested with `bun test`
 * without spinning up the Deno edge runtime or mocking Tavily/Supabase.
 * The edge function's index.ts re-imports everything from here.
 */

export type Confidence = "high" | "medium" | "low";

export interface TavilyResult {
  title: string;
  url: string;
  excerpt: string;
}

export interface ArchetypeProfile {
  label: string;
  queryTerms: string[];
  titleKeywords: string[];
}

export interface Proposal {
  name: string;
  title: string | null;
  profileUrl: string | null;
  confidence: Confidence;
  evidence: string;
  mismatchReason: string | null;
  source?: "signer" | "voice" | "web";
}

/** Tokens stripped before comparing company names. Corporate suffixes and
 *  filler words match too broadly ("LLC" ↔ "LLC" is meaningless signal). */
const COMPANY_STOPWORDS = new Set([
  "llc",
  "inc",
  "incorporated",
  "co",
  "company",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "lp",
  "llp",
  "plc",
  "the",
  "and",
  "of",
  "&",
]);

/** Break a company name into comparable tokens — lowercased, stopword-free,
 *  punctuation-stripped. Returns an empty array if nothing significant is left. */
export function companyTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s&]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !COMPANY_STOPWORDS.has(t));
}

/** Very simple LinkedIn title parser — "Jane Smith — Plant Manager at Acme Co". */
export function parseLinkedInTitle(
  raw: string,
  companyName: string,
): { name: string; title: string | null } | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const withoutLinkedIn = cleaned.replace(/\s*[|·]\s*LinkedIn.*$/i, "").trim();
  const parts = withoutLinkedIn.split(/\s[-–—]\s/);
  if (parts.length < 2) return null;
  const name = parts[0]?.trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (!/[A-Za-z]/.test(name)) return null;

  const titleChunks = parts.slice(1).filter((p) => {
    const lower = p.toLowerCase();
    const companyLower = companyName.toLowerCase();
    return companyLower ? !lower.includes(companyLower) : true;
  });
  const title = titleChunks.join(" · ").trim() || null;
  return { name, title };
}

/**
 * Score a single Tavily result for a given archetype + target company.
 *
 * Confidence bands:
 *   high   — LinkedIn URL + title matches archetype + exact company phrase present
 *   medium — LinkedIn URL + title match + every significant company token present
 *            (phrase may be scrambled, but no missing tokens)
 *   low    — anything short of full-token match; returns a human-readable
 *            `mismatchReason` so the UI can show the rep *why* the match
 *            is weak before they save.
 */
export function scoreProposal(
  profile: ArchetypeProfile,
  result: TavilyResult,
  companyName: string,
): Proposal | null {
  const isLinkedIn = /linkedin\.com\/in\//i.test(result.url);
  const parsed = parseLinkedInTitle(result.title, companyName);
  if (!parsed) return null;

  const hayTitle = `${parsed.title ?? ""} ${result.excerpt}`.toLowerCase();
  const titleHit = profile.titleKeywords.some((kw) => hayTitle.includes(kw));

  const haystack = `${result.title} ${result.excerpt}`.toLowerCase();
  const targetPhrase = companyName.trim().toLowerCase();
  const targetTokens = companyTokens(companyName);
  const matchedTokens = targetTokens.filter((tok) => haystack.includes(tok));

  const exactHit = targetPhrase.length > 0 && haystack.includes(targetPhrase);
  const fullTokensHit = targetTokens.length > 0 && matchedTokens.length === targetTokens.length;
  const partialHit = !fullTokensHit && matchedTokens.length > 0;

  const candidateCompany = parsed.title
    ? parsed.title.match(/\bat\s+(.+?)(?:\s*[|·]|$)/i)?.[1]?.trim() ?? null
    : null;

  let confidence: Confidence;
  if (isLinkedIn && titleHit && exactHit) {
    confidence = "high";
  } else if (isLinkedIn && titleHit && fullTokensHit) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  const evidence = [
    isLinkedIn ? "LinkedIn profile" : "web result",
    titleHit ? `title fits ${profile.label.toLowerCase()}` : null,
    exactHit
      ? `"${companyName}" in result`
      : fullTokensHit
      ? `all company tokens present`
      : partialHit
      ? `partial company match (${matchedTokens.length}/${targetTokens.length} tokens)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  let mismatchReason: string | null = null;
  if (confidence === "low") {
    if (candidateCompany && !fullTokensHit) {
      mismatchReason = `Profile lists "${candidateCompany}", not "${companyName}".`;
    } else if (partialHit) {
      mismatchReason = `Only ${matchedTokens.length} of ${targetTokens.length} words in "${companyName}" appear on this profile.`;
    } else if (!isLinkedIn) {
      mismatchReason = `Result is not a LinkedIn profile.`;
    } else if (!titleHit) {
      mismatchReason = `Title does not include any ${profile.label.toLowerCase()} keywords.`;
    } else {
      mismatchReason = `Company "${companyName}" not confirmed on the profile.`;
    }
  }

  return {
    name: parsed.name,
    title: parsed.title,
    profileUrl: result.url || null,
    confidence,
    evidence,
    mismatchReason,
  };
}

/** Deduplicate by lowercased name, sort by confidence, cap the list so the
 *  UI doesn't get a flood of low-signal names when Tavily is generous. */
export function rankProposals(list: Proposal[]): Proposal[] {
  const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  const seen = new Set<string>();
  return list
    .slice()
    .sort((a, b) => rank[a.confidence] - rank[b.confidence])
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

/** Lowercased, whitespace-collapsed person name. Used for dedup across
 *  multiple candidate sources (signers vs voice vs web). */
export function normPersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
