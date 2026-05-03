import { listCrmOpenDealsForBoard } from "./qrm-api";
import type { QrmRepSafeDeal } from "./types";

export const OPEN_DEALS_PAGE_SIZE = 500;
export const HYDRATION_UPDATE_BATCH_PAGES = 10;
export const PIPELINE_CACHE_KEY = "qep-crm-open-deals-cache-v1";

export interface DealUrgencyState {
  isOverdueFollowUp: boolean;
  hasNoFollowUp: boolean;
  isStalled: boolean;
  hasDataIssue: boolean;
  needsAttention: boolean;
}

export interface CachedOpenDealsPayload {
  items: QrmRepSafeDeal[];
  nextCursor: string | null;
}

export interface OpenDealsFirstPageResult extends CachedOpenDealsPayload {
  fromCache: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCachedDeal(value: unknown): QrmRepSafeDeal | null {
  if (!isRecord(value)) return null;
  const id = asRequiredString(value.id);
  const workspaceId = asRequiredString(value.workspaceId);
  const name = asRequiredString(value.name);
  const stageId = asRequiredString(value.stageId);
  const createdAt = asRequiredString(value.createdAt);
  const updatedAt = asRequiredString(value.updatedAt);
  if (!id || !workspaceId || !name || !stageId || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    workspaceId,
    name,
    stageId,
    primaryContactId: asNullableString(value.primaryContactId),
    companyId: asNullableString(value.companyId),
    assignedRepId: asNullableString(value.assignedRepId),
    amount: asNullableNumber(value.amount),
    expectedCloseOn: asNullableString(value.expectedCloseOn),
    nextFollowUpAt: asNullableString(value.nextFollowUpAt),
    lastActivityAt: asNullableString(value.lastActivityAt),
    closedAt: asNullableString(value.closedAt),
    hubspotDealId: asNullableString(value.hubspotDealId),
    createdAt,
    updatedAt,
    slaDeadlineAt: asNullableString(value.slaDeadlineAt),
    depositStatus: asNullableString(value.depositStatus),
    depositAmount: asNullableNumber(value.depositAmount),
    sortPosition: asNullableNumber(value.sortPosition),
    marginPct: asNullableNumber(value.marginPct),
  };
}

export function normalizeCachedOpenDealsPayload(value: unknown): CachedOpenDealsPayload | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  return {
    items: value.items.flatMap((item) => {
      const deal = normalizeCachedDeal(item);
      return deal ? [deal] : [];
    }),
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
  };
}

export function formatMoney(value: number | null): string {
  if (value === null) {
    return "Amount TBD";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Invalid date";
  }

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getFollowUpSortTime(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

export function getFutureFollowUpIso(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString();
}

export function updateDealNextFollowUp(
  deals: QrmRepSafeDeal[] | null,
  dealId: string,
  nextFollowUpAt: string | null
): QrmRepSafeDeal[] | null {
  return deals?.map((deal) => (deal.id === dealId ? { ...deal, nextFollowUpAt } : deal)) ?? deals;
}

export function readCachedOpenDeals(): CachedOpenDealsPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PIPELINE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeCachedOpenDealsPayload(parsed);
  } catch (error) {
    return null;
  }
}

export function writeCachedOpenDeals(payload: CachedOpenDealsPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PIPELINE_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore cache write failures; this is a best-effort resilience layer.
  }
}

export async function fetchOpenDealsFirstPage(): Promise<OpenDealsFirstPageResult> {
  try {
    const result = await listCrmOpenDealsForBoard({ limit: OPEN_DEALS_PAGE_SIZE });
    writeCachedOpenDeals({ items: result.items, nextCursor: result.nextCursor });
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      fromCache: false,
    };
  } catch (error) {
    const cached = readCachedOpenDeals();
    if (cached) {
      return {
        items: cached.items,
        nextCursor: cached.nextCursor,
        fromCache: true,
      };
    }
    throw error;
  }
}
