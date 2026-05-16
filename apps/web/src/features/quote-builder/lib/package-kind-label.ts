// Single-source plural label for a quote package catalog kind.
//
// Extracted from `QuoteBuilderV2Page.tsx` as part of PR 12 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence so
// the new `steps/ConfigureStep.tsx` and any other consumer share one
// definition.

import type { QuotePackageCatalogKind } from "./quote-api";

export function packageKindLabel(kind: QuotePackageCatalogKind): string {
  if (kind === "attachment") return "attachments";
  if (kind === "option") return "options";
  if (kind === "accessory") return "accessories";
  if (kind === "part") return "parts";
  return "warranty";
}
