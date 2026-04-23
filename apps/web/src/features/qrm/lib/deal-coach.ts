import type { DealCompositeBundle } from "./deal-composite-api";
import type { QuoteVelocityRow } from "../command-center/lib/quoteVelocity";
import type { TimeBankRow } from "./time-bank";
import type { BlockedDeal } from "../command-center/lib/blockerTypes";
import type { QrmVoiceCaptureTimelineSignals } from "./voice-capture-activity-metadata";

export interface DealCoachRecommendation {
  key: string;
  headline: string;
  confidence: "high" | "medium" | "low";
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface DealCoachBoard {
  summary: {
    recommendationCount: number;
    blockerCount: number;
    quoteRisk: boolean;
    isOverTime: boolean;
    voiceSignalCount: number;
  };
  recommendations: DealCoachRecommendation[];
}

function readTaskMeta(value: unknown): { dueAt?: string | null; status?: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const task = value as Record<string, unknown>;
  return {
    dueAt: typeof task.dueAt === "string" ? task.dueAt : null,
    status: typeof task.status === "string" ? task.status : null,
  };
}

function addRecommendation(
  bucket: DealCoachRecommendation[],
  recommendation: DealCoachRecommendation | null,
) {
  if (!recommendation) return;
  bucket.push(recommendation);
}

export function buildDealCoachBoard(input: {
  composite: DealCompositeBundle;
  quote: QuoteVelocityRow | null;
  timeBank: TimeBankRow | null;
  blocker: BlockedDeal | null;
  voiceSignals: QrmVoiceCaptureTimelineSignals[];
}): DealCoachBoard {
  const recommendations: DealCoachRecommendation[] = [];
  const deal = input.composite.deal;
  const needsAssessment = input.composite.needsAssessment;
  const overdueTasks = input.composite.activities.filter((activity) => {
    if (activity.activityType !== "task") return false;
    const task = readTaskMeta(activity.metadata.task);
    if (!task) return false;
    const dueAt = task.dueAt ? Date.parse(task.dueAt) : null;
    return task.status !== "completed" && dueAt != null && Number.isFinite(dueAt) && dueAt < Date.now();
  }).length;

  addRecommendation(
    recommendations,
    input.blocker
      ? {
          key: "clear-blocker",
          headline: "Clear the active blocker before pushing the deal forward",
          confidence: "high",
          trace: [
            input.blocker.detail,
            `Stage: ${input.blocker.stageName}.`,
            input.blocker.expectedClose ? `Expected close remains ${input.blocker.expectedClose}.` : "No expected close is recorded.",
          ],
          actionLabel: "Open blockers",
          href: "/qrm/command/blockers",
        }
      : null,
  );

  addRecommendation(
    recommendations,
    input.quote && (input.quote.isAging || input.quote.isExpiringSoon || input.quote.requiresRequote)
      ? {
          key: "recover-quote",
          headline: "Recover the quote before the buyer goes cold",
          confidence: input.quote.isAging || input.quote.isExpiringSoon ? "high" : "medium",
          trace: [
            input.quote.isAging ? `Quote has aged ${input.quote.ageDays} days.` : "Quote requires refresh.",
            input.quote.isExpiringSoon && input.quote.daysUntilExpiry != null
              ? `Quote expires in ${input.quote.daysUntilExpiry} days.`
              : "Quote is not in an immediate expiry window.",
            input.quote.requiresRequote ? "Quote is flagged for requote." : "No requote flag present.",
          ],
          actionLabel: "Open quote flow",
          href: `/quote-v2?crm_deal_id=${deal.id}${deal.primaryContactId ? `&crm_contact_id=${deal.primaryContactId}` : ""}`,
        }
      : null,
  );

  addRecommendation(
    recommendations,
    input.timeBank && (input.timeBank.is_over || input.timeBank.pct_used >= 0.85)
      ? {
          key: "protect-close-date",
          headline: "Reset the close plan to match the real stage velocity",
          confidence: input.timeBank.is_over ? "high" : "medium",
          trace: [
            `Deal has used ${Math.round(input.timeBank.pct_used * 100)}% of its stage budget.`,
            input.timeBank.is_over
              ? `The stage is over budget by ${Math.abs(input.timeBank.remaining_days)} days.`
              : `${input.timeBank.remaining_days} days remain in the stage budget.`,
            `Current stage: ${input.timeBank.stage_name}.`,
          ],
          actionLabel: "Open Time Bank",
          href: "/qrm/time-bank",
        }
      : null,
  );

  addRecommendation(
    recommendations,
    needsAssessment && (needsAssessment.completeness_pct ?? 0) < 80
      ? {
          key: "fill-discovery-gaps",
          headline: "Tighten discovery before pushing for commitment",
          confidence: "medium",
          trace: [
            `Needs assessment is ${(needsAssessment.completeness_pct ?? 0).toFixed(0)}% complete.`,
            needsAssessment.machine_interest ? `Machine interest: ${needsAssessment.machine_interest}.` : "Machine interest is missing.",
            needsAssessment.next_step ? `Next step recorded: ${needsAssessment.next_step}.` : "No next step is recorded.",
          ],
          actionLabel: "Open deal detail",
          href: `/qrm/deals/${deal.id}`,
        }
      : null,
  );

  const rentalOrUrgencySignal = input.voiceSignals.find((signal) =>
    signal.summary.urgencyLevel && signal.summary.urgencyLevel !== "unknown" ||
    signal.summary.financingInterest === "rental" ||
    signal.summary.financingInterest === "rent_to_own",
  );
  addRecommendation(
    recommendations,
    rentalOrUrgencySignal
      ? {
          key: "align-follow-up-mode",
          headline: "Match follow-up to the last field signal",
          confidence: "medium",
          trace: [
            rentalOrUrgencySignal.summary.urgencyLevel && rentalOrUrgencySignal.summary.urgencyLevel !== "unknown"
              ? `Urgency signal: ${rentalOrUrgencySignal.summary.urgencyLevel}.`
              : "No urgency signal detected.",
            rentalOrUrgencySignal.summary.financingInterest && rentalOrUrgencySignal.summary.financingInterest !== "unknown"
              ? `Financing signal: ${rentalOrUrgencySignal.summary.financingInterest}.`
              : "No financing preference captured.",
            rentalOrUrgencySignal.summary.nextStep
              ? `Suggested next step: ${rentalOrUrgencySignal.summary.nextStep}.`
              : "No explicit next step came from the field note.",
          ],
          actionLabel: "Open deal room",
          href: `/qrm/deals/${deal.id}/room`,
        }
      : null,
  );

  addRecommendation(
    recommendations,
    overdueTasks > 0
      ? {
          key: "clear-overdue-tasks",
          headline: "Clear overdue tasks before adding new motions",
          confidence: overdueTasks >= 2 ? "high" : "medium",
          trace: [
            `${overdueTasks} overdue task${overdueTasks === 1 ? "" : "s"} are attached to the deal.`,
            `Total activities logged: ${input.composite.activities.length}.`,
            deal.nextFollowUpAt ? `Current follow-up target: ${deal.nextFollowUpAt}.` : "No follow-up target is set.",
          ],
          actionLabel: "Open deal room",
          href: `/qrm/deals/${deal.id}/room`,
        }
      : null,
  );

  if (recommendations.length === 0) {
    recommendations.push({
      key: "stay-on-cadence",
      headline: "Stay on cadence and keep the opportunity moving",
      confidence: "low",
      trace: [
        "No acute blocker, quote-risk, or timing-risk signal is active.",
        `Activities logged: ${input.composite.activities.length}.`,
        deal.nextFollowUpAt ? `Next follow-up remains ${deal.nextFollowUpAt}.` : "No follow-up date is set yet.",
      ],
      actionLabel: "Open deal detail",
      href: `/qrm/deals/${deal.id}`,
    });
  }

  return {
    summary: {
      recommendationCount: recommendations.length,
      blockerCount: input.blocker ? 1 : 0,
      quoteRisk: Boolean(input.quote?.isAging || input.quote?.isExpiringSoon || input.quote?.requiresRequote),
      isOverTime: Boolean(input.timeBank?.is_over),
      voiceSignalCount: input.voiceSignals.length,
    },
    recommendations,
  };
}
