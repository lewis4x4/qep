import type { RepPipelineDeal } from "./types";

export type InsightFilterKey =
  | "at_risk"
  | "closing_soon"
  | "hot_to_push"
  | "no_next_step";

const DAY_MS = 86_400_000;
const TERMINAL_STAGES = new Set([
  "won",
  "lost",
  "closed_won",
  "closed_lost",
]);

function normalizeStage(stage: string): string {
  return stage.toLowerCase().replace(/\s+/g, "_");
}

/** True when a deal is cooling or stalled 14d+. */
export function isAtRisk(deal: RepPipelineDeal): boolean {
  return (
    deal.heat_status === "cold" || (deal.days_since_activity ?? 0) >= 14
  );
}

/** True when expected close is within the next 7 days (inclusive). */
export function isClosingSoon(deal: RepPipelineDeal, now: number = Date.now()): boolean {
  if (!deal.expected_close_on) return false;
  const days = Math.ceil(
    (new Date(deal.expected_close_on).getTime() - now) / DAY_MS,
  );
  return days >= 0 && days <= 7;
}

/** True when deal is warm AND active in the last 5 days. */
export function isHotToPush(deal: RepPipelineDeal): boolean {
  return (
    deal.heat_status === "warm" && (deal.days_since_activity ?? 99) < 5
  );
}

/** True when no follow-up is scheduled and the deal isn't terminal. */
export function hasNoNextStep(deal: RepPipelineDeal): boolean {
  return (
    !deal.next_follow_up_at &&
    !TERMINAL_STAGES.has(normalizeStage(deal.stage))
  );
}

const PREDICATES: Record<
  InsightFilterKey,
  (deal: RepPipelineDeal) => boolean
> = {
  at_risk: isAtRisk,
  closing_soon: (d) => isClosingSoon(d),
  hot_to_push: isHotToPush,
  no_next_step: hasNoNextStep,
};

export function filterDealsByInsight(
  deals: RepPipelineDeal[],
  key: InsightFilterKey,
): RepPipelineDeal[] {
  return deals.filter(PREDICATES[key]);
}

export const INSIGHT_LABELS: Record<InsightFilterKey, string> = {
  at_risk: "At Risk",
  closing_soon: "Closing 7d",
  hot_to_push: "Hot to Push",
  no_next_step: "No Next Step",
};
