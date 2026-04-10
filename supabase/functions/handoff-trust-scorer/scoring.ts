export type HandoffOutcome = "improved" | "unchanged" | "degraded" | "unknown";

export interface ActivityEvidenceRow {
  created_at: string;
  deal_id: string | null;
  activity_type?: string | null;
}

export interface HandoffEvidence {
  sender_activity_count: number;
  first_action_at: string | null;
  first_action_type: string | null;
  hours_to_first_action: number | null;
}

export function scoreInfoCompleteness(senderActivityCount: number): number {
  if (senderActivityCount >= 3) return 1.0;
  if (senderActivityCount >= 2) return 0.8;
  if (senderActivityCount >= 1) return 0.5;
  return 0.2;
}

export function scoreRecipientReadiness(hoursToFirstAction: number | null): number {
  if (hoursToFirstAction === null) return 0.1;
  if (hoursToFirstAction <= 4) return 1.0;
  if (hoursToFirstAction <= 24) return 0.7;
  if (hoursToFirstAction <= 72) return 0.4;
  return 0.1;
}

export function scoreOutcomeAlignment(outcome: HandoffOutcome): number {
  switch (outcome) {
    case "improved":
      return 1.0;
    case "unchanged":
      return 0.5;
    case "degraded":
      return 0.1;
    case "unknown":
      return 0.3;
  }
}

export function countSubjectActivities(rows: ActivityEvidenceRow[], subjectId: string): number {
  return rows.filter((row) => row.deal_id === subjectId).length;
}

export function findFirstSubjectActivity(
  rows: ActivityEvidenceRow[],
  subjectId: string,
): ActivityEvidenceRow | null {
  return rows
    .filter((row) => row.deal_id === subjectId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0] ?? null;
}

export function assessDealOutcome(input: {
  transitionCount: number;
  isClosedWon: boolean;
  isClosedLost: boolean;
}): HandoffOutcome {
  if (input.transitionCount > 0) return "improved";
  if (input.isClosedWon) return "improved";
  if (input.isClosedLost) return "degraded";
  return "unknown";
}

export function buildHandoffEvidence(input: {
  senderActivityCount: number;
  firstAction: ActivityEvidenceRow | null;
  handoffAt: string;
}): HandoffEvidence {
  const hoursToFirstAction = input.firstAction
    ? (Date.parse(input.firstAction.created_at) - Date.parse(input.handoffAt)) / 3_600_000
    : null;

  return {
    sender_activity_count: input.senderActivityCount,
    first_action_at: input.firstAction?.created_at ?? null,
    first_action_type: input.firstAction?.activity_type ?? null,
    hours_to_first_action: hoursToFirstAction,
  };
}
