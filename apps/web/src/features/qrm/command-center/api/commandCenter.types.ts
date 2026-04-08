/**
 * QRM Command Center — frontend type mirror.
 *
 * Hand-mirrored from
 * supabase/functions/_shared/qrm-command-center/types.ts
 *
 * Kept manually in sync (small + stable). When the backend types change,
 * update this file in the same PR — there is no codegen step.
 */

export type IronRole = "iron_advisor" | "iron_manager" | "iron_woman" | "iron_man";

export type CommandCenterScope = "mine" | "team" | "branch" | "company";

export type SectionStatus = "live" | "degraded" | "unavailable";

export type SectionKey =
  | "commandStrip"
  | "aiChiefOfStaff"
  | "actionLanes"
  | "pipelinePressure";

export interface SectionFreshness {
  generatedAt: string;
  source: SectionStatus;
  latencyMs?: number;
  reason?: string;
}

export type LaneKey = "revenue_ready" | "revenue_at_risk" | "blockers";

export type RecommendationEntityType =
  | "deal"
  | "contact"
  | "company"
  | "quote"
  | "demo"
  | "task";

export type ActionKind =
  | "open_deal"
  | "log_activity"
  | "schedule_follow_up"
  | "open_quote"
  | "request_approval"
  | "view_pipeline_stage";

export interface RecommendationAction {
  kind: ActionKind;
  label: string;
  href?: string;
  payloadId?: string;
}

export interface RecommendationCardPayload {
  recommendationKey: string;
  entityType: RecommendationEntityType;
  entityId: string;
  headline: string;
  rationale: string[];
  lane: LaneKey;
  confidence: number;
  score: number;
  primaryAction: RecommendationAction;
  secondaryAction?: RecommendationAction;
  amount: number | null;
  companyName: string | null;
  contactName: string | null;
  stageName: string | null;
  observedAt: string;
}

export interface CommandStripPayload {
  closableRevenue7d: number;
  closableRevenue30d: number;
  atRiskRevenue: number;
  blockedDeals: number;
  overdueFollowUps: number;
  urgentApprovals: number;
  narrative: string;
}

export interface AiChiefOfStaffPayload {
  bestMove: RecommendationCardPayload | null;
  biggestRisk: RecommendationCardPayload | null;
  fastestPath: RecommendationCardPayload | null;
  additional: RecommendationCardPayload[];
  source: "rules" | "rules+llm";
}

export interface ActionLanesPayload {
  revenueReady: RecommendationCardPayload[];
  revenueAtRisk: RecommendationCardPayload[];
  blockers: RecommendationCardPayload[];
}

export type PipelineRiskState = "healthy" | "watch" | "critical";

export type PipelineMetaStage =
  | "early_funnel"
  | "quote_validation"
  | "close_funding"
  | "readiness_delivery"
  | "post_sale";

export interface PipelineStageBucket {
  id: string;
  name: string;
  metaStage: PipelineMetaStage;
  count: number;
  amount: number;
  weightedAmount: number;
  avgDaysInStage: number | null;
  stuckCount: number;
  riskState: PipelineRiskState;
}

export interface PipelinePressurePayload {
  stages: PipelineStageBucket[];
  totals: {
    openCount: number;
    openAmount: number;
    weightedAmount: number;
  };
}

export interface CommandCenterResponse {
  scope: CommandCenterScope;
  roleVariant: IronRole;
  freshness: Record<SectionKey, SectionFreshness>;
  commandStrip: CommandStripPayload;
  aiChiefOfStaff: AiChiefOfStaffPayload;
  actionLanes: ActionLanesPayload;
  pipelinePressure: PipelinePressurePayload;
}
