// Progressive catalog lookups for an AI-recommended machine string.
//
// The AI returns machine labels like "Case SR175 (2026)", but catalog rows
// are keyed on model_code / family / series / name_display — none of which
// contain the year. A single ilike over the full string therefore misses
// and the builder falls back to a $0 placeholder line.
//
// Expanding to a list of candidates and trying them in order lets us land
// on a real catalog row (with the real list price) whenever one exists:
//   1. the original string
//   2. the string with year tokens and parens removed
//   3. just the first two tokens (usually make + model)
//   4. just the first token (usually make)
//
// Deduplicated and trimmed so the sanitizer in searchCatalog doesn't drop
// the final query to empty.

export function buildCatalogQueryCandidates(machine: string): string[] {
  const raw = (machine ?? "").trim();
  if (!raw) return [];
  const withoutParens = raw.replace(/\([^)]*\)/g, " ").trim();
  const withoutYear = withoutParens.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
  const tokens = withoutYear.split(/\s+/).filter(Boolean);
  const candidates = new Set<string>();
  if (raw) candidates.add(raw);
  if (withoutYear && withoutYear !== raw) candidates.add(withoutYear);
  if (tokens.length >= 2) candidates.add(`${tokens[0]} ${tokens[1]}`);
  if (tokens.length >= 1) candidates.add(tokens[0]!);
  return Array.from(candidates).filter((q) => q.length >= 2);
}
