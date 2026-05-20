import type { QuoteFinanceAprSource, QuoteFinanceScenarioKind } from "../../../../../../shared/qep-moonshot-contracts";

export const APR_SOURCE_FALLBACK_LABEL = "Subject to lender approval";

export interface AprSourceScenarioLike {
  type?: "cash" | "finance" | "lease" | string | null;
  kind?: QuoteFinanceScenarioKind | string | null;
  aprSource?: QuoteFinanceAprSource | null;
}

export function isAprSourceAttributionRequired(scenario: AprSourceScenarioLike): boolean {
  return scenario.type === "finance"
    || scenario.type === "lease"
    || scenario.kind === "finance"
    || scenario.kind === "lease_fmv"
    || scenario.kind === "lease_fppo";
}

function formatAprSourceDate(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[2]}/${ymd[3]}/${ymd[1]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString("en-US");
}

export function formatAprSourceAttribution(scenario: AprSourceScenarioLike): string | null {
  if (!isAprSourceAttributionRequired(scenario)) return null;
  const label = scenario.aprSource?.label?.trim() || APR_SOURCE_FALLBACK_LABEL;
  const effective = formatAprSourceDate(scenario.aprSource?.effectiveFrom ?? null);
  return `APR source: ${label}${effective ? ` (eff. ${effective})` : ""}`;
}
