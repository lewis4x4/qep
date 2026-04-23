import type { ServiceStage } from "@/features/service/lib/constants";

export type RoleHomeQuoteLike = {
  id: string;
  status: string;
};

export type RoleHomeCounterInquiryLike = {
  id: string;
  outcome: string;
};

export type PrepHomeTransitionPlan =
  | {
      kind: "noop";
      reason: "already_at_stage";
    }
  | {
      kind: "router";
      requiresBlocker: boolean;
    }
  | {
      kind: "ready_shortcut";
      requiresBlocker: false;
    };

const RESOLVED_COUNTER_OUTCOMES = new Set(["quoted", "converted", "ordered"]);

export function normalizeQuoteStatusForHome(status: string): string {
  return status === "accepted" ? "approved" : status;
}

export function groupQuotesByHomeStatus<T extends RoleHomeQuoteLike>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizeQuoteStatusForHome(row.status);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

export function isUnquotedCounterInquiry(row: RoleHomeCounterInquiryLike): boolean {
  return !RESOLVED_COUNTER_OUTCOMES.has(row.outcome);
}

export function orderCounterInquiriesForHome<T extends RoleHomeCounterInquiryLike>(rows: T[]): T[] {
  const unquoted = rows.filter(isUnquotedCounterInquiry);
  const resolved = rows.filter((row) => !isUnquotedCounterInquiry(row));
  return [...unquoted, ...resolved];
}

export function getPrepHomeTransitionPlan(
  fromStage: ServiceStage,
  toStage: ServiceStage,
): PrepHomeTransitionPlan {
  if (fromStage === toStage) return { kind: "noop", reason: "already_at_stage" };
  if (fromStage === "in_progress" && toStage === "ready_for_pickup") {
    return { kind: "ready_shortcut", requiresBlocker: false };
  }
  return { kind: "router", requiresBlocker: toStage === "blocked_waiting" };
}
