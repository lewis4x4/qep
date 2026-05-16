// USD currency formatter for the quote-builder feature.
//
// Extracted from `QuoteBuilderV2Page.tsx` as part of PR 12 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence so
// `steps/ConfigureStep.tsx` (and the rest of the wizard's step bodies
// as they extract) can import a single definition. The page still
// re-exports for legacy call sites.

export function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
