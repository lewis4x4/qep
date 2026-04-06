import type { QrmRepSafeDeal, QrmWeightedDeal } from "./types";

export const DEAL_STALLED_THRESHOLD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type SignalDeal = Pick<QrmRepSafeDeal, "nextFollowUpAt" | "lastActivityAt" | "createdAt">;
type AnySignalDeal = SignalDeal | Pick<QrmWeightedDeal, "nextFollowUpAt" | "lastActivityAt" | "createdAt">;

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
