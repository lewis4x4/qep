import type { CustomerMatchResult } from "./voice-customer-matcher";
import type { RepCustomer } from "./types";

/**
 * Render branches for the voice-capture customer block. Order matters — the
 * SmartVoiceCapture review screen renders the first matching branch.
 *
 * - `phase2_auto_attach`: workspace-wide semantic match cleared the 0.9 bar
 *   and was auto-attached. UI shows the auto-attach card with Undo.
 * - `selected`: rep has a customer attached (manual pick OR rep-book auto
 *   accept OR preset). UI shows the normal selected-customer card.
 * - `workspace_candidates`: no rep-book match, but the workspace search
 *   returned candidates the rep can tap.
 * - `book_alternates`: low-confidence rep-book match with at least one
 *   alternate to show. UI shows the "Not sure" disambiguation block.
 * - `empty`: nothing detected anywhere — UI shows the empty state with a
 *   "Find a customer" button.
 */
export type CustomerBlockBranch =
  | "phase2_auto_attach"
  | "selected"
  | "workspace_candidates"
  | "book_alternates"
  | "empty";

export interface CustomerBlockStateInput {
  selectedCustomer: { id: string; name: string } | null;
  autoAttachedSimilarity: number | null;
  workspaceCandidates: RepCustomer[];
  matchResult: CustomerMatchResult | null;
}

/**
 * Pure resolver — returns which render branch the customer block should
 * render given the current state. Extracted from SmartVoiceCapture so the
 * five-branch decision can be unit-tested in isolation.
 *
 * The branch order is intentional: Phase-2 auto-attach wins over normal
 * selection because it carries the "Undo" affordance the rep needs to
 * reverse the auto-attach; everything else cascades from most-specific
 * to least.
 */
export function resolveCustomerBlockBranch(
  input: CustomerBlockStateInput,
): CustomerBlockBranch {
  const { selectedCustomer, autoAttachedSimilarity, workspaceCandidates, matchResult } = input;

  if (autoAttachedSimilarity !== null && selectedCustomer) {
    return "phase2_auto_attach";
  }
  if (selectedCustomer) {
    return "selected";
  }
  if (workspaceCandidates.length > 0) {
    return "workspace_candidates";
  }
  if (matchResult && (matchResult.top !== null || matchResult.alternates.length > 0)) {
    return "book_alternates";
  }
  return "empty";
}

export interface Phase2AutoAttachPick {
  customer: RepCustomer;
  similarity: number;
}

/**
 * Pick the best Phase 2 auto-attach candidate from a workspace-search
 * result set. Returns the candidate with the highest cosine similarity in
 * the semantic map AT OR ABOVE `threshold` (default 0.9), or null when no
 * candidate clears the bar.
 *
 * The 0.9 floor is intentionally high — auto-attaching a workspace company
 * the rep didn't pick is irreversible from the rep's perspective without
 * the Undo affordance, so we want strong confidence the semantic vector
 * really points at the spoken name.
 */
export function pickPhase2AutoAttach(
  workspaceCandidates: RepCustomer[],
  semanticMap: Map<string, number> | null | undefined,
  threshold = 0.9,
): Phase2AutoAttachPick | null {
  if (!semanticMap || semanticMap.size === 0) return null;
  if (workspaceCandidates.length === 0) return null;

  let best: Phase2AutoAttachPick | null = null;
  for (const candidate of workspaceCandidates) {
    const sim = semanticMap.get(candidate.customer_id);
    if (typeof sim !== "number") continue;
    if (sim < threshold) continue;
    if (!best || sim > best.similarity) {
      best = { customer: candidate, similarity: sim };
    }
  }
  return best;
}
