import { describe, expect, it } from "bun:test";
import { buildDealCoachBoard } from "./deal-coach";
import type { DealCompositeBundle } from "./deal-composite-api";
import type { QuoteVelocityRow } from "../command-center/lib/quoteVelocity";
import type { TimeBankRow } from "./time-bank";
import type { BlockedDeal } from "../command-center/lib/blockerTypes";
import type { QrmVoiceCaptureTimelineSignals } from "./voice-capture-activity-metadata";

const composite: DealCompositeBundle = {
  deal: {
    id: "deal-1",
    workspaceId: "default",
    name: "CAT 259D Purchase",
    stageId: "stage-1",
    primaryContactId: "contact-1",
    companyId: "company-1",
    assignedRepId: "rep-1",
    amount: 98000,
    expectedCloseOn: "2026-04-20",
    nextFollowUpAt: "2026-04-12T12:00:00.000Z",
    lastActivityAt: "2026-04-03T12:00:00.000Z",
    closedAt: null,
    hubspotDealId: null,
    createdAt: "2026-03-01T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    slaDeadlineAt: null,
    depositStatus: "pending",
    depositAmount: null,
  },
  contact: null,
  company: null,
  needsAssessment: {
    id: "na-1",
    application: "Land clearing",
    work_type: "Site prep",
    terrain_material: "Rocky clay",
    current_equipment: null,
    current_equipment_issues: null,
    machine_interest: "CAT 259D",
    attachments_needed: [],
    brand_preference: "CAT",
    timeline_description: null,
    timeline_urgency: null,
    budget_type: "finance",
    budget_amount: null,
    monthly_payment_target: null,
    financing_preference: "rent_to_own",
    has_trade_in: false,
    trade_in_details: null,
    is_decision_maker: true,
    decision_maker_name: "Casey Brown",
    next_step: "quote",
    entry_method: "voice",
    qrm_narrative: null,
    completeness_pct: 72,
    fields_populated: 11,
    fields_total: 15,
  },
  cadences: [],
  demos: [],
  activities: [
    {
      id: "task-1",
      workspaceId: "default",
      activityType: "task",
      body: "Follow up on quote",
      occurredAt: "2026-04-05T12:00:00.000Z",
      contactId: null,
      companyId: null,
      dealId: "deal-1",
      createdBy: "rep-1",
      metadata: { task: { dueAt: "2026-04-08T12:00:00.000Z", status: "open" } },
      createdAt: "2026-04-05T12:00:00.000Z",
      updatedAt: "2026-04-05T12:00:00.000Z",
    },
  ],
  lossFields: {
    lossReason: null,
    competitor: null,
  },
};

const quote: QuoteVelocityRow = {
  id: "quote-1",
  dealId: "deal-1",
  dealName: "CAT 259D Purchase",
  contactName: "Casey Brown",
  status: "sent",
  effectiveStatus: "sent",
  netTotal: 98000,
  marginPct: 12,
  ageDays: 18,
  daysUntilExpiry: 3,
  isSigned: false,
  isAging: true,
  isExpiringSoon: true,
  requiresRequote: false,
  entryMode: "voice",
};

const timeBank: TimeBankRow = {
  deal_id: "deal-1",
  deal_name: "CAT 259D Purchase",
  company_id: "company-1",
  company_name: "Oak Ridge Construction",
  assigned_rep_id: "rep-1",
  assigned_rep_name: "Alex Rep",
  stage_id: "stage-1",
  stage_name: "Quote Created",
  days_in_stage: 21,
  stage_age_days: 21,
  budget_days: 14,
  has_explicit_budget: true,
  remaining_days: -7,
  pct_used: 1.5,
  is_over: true,
};

const blocker: BlockedDeal = {
  id: "deposit-deal-1",
  dealId: "deal-1",
  dealName: "CAT 259D Purchase",
  companyName: "Oak Ridge Construction",
  contactName: "Casey Brown",
  amount: 98000,
  stageName: "Quote Created",
  stageOrder: 6,
  category: "deposit_missing",
  detail: "$10K pending",
  daysBlocked: 4,
  expectedClose: "2026-04-20",
  depositId: "dep-1",
};

const voiceSignals: QrmVoiceCaptureTimelineSignals[] = [
  {
    summary: {
      contactName: "Casey Brown",
      companyName: "Oak Ridge Construction",
      machineInterest: "CAT 259D",
      applicationUseCase: "Land clearing",
      equipmentMake: "CAT",
      equipmentModel: "259D",
      dealStage: "quote_sent",
      urgencyLevel: "urgent",
      financingInterest: "rent_to_own",
      tradeInLikelihood: "unknown",
      nextStep: "Schedule on-site walk",
      followUpDate: "2026-04-12",
      keyConcerns: "Wants to move before spring crew mobilization",
      competitorsMentioned: null,
      recommendedNextAction: "Call today",
      managerAttentionFlag: false,
    },
    actionItems: ["Confirm walkaround time"],
  },
];

describe("buildDealCoachBoard", () => {
  it("turns live deal evidence into coaching recommendations with confidence and trace", () => {
    const board = buildDealCoachBoard({
      composite,
      quote,
      timeBank,
      blocker,
      voiceSignals,
    });

    expect(board.summary.recommendationCount).toBeGreaterThanOrEqual(5);
    expect(board.summary.blockerCount).toBe(1);
    expect(board.summary.quoteRisk).toBe(true);
    expect(board.summary.isOverTime).toBe(true);
    expect(board.recommendations[0]?.headline).toContain("Clear the active blocker");
    expect(board.recommendations.some((item) => item.confidence === "high")).toBe(true);
    expect(board.recommendations.some((item) => item.trace.length > 1)).toBe(true);
  });

  it("falls back to a cadence recommendation when no acute risk is present", () => {
    const board = buildDealCoachBoard({
      composite: {
        ...composite,
        needsAssessment: {
          ...composite.needsAssessment!,
          completeness_pct: 90,
        },
        activities: [],
      },
      quote: null,
      timeBank: null,
      blocker: null,
      voiceSignals: [],
    });

    expect(board.summary.recommendationCount).toBe(1);
    expect(board.recommendations[0]?.confidence).toBe("low");
    expect(board.recommendations[0]?.headline).toContain("Stay on cadence");
  });
});
