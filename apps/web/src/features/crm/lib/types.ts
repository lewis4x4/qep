export type CrmActivityType = "note" | "call" | "email" | "meeting" | "task" | "sms";

export interface CrmContactSummary {
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

export interface CrmCompanySummary {
  id: string;
  workspaceId: string;
  name: string;
  parentCompanyId: string | null;
  assignedRepId: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivityItem {
  id: string;
  workspaceId: string;
  activityType: CrmActivityType;
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

export interface CrmContactTerritory {
  id: string;
  name: string;
  assignedRepId: string | null;
}

export interface CrmRepSafeDeal {
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
}

export interface CrmDealLossFields {
  lossReason: string | null;
  competitor: string | null;
}

export interface CrmDealStage {
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

export interface CrmWeightedDeal {
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

export type CrmQuoteStatus = "draft" | "linked" | "archived";

export interface CrmQuote {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  crmContactId: string | null;
  crmDealId: string | null;
  status: CrmQuoteStatus;
  title: string | null;
  lineItems: unknown[];
  customerSnapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  linkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CrmQuoteUpsertInput {
  crmContactId?: string | null;
  crmDealId?: string | null;
  status: CrmQuoteStatus;
  title?: string | null;
  lineItems: unknown[];
  customerSnapshot: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  linkedAt?: string | null;
}

export interface CrmDealBoardListInput {
  cursor?: string | null;
  limit?: number;
}

export interface CrmDealPatchInput {
  stageId?: string;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  closedAt?: string | null;
  lossReason?: string | null;
  competitor?: string | null;
}

export interface CrmPageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CrmActivityCreateInput {
  activityType: CrmActivityType;
  body: string;
  occurredAt: string;
  sendNow?: boolean;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export type CrmRecordType = "contact" | "company" | "equipment";

export interface CrmSearchItem {
  type: "company" | "contact";
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: string;
  rank: number;
}

export interface CrmHierarchyNode {
  id: string;
  name: string;
}

export interface CrmCompanyHierarchy {
  company: {
    id: string;
    name: string;
    assignedRepId: string | null;
  };
  ancestors: CrmHierarchyNode[];
  children: CrmHierarchyNode[];
  rollups: {
    contacts: number;
    equipment: number;
  };
  subtreeCompanyIds: string[];
}

export interface CrmEquipment {
  id: string;
  companyId: string;
  primaryContactId: string | null;
  name: string;
  assetTag: string | null;
  serialNumber: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CrmCustomField {
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

export interface CrmDuplicateContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  assignedRepId: string | null;
}

export interface CrmDuplicateCandidate {
  id: string;
  ruleId: string;
  score: number;
  status: "open" | "dismissed" | "merged";
  leftContact: CrmDuplicateContact | null;
  rightContact: CrmDuplicateContact | null;
  createdAt: string;
  updatedAt: string;
}
