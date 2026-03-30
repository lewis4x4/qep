export type UserRole = "rep" | "admin" | "manager" | "owner";

export interface ImportRequestBody {
  runId?: string;
}

export interface ImportCheckpoint {
  companiesAfter: string | null;
  contactsAfter: string | null;
  dealsAfter: string | null;
  companiesDone: boolean;
  contactsDone: boolean;
  dealsDone: boolean;
}

export interface ImportRunRow {
  id: string;
  workspace_id: string;
  initiated_by: string | null;
  metadata: Record<string, unknown> | null;
  contacts_processed: number;
  companies_processed: number;
  deals_processed: number;
  activities_processed: number;
  error_count: number;
}

export interface ImportState {
  runId: string;
  workspaceId: string;
  metadata: Record<string, unknown>;
  checkpoint: ImportCheckpoint;
  contactsProcessed: number;
  companiesProcessed: number;
  dealsProcessed: number;
  activitiesProcessed: number;
  errorCount: number;
}

export interface HubSpotPage<T> {
  results: T[];
  paging?: { next?: { after?: string } };
}

export interface HubSpotCompanyRecord {
  id: string;
  properties?: {
    name?: string;
    address?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

export interface HubSpotContactRecord {
  id: string;
  properties?: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    jobtitle?: string;
    associatedcompanyid?: string;
  };
}

export interface HubSpotDealRecord {
  id: string;
  properties?: {
    dealname?: string;
    dealstage?: string;
    amount?: string;
    closedate?: string;
    hubspot_owner_id?: string;
  };
  associations?: {
    contacts?: { results?: Array<{ id: string | number }> };
    companies?: { results?: Array<{ id: string | number }> };
  };
}

export function emptyCheckpoint(): ImportCheckpoint {
  return {
    companiesAfter: null,
    contactsAfter: null,
    dealsAfter: null,
    companiesDone: false,
    contactsDone: false,
    dealsDone: false,
  };
}

export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCloseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && raw.trim() !== "") {
    return new Date(asNumber).toISOString().slice(0, 10);
  }
  const asDate = new Date(raw);
  return Number.isNaN(asDate.getTime())
    ? null
    : asDate.toISOString().slice(0, 10);
}

export function nextAfterToken<T>(page: HubSpotPage<T>): string | null {
  return page.paging?.next?.after?.trim() || null;
}
