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
  | "pipelinePressure"
  | "revenueRealityBoard"
  | "dealerRealityGrid"
  | "relationshipEngine"
  | "knowledgeGaps"
  | "executiveIntel";

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
  /** P0.8 trace ID — links the card to its prediction ledger row for trace viewing. */
  traceId?: string | null;
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

// ─── Revenue Reality Board ─────────────────────────────────────────────────

export type BlockerType = "deposit_missing" | "margin_flagged" | "anomaly_critical";

export interface BlockerBreakdownEntry {
  type: BlockerType;
  count: number;
  totalValue: number;
}

export interface RevenueRealityBoardPayload {
  openPipeline: number;
  weightedRevenue: number;
  closable7d: number;
  closable30d: number;
  atRisk: number;
  marginAtRisk: number;
  stalledQuotes: { count: number; totalValue: number };
  blockedByType: BlockerBreakdownEntry[];
  dgeBlendedDealCount: number;
  dgeAvailability: "none" | "partial" | "full";
}

// ─── Dealer Reality Grid ───────────────────────────────────────────────────

export type DealerGridTileKey =
  | "quotes" | "trades" | "demos"
  | "traffic" | "rentals" | "escalations";

export interface DealerGridTile {
  key: DealerGridTileKey;
  label: string;
  activeCount: number;
  urgentCount: number;
  totalValue: number;
  summary: string;
  movement: string | null;
  ctaLabel: string;
  ctaHref: string;
  status: SectionStatus;
  reason?: string;
}

export interface DealerRealityGridPayload {
  tiles: DealerGridTile[];
  generatedAt: string;
}

// ─── Relationship & Opportunity Engine ─────────────────────────────────────

export type RelationshipSignalKind =
  | "heating_up" | "cooling_off" | "competitor_rising"
  | "fleet_replacement" | "silent_key_account";

export interface RelationshipSignal {
  kind: RelationshipSignalKind;
  companyId: string;
  companyName: string;
  detail: string;
  score: number;
  ctaLabel: string;
  ctaHref: string;
  observedAt: string;
}

export interface RelationshipEnginePayload {
  heatingUp: RelationshipSignal[];
  coolingOff: RelationshipSignal[];
  competitorRising: RelationshipSignal[];
  fleetReplacement: RelationshipSignal[];
  silentKeyAccounts: RelationshipSignal[];
}

export interface CommandCenterResponse {
  scope: CommandCenterScope;
  roleVariant: IronRole;
  freshness: Record<SectionKey, SectionFreshness>;
  commandStrip: CommandStripPayload;
  aiChiefOfStaff: AiChiefOfStaffPayload;
  actionLanes: ActionLanesPayload;
  pipelinePressure: PipelinePressurePayload;
  revenueRealityBoard: RevenueRealityBoardPayload;
  dealerRealityGrid: DealerRealityGridPayload;
  relationshipEngine: RelationshipEnginePayload;
  knowledgeGaps: KnowledgeGapsPayload;
  executiveIntel: ExecutiveIntelPayload;
}

// ─── Executive Intelligence Layer ──────────────────────────────────────────

export interface ForecastConfidenceCard {
  weightedPipeline: number;
  rawPipeline: number;
  confidenceScore: number;
  confidenceLabel: "Strong" | "Moderate" | "Weak";
  activeDeals: number;
  avgInactivityDays: number;
  depositsVerifiedPct: number;
}

export interface RepPerformanceCard {
  repId: string;
  repName: string;
  visits7d: number;
  targetMetStreak: number;
  opportunitiesCreated: number;
  quotesGenerated: number;
}

export interface MarginPressureCard {
  flaggedDealCount: number;
  flaggedDealValue: number;
  negativeMarginCloses30d: number;
  medianMarginPct30d: number | null;
}

export interface BranchHealthCard {
  branchId: string;
  branchName: string;
  dealCount: number;
  pipelineValue: number;
  avgAgeDays: number;
}

export interface ExecutiveIntelPayload {
  forecast: ForecastConfidenceCard;
  topReps: RepPerformanceCard[];
  marginPressure: MarginPressureCard;
  branchHealth: BranchHealthCard[];
  isElevatedView: boolean;
}

// ─── Knowledge Gaps + Absence Engine ───────────────────────────────────────

export interface RepAbsenceRow {
  repId: string;
  repName: string;
  ironRole: string | null;
  dealCount: number;
  missingAmount: number;
  missingCloseDate: number;
  missingContact: number;
  missingCompany: number;
  absenceScore: number;
}

export interface KnowledgeGapItem {
  id: string;
  question: string;
  frequency: number;
  lastAskedAt: string;
  askedByRole: string | null;
}

export interface KnowledgeGapsPayload {
  topGaps: KnowledgeGapItem[];
  repAbsence: RepAbsenceRow[];
  worstFields: Array<{ field: string; label: string; missingPct: number }>;
  isManagerView: boolean;
}
