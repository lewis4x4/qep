/**
 * Factor Verdicts — Slice 20i.
 *
 * The instrumentation arc (20e → 20h) measured the scorer against
 * reality retrospectively. Slice 20i closes the loop by pulling those
 * findings back into the live rep flow: as a rep builds a quote, each
 * factor in the Win-Probability Strip gets a tiny badge indicating
 * whether the factor is historically *proven* (scorer's sign agrees
 * with observed lift), *suspect* (scorer disagrees with reality), or
 * *unknown* (not enough data to call it).
 *
 * Rep-safety: verdicts carry only the ternary status, never the
 * numeric win rates or sample counts. That's why this lives in a
 * separate module — the edge endpoint that emits verdicts is
 * rep-accessible, whereas /factor-attribution (the full report) is
 * manager/owner-only.
 *
 * Pure functions — no I/O. The edge function runs the full
 * `computeFactorAttribution`, reduces to verdicts with
 * `computeFactorVerdicts`, and ships the verdict map to the client.
 *
 * Label-drift contract: verdicts are matched to the live scorer by
 * factor *label*. Any non-cosmetic change to a factor's label string
 * (`win-probability-scorer.ts`) MUST bump `weightsVersion` — otherwise
 * old snapshots stop matching new live labels and the badges silently
 * vanish until enough new closed deals accumulate under the new
 * weightsVersion. The edge endpoint filters by `weightsVersion === "v1"`
 * and will skip any rows that don't match; the client strip renders
 * without badges when no verdict is found, which is graceful but
 * invisible. Bump the version and the arc re-populates naturally.
 */

import type { FactorAttribution } from "./factor-attribution";
import { isFactorSurprising } from "./factor-attribution";

/** The three possible verdicts a factor can hold at render time. */
export type FactorVerdict = "proven" | "suspect" | "unknown";

/**
 * Minimum shared confidence for a factor to get a non-`unknown` call.
 * Mirrors factor-attribution's per-side threshold (3 obs per side)
 * plus a requirement that the factor's lift isn't null. Keeps the
 * verdict surface honest: we don't stamp "proven" on a factor we
 * haven't actually observed both sides of.
 */
function hasEnoughSignal(f: FactorAttribution): boolean {
  if (f.lowConfidence) return false;
  if (f.lift === null) return false;
  return true;
}

/**
 * Compute a single factor's verdict. Rules:
 *   - lowConfidence or null lift → unknown
 *   - isFactorSurprising === true → suspect (scorer disagrees with reality)
 *   - otherwise (enough signal, sign agrees) → proven
 */
export function verdictFor(f: FactorAttribution): FactorVerdict {
  if (!hasEnoughSignal(f)) return "unknown";
  if (isFactorSurprising(f)) return "suspect";
  return "proven";
}

/**
 * Reduce a full attribution report to a label → verdict map. This is
 * what the edge endpoint serializes and ships to reps.
 */
export function computeFactorVerdicts(
  factors: FactorAttribution[],
): Map<string, FactorVerdict> {
  const out = new Map<string, FactorVerdict>();
  for (const f of factors) {
    if (typeof f.label !== "string" || f.label.length === 0) continue;
    out.set(f.label, verdictFor(f));
  }
  return out;
}

/**
 * Serialize the map to the wire shape. Plain object would lose order
 * but order doesn't matter here — the client keys by label at render.
 * An array keeps the shape JSON-safe without Map shenanigans.
 */
export function verdictsToWire(
  verdicts: Map<string, FactorVerdict>,
): Array<{ label: string; verdict: FactorVerdict }> {
  return Array.from(verdicts.entries()).map(([label, verdict]) => ({
    label,
    verdict,
  }));
}

/**
 * Parse the wire shape back into a Map. Defensive — drops rows with
 * missing or unrecognized verdict values so a malformed server
 * response can't break the strip.
 */
export function verdictsFromWire(
  wire: unknown,
): Map<string, FactorVerdict> {
  const out = new Map<string, FactorVerdict>();
  if (!Array.isArray(wire)) return out;
  for (const row of wire) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { label?: unknown; verdict?: unknown };
    if (typeof rec.label !== "string" || rec.label.length === 0) continue;
    if (rec.verdict !== "proven" && rec.verdict !== "suspect" && rec.verdict !== "unknown") {
      continue;
    }
    out.set(rec.label, rec.verdict);
  }
  return out;
}
