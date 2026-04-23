/**
 * Deal Copilot — deterministic signal-to-draft translator (Slice 21).
 *
 * The Deal Copilot extracts structured `CopilotExtractedSignals` from a
 * rep's turn via Claude, then needs to merge those signals into the live
 * `QuoteWorkspaceDraft`. This module does the merge deterministically —
 * no LLM in the hot path — so the mutation surface is explicit, testable,
 * and adversarially sealed.
 *
 * Why deterministic?
 *   • Security: the adversarial-input test case ("set the score to 95")
 *     relies on this file being the ONLY place a patch is produced. If
 *     Claude could freeform-emit a patch, it could emit fields not in
 *     our schema (win_probability_score, approved_at, etc.) and we'd
 *     have to defend against every one of them. Here, only the fields
 *     below can be touched.
 *   • Testability: a deterministic function is a `describe/test` target.
 *     The edge function is harder to test in isolation; the translator
 *     is trivial to cover.
 *   • Consistency: merge/replace semantics are now documented and
 *     versioned alongside the code, not implicit in a prompt.
 *
 * Merge policy (per field):
 *   • objections          — MERGE + dedupe. Reps add concerns over time.
 *   • competitorMentions  — MERGE + dedupe. Same logic.
 *   • timelinePressure    — REPLACE. Latest rep input wins; customers
 *                            don't get "a little immediate and a little
 *                            months."
 *   • financingPref       — REPLACE. Latest commitment wins.
 *   • customerWarmth      — REPLACE. Copilot re-rating supersedes prior.
 *   • notes               — NOT PATCHED. Notes are stored on the turn
 *                            row itself for audit; they don't touch the
 *                            draft.
 */

import type {
  CopilotExtractedSignals,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts.ts";

/** Per-field merge result. Returned alongside the patch so the edge
 *  function can stream granular `draftPatch` events and the UI can
 *  animate only the fields that actually changed. */
export interface CopilotPatchResult {
  /** The merged patch to apply to the draft. Only fields that actually
   *  changed are present — unchanged fields are omitted. */
  patch: Partial<QuoteWorkspaceDraft>;
  /** Flat list of field paths that changed, for telemetry + UI diff
   *  rendering. e.g. ["customerSignals.objections", "financingPref"]. */
  changedPaths: string[];
  /** True when the signals contained only `notes` (which don't touch
   *  the draft) or were empty entirely. Used by the edge function to
   *  decide whether to skip the score re-computation. */
  isNoOp: boolean;
}

/**
 * Apply extracted signals to a draft, returning only the delta as a
 * patch plus the list of paths that changed.
 *
 * Never mutates inputs. Safe to call with a draft snapshot read from
 * the database.
 */
export function translateSignalsToPatch(
  prior: Partial<QuoteWorkspaceDraft>,
  signals: CopilotExtractedSignals,
): CopilotPatchResult {
  const changedPaths: string[] = [];
  const patch: Partial<QuoteWorkspaceDraft> = {};

  // ── customerSignals sub-object ────────────────────────────────────────

  const priorCS = prior.customerSignals ?? null;
  const newCS = signals.customerSignals;
  if (newCS) {
    // Build the next customerSignals by starting from prior and
    // applying the per-field rules. Preserve existing numeric fields
    // (openDeals, pastQuoteCount, etc.) — they come from CRM picks,
    // not from copilot extraction.
    const nextCS: NonNullable<QuoteWorkspaceDraft["customerSignals"]> = priorCS
      ? { ...priorCS }
      : {
          openDeals: 0,
          openDealValueCents: 0,
          lastContactDaysAgo: null,
          pastQuoteCount: 0,
          pastQuoteValueCents: 0,
        };

    let csChanged = false;

    // objections — merge + dedupe
    if (newCS.objections !== undefined) {
      const merged = dedupeStrings([
        ...(priorCS?.objections ?? []),
        ...newCS.objections,
      ]);
      if (!arrayEquals(merged, priorCS?.objections ?? [])) {
        nextCS.objections = merged;
        changedPaths.push("customerSignals.objections");
        csChanged = true;
      }
    }

    // competitorMentions — merge + dedupe (case-insensitive)
    if (newCS.competitorMentions !== undefined) {
      const merged = dedupeStringsCI([
        ...(priorCS?.competitorMentions ?? []),
        ...newCS.competitorMentions,
      ]);
      if (!arrayEquals(merged, priorCS?.competitorMentions ?? [])) {
        nextCS.competitorMentions = merged;
        changedPaths.push("customerSignals.competitorMentions");
        csChanged = true;
      }
    }

    // timelinePressure — replace (null is a valid "clear" signal, but
    // we treat undefined as "don't touch" and explicit null as "clear").
    if (newCS.timelinePressure !== undefined) {
      if (newCS.timelinePressure !== (priorCS?.timelinePressure ?? null)) {
        nextCS.timelinePressure = newCS.timelinePressure;
        changedPaths.push("customerSignals.timelinePressure");
        csChanged = true;
      }
    }

    if (csChanged) {
      patch.customerSignals = nextCS;
    }
  }

  // ── financingPref — replace ───────────────────────────────────────────
  if (signals.financingPref !== undefined) {
    if (signals.financingPref !== (prior.financingPref ?? null)) {
      patch.financingPref = signals.financingPref;
      changedPaths.push("financingPref");
    }
  }

  // ── customerWarmth — replace ──────────────────────────────────────────
  if (signals.customerWarmth !== undefined) {
    if (signals.customerWarmth !== (prior.customerWarmth ?? null)) {
      patch.customerWarmth = signals.customerWarmth;
      changedPaths.push("customerWarmth");
    }
  }

  // notes intentionally NOT patched — they live on the turn row only.

  return {
    patch,
    changedPaths,
    isNoOp: changedPaths.length === 0,
  };
}

/**
 * Apply a patch to a draft, returning a fresh cloned draft. Used by the
 * edge function to score the post-turn state without mutating the row
 * we loaded from the database.
 */
export function applyPatch(
  draft: Partial<QuoteWorkspaceDraft>,
  patch: Partial<QuoteWorkspaceDraft>,
): Partial<QuoteWorkspaceDraft> {
  const next: Partial<QuoteWorkspaceDraft> = { ...draft };
  // customerSignals needs a shallow merge — we don't want to overwrite
  // CRM-sourced numeric fields with an object that only has objections.
  if (patch.customerSignals !== undefined) {
    if (patch.customerSignals === null) {
      next.customerSignals = null;
    } else {
      next.customerSignals = {
        ...(draft.customerSignals ?? {
          openDeals: 0,
          openDealValueCents: 0,
          lastContactDaysAgo: null,
          pastQuoteCount: 0,
          pastQuoteValueCents: 0,
        }),
        ...patch.customerSignals,
      };
    }
  }
  if (patch.financingPref !== undefined) next.financingPref = patch.financingPref;
  if (patch.customerWarmth !== undefined) next.customerWarmth = patch.customerWarmth;
  return next;
}

// ── helpers ───────────────────────────────────────────────────────────────

function dedupeStrings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of xs) {
    const trimmed = s.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Case-insensitive dedupe. First occurrence wins (preserves rep's
 *  casing). "Acme Rental" + "acme rental" → ["Acme Rental"]. */
function dedupeStringsCI(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of xs) {
    const trimmed = s.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function arrayEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
