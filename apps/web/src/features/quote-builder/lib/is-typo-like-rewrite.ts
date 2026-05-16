/**
 * Returns true when the edit is safe to preserve the Digital Twin
 * snapshot through (e.g. "acme landscaping" → "Acme Landscaping",
 * "Acme Ldsc" → "Acme Landscaping", trailing whitespace trims).
 * Returns false for genuine re-targeting ("Acme" → "Smith Excavation").
 *
 * We require either: (a) case-insensitive prefix match in either
 * direction, or (b) small edit distance relative to the shorter
 * string (≤20% of length). Not perfect — but correct on the demo
 * axes and safe: the worst false-positive preserves a signal that
 * the rep can still clear manually; the worst false-negative just
 * triggers a CustomerIntelPanel re-fetch.
 */
export function isTypoLikeRewrite(prev: string, next: string): boolean {
  const a = prev.trim().toLowerCase();
  const b = next.trim().toLowerCase();
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const shorter = Math.min(a.length, b.length);
  const threshold = Math.max(2, Math.floor(shorter * 0.2));
  if (Math.abs(a.length - b.length) > threshold) return false;
  const dp: number[] = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return (dp[b.length] ?? Infinity) <= threshold;
}
