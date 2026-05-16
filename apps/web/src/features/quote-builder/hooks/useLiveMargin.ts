// QRM Quote Builder — live margin / totals derivation hook.
//
// Introduced as PR 5 of the IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15
// strangler-fig sequence. Closes the audit residual: the spec named
// `useLiveMargin.ts` as a Cluster A artifact but the page never extracted
// the call. Behavior is unchanged — this is a thin, named seam over
// `computeQuoteWorkspace` so future per-step extractions (PR 14 PricingStep,
// PR 18 ReviewStep) and tests can depend on a single import path.
//
// Why pass `draft` explicitly instead of reading from `useWizard()`:
// `QuoteBuilderV2Page` is itself the component that constructs the
// `WizardStateValue` before its JSX wraps in `<WizardStateProvider>`.
// During the page's render its own body is **above** the provider in
// the React tree, so `useWizard()` from there would throw. Step
// components in PRs 10–20 live inside the provider and can do:
//
//     const { draft } = useWizard();
//     const computed = useLiveMargin(draft);
//
// The thin pure wrapper `computeLiveMargin` is exported for unit tests
// and non-React callers (e.g. node-side regression suites) that want
// the same single import path without pulling React into scope.

import { useMemo } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  computeQuoteWorkspace,
  type QuoteWorkspaceComputed,
} from "../lib/quote-workspace";

/**
 * Pure delegate to `computeQuoteWorkspace`. Lives in this module so the
 * margin-focused name (`computeLiveMargin`) can be the single import for
 * tests and step-level callers that don't need a hook.
 */
export function computeLiveMargin(draft: QuoteWorkspaceDraft): QuoteWorkspaceComputed {
  return computeQuoteWorkspace(draft);
}

/**
 * Live margin / totals for the current wizard draft, memoized on the draft
 * reference. Returns the full `QuoteWorkspaceComputed` shape (including
 * `marginPct`, `marginAmount`, `dealerCost`, `netTotal`, `approvalState`,
 * etc.) so callers can destructure exactly the fields they need.
 *
 * Memoization win: the page re-renders for many reasons that don't change
 * the draft (autosave state ticks, query refetches, modal opens). With
 * `useMemo([draft])` the result reference is stable across those renders,
 * which keeps downstream `useMemo` blocks (win-probability scorer,
 * win-probability factor inputs) from invalidating unnecessarily.
 */
export function useLiveMargin(draft: QuoteWorkspaceDraft): QuoteWorkspaceComputed {
  return useMemo(() => computeLiveMargin(draft), [draft]);
}

export type { QuoteWorkspaceComputed } from "../lib/quote-workspace";
