export type QuoteEntryMode = "voice" | "ai_chat" | "manual";

export interface QuoteLineItemDraft {
  kind: "equipment" | "attachment";
  id?: string;
  title: string;
  make?: string;
  model?: string;
  year?: number | null;
  quantity: number;
  unitPrice: number;
}

export interface QuoteRecommendation {
  machine: string;
  attachments: string[];
  reasoning: string;
}

export interface QuoteFinanceScenario {
  type: "cash" | "finance" | "lease";
  label: string;
  monthlyPayment?: number | null;
  apr?: number | null;
  termMonths?: number | null;
  totalCost?: number | null;
  rate?: number | null;
  lender?: string | null;
}

export interface QuoteFinancingPreview {
  scenarios: QuoteFinanceScenario[];
  margin_check?: {
    flagged?: boolean;
    message?: string;
  } | null;
  incentives?: {
    applicable?: Array<{
      id: string;
      name: string;
      oem_name?: string;
      discount_type: string;
      discount_value: number;
      estimated_savings: number;
      end_date?: string;
    }>;
    total_savings?: number;
  } | null;
}

export interface QuoteApprovalState {
  requiresManagerApproval: boolean;
  marginPct: number;
  reason: string | null;
}

export interface QuotePacketReadiness {
  canSave: boolean;
  canSend: boolean;
  missing: string[];
}

export interface QuoteWorkspaceDraft {
  dealId?: string;
  contactId?: string;
  entryMode: QuoteEntryMode;
  branchSlug: string;
  recommendation: QuoteRecommendation | null;
  voiceSummary: string | null;
  equipment: QuoteLineItemDraft[];
  attachments: QuoteLineItemDraft[];
  tradeAllowance: number;
  tradeValuationId: string | null;
}

export interface PortalQuoteRevisionCompare {
  hasChanges: boolean;
  priceChanges: string[];
  equipmentChanges: string[];
  financingChanges: string[];
  termsChanges: string[];
  dealerMessageChange: string | null;
}

export type PortalQuoteRevisionDraftStatus = "draft" | "awaiting_approval" | "published" | "superseded";

export interface PortalQuoteRevisionDraft {
  id: string;
  portalQuoteReviewId: string;
  quotePackageId: string;
  dealId: string;
  preparedBy: string | null;
  approvedBy: string | null;
  status: PortalQuoteRevisionDraftStatus;
  quoteData: Record<string, unknown> | null;
  quotePdfUrl: string | null;
  dealerMessage: string | null;
  revisionSummary: string | null;
  customerRequestSnapshot: string | null;
  compareSnapshot: PortalQuoteRevisionCompare | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface PortalQuoteRevisionPublishState {
  portalQuoteReviewId: string;
  currentPublishedVersionNumber: number | null;
  currentPublishedDealerMessage: string | null;
  currentPublishedRevisionSummary: string | null;
  latestCustomerRequestSnapshot: string | null;
  publicationStatus: "none" | "draft_revision" | "awaiting_approval" | "published";
}

export interface ServiceJobPortalStatus {
  serviceJobId: string;
  currentStage: string;
  estimatedCompletion: string | null;
  status: string;
  lastUpdatedAt: string;
}

export interface MachinePortalStatus {
  label: string;
  source: "quote_review" | "deal_progress" | "service_job" | "portal_request" | "default";
  sourceLabel: string;
  eta: string | null;
  lastUpdatedAt: string | null;
  nextAction?: string | null;
}

export interface CustomerMachineView {
  id: string;
  make: string;
  model: string;
  year: number | null;
  serialNumber: string | null;
  currentHours: number | null;
  warrantyExpiry: string | null;
  nextServiceDue: string | null;
  tradeInInterest?: boolean;
  activeServiceJob?: ServiceJobPortalStatus | null;
  portalStatus?: MachinePortalStatus | null;
}

export interface PortalSubscriptionWorkspaceView {
  id: string;
  planName: string;
  planType: string;
  status: string;
  billingCycle: string | null;
  baseMonthlyRate: number;
  usageCapHours: number | null;
  overageRate: number | null;
  usageHours: number | null;
  overageHours: number | null;
  nextBillingDate: string | null;
  nextRotationDate: string | null;
  includesMaintenance: boolean;
  maintenanceStatus: {
    openCount: number;
    nextScheduledDate: string | null;
  };
  equipment: {
    id: string | null;
    label: string;
    serialNumber: string | null;
  } | null;
}

export interface PortalRentalReturnWorkspaceView {
  id: string;
  status: string;
  rentalContractReference: string | null;
  inspectionDate: string | null;
  decisionAt: string | null;
  refundStatus: string | null;
  balanceDue: number | null;
  chargeAmount: number | null;
  depositAmount: number | null;
  hasCharges: boolean | null;
  equipment: {
    id: string | null;
    label: string;
    serialNumber: string | null;
  } | null;
}

export type CampaignTriggerType =
  | "inventory_arrival"
  | "seasonal"
  | "competitor_displacement"
  | "fleet_replacement"
  | "quote_inactivity"
  | "service_event"
  | "telematics_threshold"
  | "custom";

export interface CampaignTriggerContext {
  triggerType: CampaignTriggerType;
  workspaceId: string;
  targetSegment: Record<string, unknown>;
  equipmentContext: Record<string, unknown> | null;
  triggerConfig?: Record<string, unknown>;
}

export interface MarketingCampaignPlan {
  name: string;
  campaignType: CampaignTriggerType;
  targetSegment: Record<string, unknown>;
  contentTemplate: {
    subject: string;
    body: string;
    social_copy: string;
  };
  aiGenerated: boolean;
  channels: string[];
  status: string;
  triggerType: "inventory_event" | "manual" | "schedule";
  triggerConfig?: Record<string, unknown>;
}

export interface TelematicsUsageSnapshot {
  deviceId: string;
  hours: number | null;
  lat: number | null;
  lng: number | null;
  readingAt: string;
  equipmentId?: string | null;
  subscriptionId?: string | null;
}
