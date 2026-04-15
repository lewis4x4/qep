/**
 * Prospecting Nudge — pure logic (Track 2 Slice 2.5).
 *
 * The 2 PM prospecting nudge wakes managers to under-target reps before the
 * day closes. This module encapsulates the decision logic as a pure function
 * so it can be unit-tested without a DB.
 *
 * Decision rules:
 *   - A rep is "under target" when positive_visits < target on today's KPI row
 *   - A rep with a target of 0 is skipped (not on prospecting quota)
 *   - A rep with no KPI row for today is a "zero" — included if they hold
 *     the `rep` role and the workspace has a non-zero default target
 *   - One notification per (manager, rep) — no duplicates
 *   - A manager gets at most one notification per (rep, date) — dedup key is
 *     (workspace_id, user_id, rep_id, kpi_date)
 */

export interface RepKpiInput {
  rep_id: string;
  rep_name: string | null;
  positive_visits: number;
  target: number;
}

export interface ManagerInput {
  user_id: string;
}

export interface ProspectingNudgeDecision {
  workspace_id: string;
  manager_user_id: string;
  rep_id: string;
  rep_name: string | null;
  positive_visits: number;
  target: number;
  short_by: number;
  severity: "warning" | "critical";
}

export interface ComputeNudgesInput {
  workspace_id: string;
  reps: RepKpiInput[];
  managers: ManagerInput[];
  /** Completion threshold (0..1). At or below this fraction = critical. */
  critical_threshold?: number;
}

/**
 * Build a list of notification decisions for a single workspace.
 * Returns an empty list if there are no managers or no under-target reps.
 */
export function computeProspectingNudges({
  workspace_id,
  reps,
  managers,
  critical_threshold = 0.5,
}: ComputeNudgesInput): ProspectingNudgeDecision[] {
  if (managers.length === 0) return [];

  const decisions: ProspectingNudgeDecision[] = [];
  for (const rep of reps) {
    if (rep.target <= 0) continue;
    if (rep.positive_visits >= rep.target) continue;

    const completion = rep.positive_visits / rep.target;
    const severity: "warning" | "critical" = completion <= critical_threshold ? "critical" : "warning";
    const short_by = rep.target - rep.positive_visits;

    for (const manager of managers) {
      decisions.push({
        workspace_id,
        manager_user_id: manager.user_id,
        rep_id: rep.rep_id,
        rep_name: rep.rep_name,
        positive_visits: rep.positive_visits,
        target: rep.target,
        short_by,
        severity,
      });
    }
  }
  return decisions;
}

export function buildNudgeNotificationTitle(decision: ProspectingNudgeDecision): string {
  const who = decision.rep_name ?? "A rep";
  return decision.severity === "critical"
    ? `${who} is ${decision.short_by} short on prospecting (critical)`
    : `${who} is ${decision.short_by} short on prospecting`;
}

export function buildNudgeNotificationBody(decision: ProspectingNudgeDecision): string {
  return [
    `${decision.rep_name ?? "Rep"} has logged ${decision.positive_visits} of ${decision.target} prospecting visits today.`,
    decision.severity === "critical"
      ? "They are at or below 50% completion at 2 PM — intervene before EOD."
      : "They are behind target at 2 PM — a check-in before 4 PM keeps the day on track.",
  ].join(" ");
}
