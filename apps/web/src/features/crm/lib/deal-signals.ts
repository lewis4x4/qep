import type { CrmRepSafeDeal, CrmWeightedDeal } from "./types";

export const DEAL_STALLED_THRESHOLD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type SignalDeal = Pick<CrmRepSafeDeal, "nextFollowUpAt" | "lastActivityAt" | "createdAt">;
type AnySignalDeal = SignalDeal | Pick<CrmWeightedDeal, "nextFollowUpAt" | "lastActivityAt" | "createdAt">;

function toTime(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getDealSignalState(
  deal: AnySignalDeal,
  nowTime: number = Date.now()
): { isOverdueFollowUp: boolean; isStalled: boolean } {
  const followUpTime = toTime(deal.nextFollowUpAt);
  const lastActivityTime = toTime(deal.lastActivityAt) ?? toTime(deal.createdAt);

  const isOverdueFollowUp = followUpTime !== null && followUpTime < nowTime;
  const isStalled = lastActivityTime !== null &&
    nowTime - lastActivityTime > DEAL_STALLED_THRESHOLD_DAYS * DAY_MS;

  return { isOverdueFollowUp, isStalled };
}
