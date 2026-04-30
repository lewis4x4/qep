export type QrmActivityType = "note" | "call" | "email" | "meeting" | "task" | "sms";

export type QrmTaskStatus = "open" | "completed";
export type QrmFollowUpStepType = "task" | "email" | "call_log" | "stalled_alert";
export type QrmEnrollmentStatus = "active" | "completed" | "paused" | "cancelled";

export interface QrmActivityTemplate {
  id: string;
  activityType: QrmActivityType;
  label: string;
  description: string;
  body: string;
  taskDueMinutes?: number;
  taskStatus?: QrmTaskStatus;
  sortOrder?: number;
  source: "system" | "workspace";
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface QrmTaskMetadata {
  dueAt?: string | null;
  status?: QrmTaskStatus;
}

export interface QrmContactSummary {
  id: string;
  workspaceId: string;
  dgeCustomerProfileId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  primaryCompanyId: string | null;
  assignedRepId: string | null;
  mergedIntoContactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QrmCompanySummary {
  id: string;
  workspaceId: string;
  name: string;
  parentCompanyId: string | null;
  assignedRepId: string | null;
  legacyCustomerNumber: string | null;
  status: string | null;
  productCategory: "business" | "individual" | "government" | "non_profit" | "internal" | null;
  arType: "open_item" | "balance_forward" | "true_balance_forward" | null;
  paymentTermsCode: string | null;
  termsCode: string | null;
  territoryCode: string | null;
  pricingLevel: number | null;
  doNotContact: boolean | null;
  optOutSalePi: boolean | null;
  search1: string | null;
  search2: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  ein?: string | null;
  einMasked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QrmCompanyShipToAddress {
  id: string;
  workspaceId: string;
  companyId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  instructions: string | null;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface QrmCompanyShipToInput {
  name?: string;
  contactName?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  instructions?: string | null;
  isPrimary?: boolean;
  sortOrder?: number | null;
  archive?: boolean;
}

export type QrmCampaignChannel = "email" | "sms";
export type QrmCampaignState = "draft" | "running" | "completed" | "cancelled";
export type QrmCampaignRecipientStatus = "pending" | "sent" | "delivered" | "failed" | "ineligible";

export interface QrmCampaign {
  id: string;
  name: string;
  channel: QrmCampaignChannel;
  templateId: string | null;
  audienceSnapshot: Record<string, unknown>;
  state: QrmCampaignState;
  executionSummary: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QrmCampaignInput {
  name?: string;
  channel?: QrmCampaignChannel;
  templateId?: string | null;
  audienceContactIds?: string[];
  archive?: boolean;
}

export interface QrmCampaignRecipient {
  id: string;
  campaignId: string;
  contactId: string;
  contactName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: QrmCampaignRecipientStatus;
  ineligibilityReason: string | null;
  errorCode: string | null;
  attemptedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export interface QrmActivityItem {
  id: string;
  workspaceId: string;
  activityType: QrmActivityType;
  body: string | null;
  occurredAt: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  isOptimistic?: boolean;
}

export interface QrmActivityFeedItem extends QrmActivityItem {
  actorName: string | null;
  contactName: string | null;
  companyName: string | null;
  dealName: string | null;
}

export interface QrmContactTerritory {
  id: string;
  name: string;
  assignedRepId: string | null;
}

export interface QrmRepSafeDeal {
  id: string;
  workspaceId: string;
  name: string;
  stageId: string;
  primaryContactId: string | null;
  companyId: string | null;
  assignedRepId: string | null;
  amount: number | null;
  expectedCloseOn: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  closedAt: string | null;
  hubspotDealId: string | null;
  createdAt: string;
  updatedAt: string;
  // Pipeline enrichment (migration 066+)
  slaDeadlineAt: string | null;
  depositStatus: string | null;
  depositAmount: number | null;
  // Pipeline board polish (migration 254 — Slice 2.4)
  sortPosition: number | null;
  marginPct: number | null;
}

export interface QrmDealLossFields {
  lossReason: string | null;
  competitor: string | null;
}

export interface QrmDealStage {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  probability: number | null;
  isClosedWon: boolean;
  isClosedLost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QrmWeightedDeal {
  id: string;
  workspaceId: string;
  name: string;
  stageId: string;
  stageName: string;
  stageProbability: number | null;
  primaryContactId: string | null;
  companyId: string | null;
  assignedRepId: string | null;
  amount: number | null;
  weightedAmount: number | null;
  expectedCloseOn: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  closedAt: string | null;
  hubspotDealId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QrmQuoteStatus = "draft" | "linked" | "archived";

export interface QrmQuote {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  crmContactId: string | null;
  crmDealId: string | null;
  status: QrmQuoteStatus;
  title: string | null;
  lineItems: unknown[];
  customerSnapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  linkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface QrmQuoteUpsertInput {
  crmContactId?: string | null;
  crmDealId?: string | null;
  status: QrmQuoteStatus;
  title?: string | null;
  lineItems: unknown[];
  customerSnapshot: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  linkedAt?: string | null;
}

export interface QrmDealBoardListInput {
  cursor?: string | null;
  limit?: number;
}

export type QrmFollowUpReminderSource = "pipeline_quick" | "deal_detail" | "voice" | "system";

export interface QrmDealPatchInput {
  name?: string;
  stageId?: string;
  primaryContactId?: string | null;
  companyId?: string | null;
  amount?: number | null;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  closedAt?: string | null;
  lossReason?: string | null;
  competitor?: string | null;
  archive?: boolean;
  followUpReminderSource?: QrmFollowUpReminderSource;
}

export interface QrmContactUpsertInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  primaryCompanyId?: string | null;
  archive?: boolean;
}

export interface QrmCompanyUpsertInput {
  name: string;
  status?: string | null;
  productCategory?: QrmCompanySummary["productCategory"];
  arType?: QrmCompanySummary["arType"];
  paymentTermsCode?: string | null;
  termsCode?: string | null;
  territoryCode?: string | null;
  pricingLevel?: number | null;
  doNotContact?: boolean | null;
  optOutSalePi?: boolean | null;
  search1?: string | null;
  search2?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  ein?: string | null;
  archive?: boolean;
}

export interface QrmDealCreateInput {
  name: string;
  stageId: string;
  primaryContactId?: string | null;
  companyId?: string | null;
  amount?: number | null;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  followUpReminderSource?: QrmFollowUpReminderSource;
}

export interface QrmFollowUpStep {
  id: string;
  sequenceId: string;
  stepNumber: number;
  dayOffset: number;
  stepType: QrmFollowUpStepType;
  subject: string | null;
  bodyTemplate: string | null;
  taskPriority: string | null;
  createdAt: string;
}

export interface QrmFollowUpSequence {
  id: string;
  name: string;
  description: string | null;
  triggerStage: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  steps: QrmFollowUpStep[];
}

export interface QrmFollowUpSequenceEditorInput {
  id?: string;
  name: string;
  description?: string | null;
  triggerStage: string;
  isActive: boolean;
  steps: Array<{
    id?: string;
    stepNumber: number;
    dayOffset: number;
    stepType: QrmFollowUpStepType;
    subject?: string | null;
    bodyTemplate?: string | null;
    taskPriority?: string | null;
  }>;
}

export interface QrmSequenceEnrollment {
  id: string;
  sequenceId: string;
  sequenceName: string;
  dealId: string;
  dealName: string | null;
  contactId: string | null;
  contactName: string | null;
  ownerId: string | null;
  hubId: string;
  enrolledAt: string;
  currentStep: number;
  nextStepDueAt: string | null;
  status: QrmEnrollmentStatus;
  completedAt: string | null;
  cancelledAt: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface QrmPageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface QrmActivityCreateInput {
  activityType: QrmActivityType;
  body: string;
  occurredAt: string;
  sendNow?: boolean;
  task?: QrmTaskMetadata;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export interface QrmActivityTaskPatchInput {
  task: QrmTaskMetadata;
  updatedAt?: string;
}

export interface QrmActivityPatchInput {
  body?: string;
  occurredAt?: string;
  updatedAt?: string;
  task?: QrmTaskMetadata;
  archive?: boolean;
}

export type QrmRecordType = "contact" | "company" | "equipment";

// Mirrors CrmSearchResult in supabase/functions/_shared/crm-router-service.ts.
// Keep in sync; the router returns raw JSON, so the contract lives in both places.
export type QrmSearchEntityType =
  | "company"
  | "contact"
  | "deal"
  | "equipment"
  | "rental";

export interface QrmSearchItem {
  type: QrmSearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: string;
  rank: number;
}

export interface QrmHierarchyNode {
  id: string;
  name: string;
}

export interface QrmCompanyHierarchy {
  company: {
    id: string;
    name: string;
    assignedRepId: string | null;
  };
  ancestors: QrmHierarchyNode[];
  children: QrmHierarchyNode[];
  rollups: {
    contacts: number;
    equipment: number;
  };
  subtreeCompanyIds: string[];
}

export type QrmEquipmentCategory =
  | "excavator" | "loader" | "backhoe" | "dozer" | "skid_steer"
  | "crane" | "forklift" | "telehandler"
  | "truck" | "trailer" | "dump_truck"
  | "aerial_lift" | "boom_lift" | "scissor_lift"
  | "compactor" | "roller"
  | "generator" | "compressor" | "pump" | "welder"
  | "attachment" | "bucket" | "breaker"
  | "concrete" | "paving"
  | "drill" | "boring"
  | "other";

export type QrmEquipmentCondition = "new" | "excellent" | "good" | "fair" | "poor" | "salvage";
export type QrmEquipmentAvailability = "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned";
export type QrmEquipmentOwnership = "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
export type QrmDealEquipmentRole = "subject" | "trade_in" | "rental" | "part_exchange";

export interface QrmEquipment {
  id: string;
  companyId: string;
  primaryContactId: string | null;
  name: string;
  assetTag: string | null;
  serialNumber: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  category: QrmEquipmentCategory | null;
  vinPin: string | null;
  condition: QrmEquipmentCondition | null;
  availability: QrmEquipmentAvailability;
  ownership: QrmEquipmentOwnership;
  engineHours: number | null;
  mileage: number | null;
  fuelType: string | null;
  weightClass: string | null;
  operatingCapacity: string | null;
  locationDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  purchasePrice: number | null;
  currentMarketValue: number | null;
  replacementCost: number | null;
  dailyRentalRate: number | null;
  weeklyRentalRate: number | null;
  monthlyRentalRate: number | null;
  warrantyExpiresOn: string | null;
  lastInspectionAt: string | null;
  nextServiceDueAt: string | null;
  notes: string | null;
  photoUrls: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Present when loaded via subtree equipment API. */
  companyName?: string | null;
}

export interface QrmDealEquipmentLink {
  id: string;
  dealId: string;
  equipmentId: string;
  role: QrmDealEquipmentRole;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  equipment: {
    name: string;
    make: string | null;
    model: string | null;
    year: number | null;
    category: QrmEquipmentCategory | null;
    assetTag: string | null;
    serialNumber: string | null;
    availability: QrmEquipmentAvailability;
    condition: QrmEquipmentCondition | null;
  } | null;
}

export interface QrmCustomField {
  definitionId: string;
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  visibilityRoles: string[];
  sortOrder: number;
  constraints: Record<string, unknown>;
  value: unknown;
}

export interface QrmDuplicateContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  assignedRepId: string | null;
}

export interface QrmDuplicateCandidate {
  id: string;
  ruleId: string;
  score: number;
  status: "open" | "dismissed" | "merged";
  leftContact: QrmDuplicateContact | null;
  rightContact: QrmDuplicateContact | null;
  createdAt: string;
  updatedAt: string;
}
