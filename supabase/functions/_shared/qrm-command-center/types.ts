/**
 * QRM Command Center — shared response types.
 *
 * Backed by `supabase/functions/qrm-command-center/index.ts` and consumed by
 * `apps/web/src/features/qrm/command-center/api/commandCenter.types.ts` (TS
 * mirror kept in sync manually). Slice 1 ships only the sections required for
 * the spine: commandStrip, aiChiefOfStaff, actionLanes, pipelinePressure.
 * Other sections appear in later slices and are intentionally omitted here
 * rather than left as empty stubs.
 */

export type IronRole = "iron_advisor" | "iron_manager" | "iron_woman" | "iron_man";

/**
 * Canonical IronRole narrower for the Deno backend.
 *
 * Frontend has its own narrower in
 * `apps/web/src/features/qrm/lib/iron-roles.ts` (different runtime —
 * Deno can't import from `apps/web`). The two MUST stay in lock-step;
 * any new IronRole value gets added in BOTH places.
 */
const IRON_ROLE_VALUES: ReadonlySet<string> = new Set([
  "iron_advisor",
  "iron_manager",
  "iron_woman",
  "iron_man",
]);

export function isIronRole(value: string | null | undefined): value is IronRole {
  return !!value && IRON_ROLE_VALUES.has(value);
}

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
  | "knowledgeGaps";

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
  /** Optional id used by the frontend to wire to existing hooks. */
  payloadId?: string;
}

export interface RecommendationCardPayload {
  /** Stable key for snooze/dismiss persistence. */
  recommendationKey: string;
  entityType: RecommendationEntityType;
  entityId: string;
  headline: string;
  /** Pre-formatted, terminology-locked rationale bullets. */
  rationale: string[];
  lane: LaneKey;
  /** 0..1 confidence after weighting; UI rounds for display. */
  confidence: number;
  /** Numeric score from the ranker (informational; not displayed). */
  score: number;
  primaryAction: RecommendationAction;
  secondaryAction?: RecommendationAction;
  /** Useful display fields the card surfaces alongside the headline. */
  amount: number | null;
  companyName: string | null;
  contactName: string | null;
  stageName: string | null;
  /** ISO timestamp the contributing signals were observed. */
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
  /** Spec §8.1 — single natural-language operating summary. */
  narrative: string;
}

export interface AiChiefOfStaffPayload {
  bestMove: RecommendationCardPayload | null;
  biggestRisk: RecommendationCardPayload | null;
  fastestPath: RecommendationCardPayload | null;
  additional: RecommendationCardPayload[];
  /** Slice 1 always reports "rules" — LLM enrichment lands in Slice 4. */
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
  /** Sum of all open deal amounts (raw, unweighted). */
  openPipeline: number;
  /** Sum of (amount × effectiveProbability) for all open deals. */
  weightedRevenue: number;
  /** Weighted revenue for deals closing within 7 days with effectiveProb ≥ 0.5. */
  closable7d: number;
  /** Weighted revenue for deals closing within 30 days with effectiveProb ≥ 0.5. */
  closable30d: number;
  /** Weighted revenue for stalled (>7d no activity) or overdue follow-up deals. */
  atRisk: number;
  /** Total deal value where margin_check_status = 'flagged'. */
  marginAtRisk: number;
  /** Deals with no activity for >14 days. */
  stalledQuotes: { count: number; totalValue: number };
  /** Deals grouped by blocker kind. */
  blockedByType: BlockerBreakdownEntry[];
  /** How many deals used DGE close-probability blending. */
  dgeBlendedDealCount: number;
  /** DGE coverage: "none" | "partial" | "full". */
  dgeAvailability: "none" | "partial" | "full";
}

// ─── Dealer Reality Grid ───────────────────────────────────────────────────

export type DealerGridTileKey =
  | "quotes"
  | "trades"
  | "demos"
  | "traffic"
  | "rentals"
  | "escalations";

export interface DealerGridTile {
  key: DealerGridTileKey;
  label: string;
  activeCount: number;
  urgentCount: number;
  /** Dollar exposure — meaning varies per domain (quote value, trade value, charge amount). */
  totalValue: number;
  /** Natural-language operational summary. */
  summary: string;
  /** Momentum indicator: "↑ 2 new today" or "↓ 1 resolved" or null. */
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
  | "heating_up"
  | "cooling_off"
  | "competitor_rising"
  | "fleet_replacement"
  | "silent_key_account";

export interface RelationshipSignal {
  kind: RelationshipSignalKind;
  companyId: string;
  companyName: string;
  /** Human-readable signal detail. */
  detail: string;
  /** 0–1 relevance/urgency score. */
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
  /** Composite 0–1 where 1 = perfect data, 0 = all gaps. */
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
  /** False when caller is not manager/owner — section renders empty. */
  isManagerView: boolean;
}

export interface CommandCenterResponse {
  scope: CommandCenterScope;
  roleVariant: IronRole;
  /** Per-section freshness so degraded sections don't lie about their data. */
  freshness: Record<SectionKey, SectionFreshness>;
  commandStrip: CommandStripPayload;
  aiChiefOfStaff: AiChiefOfStaffPayload;
  actionLanes: ActionLanesPayload;
  pipelinePressure: PipelinePressurePayload;
  revenueRealityBoard: RevenueRealityBoardPayload;
  dealerRealityGrid: DealerRealityGridPayload;
  relationshipEngine: RelationshipEnginePayload;
  knowledgeGaps: KnowledgeGapsPayload;
}
